"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

const {
  getBankDecision,
  computeScore,
} = require("../../../utils/grading");

// Monitoring/anti-cheat fields — never exposed to students, even their own.
const MONITORING_FIELDS = [
  "blurEventCount",
  "totalTimeOutsideSeconds",
  "lastVisibilityState",
  "lastKnownPage",
  "lastActivityAt",
];

const stripMonitoring = (a) => {
  const rest = {};
  for (const [key, value] of Object.entries(a)) {
    if (!MONITORING_FIELDS.includes(key)) rest[key] = value;
  }
  return rest;
};

module.exports = createCoreController(
  "api::exam-attempt.exam-attempt",
  ({ strapi }) => ({
    async find(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const attempts = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findMany({
          where: { user: user.id },
          populate: ["exam", "course"],
          orderBy: { createdAt: "desc" },
        });

      // Strip score data from unreleased exam results + monitoring fields
      const sanitized = attempts.map((a) => {
        const isExam = !!a.exam;
        const showResults = isExam && a.exam?.showResults === true;
        if (!showResults && isExam) {
          const { score, passed, answers, questions, manualGrades, ...rest } =
            stripMonitoring(a);
          return {
            ...rest,
            score: null,
            passed: null,
            answers: null,
            questions: null,
            manualGrades: null,
          };
        }
        return stripMonitoring(a);
      });

      return ctx.send({ data: sanitized });
    },

    async findOne(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();

      const { id } = ctx.params;

      const attempt = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findOne({
          where: { id },
          populate: ["exam", "course", "user"],
        });

      if (!attempt) return ctx.notFound("Attempt not found");

      // Enforce ownership — users can only view their own attempts
      if (attempt.user?.id !== user.id) {
        return ctx.forbidden("You can only view your own attempts");
      }

      // Strip score data from unreleased exam results (same rule as find)
      const isExam = !!attempt.exam;
      const showResults = isExam && attempt.exam?.showResults === true;
      if (!showResults && isExam) {
        const { score, passed, answers, questions, manualGrades, ...rest } =
          stripMonitoring(attempt);
        return ctx.send({
          data: {
            ...rest,
            score: null,
            passed: null,
            answers: null,
            questions: null,
            manualGrades: null,
          },
        });
      }

      return ctx.send({ data: stripMonitoring(attempt) });
    },

    async findAll(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: { id: user.id },
        });
      if (!adminUser?.isAdmin) return ctx.forbidden();
      const attempts = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findMany({
          where: {},
          populate: ["exam", "course", "user"],
          orderBy: { createdAt: "desc" },
        });
      return ctx.send({ data: attempts });
    },

    async grade(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();

      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: { id: user.id },
        });

      if (!adminUser?.isAdmin) return ctx.forbidden();

      const { id } = ctx.params;
      const { manualGrades } = ctx.request.body;

      if (!manualGrades || typeof manualGrades !== "object") {
        return ctx.badRequest("manualGrades must be an object");
      }
      if (Array.isArray(manualGrades)) {
        return ctx.badRequest("manualGrades must be an object keyed by question id");
      }

      const attempt = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findOne({
          where: { id },
          populate: ["exam"],
        });

      if (!attempt) return ctx.notFound("Attempt not found");

      // Validate the manual grades shape before touching the DB. Every value
      // must be either a legacy 0/1 or a per-field map { [index]: 0|1 }.
      const validValue = (v) => v === 0 || v === 1 || v === "0" || v === "1";
      for (const [qid, value] of Object.entries(manualGrades)) {
        if (validValue(value)) continue;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          for (const [index, fieldValue] of Object.entries(value)) {
            if (!/^\d+$/.test(index)) {
              return ctx.badRequest(`Invalid field index for question ${qid}`);
            }
            if (!validValue(fieldValue)) {
              return ctx.badRequest(
                `Invalid grade for question ${qid}, field ${index}`
              );
            }
          }
          continue;
        }
        return ctx.badRequest(`Invalid manual grade for question ${qid}`);
      }

      const passingScore = attempt.exam?.passingScore || 70;
      // The backend is the source of truth: score/passed are always computed
      // from the stored answers + the submitted manual grades. A client cannot
      // submit its own score/passed values.
      const computed = computeScore({
        questions: attempt.questions || [],
        answers: attempt.answers || {},
        manualGrades,
        passingScore,
      });

      const updated = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .update({
          where: { id },
          data: {
            manualGrades,
            score: computed.score,
            passed: computed.passed,
          },
        });

      return ctx.send({
        data: {
          ...updated,
          totalPoints: computed.totalPoints,
          maxPoints: computed.maxPoints,
        },
      });
    },

    /**
     * Admin-only: change the answer-bank decision for one open-text answer
     * field of one question, and recalculate grades for EVERY participant of
     * the selected exam only.
     *
     * PUT /exam-attempts/change-answer-decision
     * Body: { examDocumentId, questionDocumentId, fieldIndex, decision }
     *   decision: 'correct' | 'incorrect'
     *
     * Behavior:
     *  - Updates the question-bank decision (answerFields*[fieldIndex].correct).
     *  - Creates/updates an exam-specific decision record so this exam keeps
     *    using the new rule while other exams (past and future) keep theirs.
     *  - Recalculates score + pass/fail for every submitted attempt of this
     *    exam only, applying the new decision to the affected field.
     *  - Writes a grading-audit-log entry (who, when, exam, question, old/new
     *    decision, per-attempt previous/new scores).
     *  - All steps run in ONE transaction; repeating the same call with the
     *    same decision is a no-op (idempotent — points are never doubled).
     */
    async changeAnswerDecision(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();

      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({ where: { id: user.id } });
      if (!adminUser?.isAdmin) return ctx.forbidden();

      const { examDocumentId, questionDocumentId, fieldIndex, decision } =
        ctx.request.body || {};

      if (!examDocumentId || typeof examDocumentId !== "string") {
        return ctx.badRequest("examDocumentId is required");
      }
      if (!questionDocumentId || typeof questionDocumentId !== "string") {
        return ctx.badRequest("questionDocumentId is required");
      }
      if (decision !== "correct" && decision !== "incorrect") {
        return ctx.badRequest('decision must be "correct" or "incorrect"');
      }
      if (!Number.isInteger(fieldIndex) || fieldIndex < 0) {
        return ctx.badRequest("fieldIndex must be a non-negative integer");
      }

      const exam = await strapi.db.query("api::exam.exam").findOne({
        where: { documentId: examDocumentId },
      });
      if (!exam) return ctx.notFound("Exam not found");

      const question = await strapi.db.query("api::question.question").findOne({
        where: { documentId: questionDocumentId },
      });
      if (!question) return ctx.notFound("Question not found");
      if (question.type !== "open_text") {
        return ctx.badRequest(
          "Answer-bank decisions can only be changed for open-text questions"
        );
      }

      const oldDecision = getBankDecision(question, fieldIndex)
        ? "correct"
        : "incorrect";

      // Idempotent: nothing to do when the decision did not change.
      if (oldDecision === decision) {
        return ctx.send({ ok: true, changed: false });
      }

      const newCorrect = decision === "correct";
      const newGrade = newCorrect ? 1 : 0;
      const qid = question.id;
      const langFields = ["answerFieldsLv", "answerFieldsRu", "answerFieldsEn"];

      try {
        const result = await strapi.db.transaction(async () => {
          // 1) Update the question bank decision for every language array.
          for (const field of langFields) {
            const arr = Array.isArray(question[field])
              ? question[field].map((entry) => ({ ...entry }))
              : [];
            while (arr.length <= fieldIndex) {
              arr.push({ expected: "", correct: true });
            }
            arr[fieldIndex] = {
              expected:
                arr[fieldIndex]?.expected != null
                  ? String(arr[fieldIndex].expected)
                  : "",
              correct: newCorrect,
            };
            await strapi.db.query("api::question.question").update({
              where: { id: qid },
              data: { [field]: arr },
            });
          }

          // 2) Exam-specific grading rule — this exam keeps the new decision
          //    even if the question bank changes again later.
          const existingOverride = await strapi.db
            .query("api::exam-question-decision.exam-question-decision")
            .findOne({
              where: { exam: exam.id, question: qid, fieldIndex },
            });
          if (existingOverride) {
            await strapi.db
              .query("api::exam-question-decision.exam-question-decision")
              .update({
                where: { id: existingOverride.id },
                data: { decision, changedBy: user.id },
              });
          } else {
            await strapi.db
              .query("api::exam-question-decision.exam-question-decision")
              .create({
                data: {
                  decision,
                  fieldIndex,
                  exam: exam.id,
                  question: qid,
                  changedBy: user.id,
                },
              });
          }

          // 3) Recalculate every submitted attempt of THIS exam only.
          const attempts = await strapi.db
            .query("api::exam-attempt.exam-attempt")
            .findMany({
              where: { exam: exam.id, submittedAt: { $notNull: true } },
            });

          const recalculated = [];
          for (const attempt of attempts) {
            const previousScore = attempt.score;
            const manualGrades = attempt.manualGrades || {};
            const perQuestion =
              manualGrades[qid] &&
              typeof manualGrades[qid] === "object" &&
              !Array.isArray(manualGrades[qid])
                ? { ...manualGrades[qid] }
                : {};
            perQuestion[fieldIndex] = newGrade;
            manualGrades[qid] = perQuestion;

            const computed = computeScore({
              questions: attempt.questions || [],
              answers: attempt.answers || {},
              manualGrades,
              passingScore: exam.passingScore || 70,
            });

            await strapi.db
              .query("api::exam-attempt.exam-attempt")
              .update({
                where: { id: attempt.id },
                data: {
                  manualGrades,
                  score: computed.score,
                  passed: computed.passed,
                },
              });

            recalculated.push({
              attemptId: attempt.id,
              previousScore:
                typeof previousScore === "number" ? previousScore : null,
              newScore: computed.score,
            });
          }

          // 4) Audit trail — who, when, what, and every affected result.
          await strapi.db.query("api::grading-audit-log.grading-audit-log").create({
            data: {
              admin: user.id,
              exam: exam.id,
              question: qid,
              fieldIndex,
              oldDecision,
              newDecision: decision,
              recalculatedAttempts: recalculated,
            },
          });

          return { recalculated };
        });

        return ctx.send({
          ok: true,
          changed: true,
          oldDecision,
          newDecision: decision,
          recalculatedAttempts: result.recalculated.length,
        });
      } catch (err) {
        strapi.log.error(
          "[exam-attempt] changeAnswerDecision failed:",
          err
        );
        return ctx.internalServerError(
          "Failed to update the answer decision. No grades were changed."
        );
      }
    },

    /**
     * Admin-only: exam-specific grading decisions for one exam.
     * GET /exam-attempts/decisions/:examDocumentId
     *
     * Returns the answer-bank decision overrides stored for this exam
     * (keyed by question id + field index) so the grading UI can show
     * "used in this exam" separately from the mutable question-bank value.
     */
    async getExamDecisions(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({ where: { id: user.id } });
      if (!adminUser?.isAdmin) return ctx.forbidden();

      const { examDocumentId } = ctx.params;
      const exam = await strapi.db.query("api::exam.exam").findOne({
        where: { documentId: examDocumentId },
      });
      if (!exam) return ctx.notFound("Exam not found");

      const rows = await strapi.db
        .query("api::exam-question-decision.exam-question-decision")
        .findMany({
          where: { exam: exam.id },
          populate: ["question"],
        });

      return ctx.send({
        data: rows.map((r) => ({
          questionId: r.question?.documentId || r.question || null,
          questionNumericId: r.question?.id || null,
          fieldIndex: r.fieldIndex,
          decision: r.decision,
        })),
      });
    },

    /**
     * Admin-only monitoring view for one exam.
     * GET /exam-attempts/monitoring/:examDocumentId
     *
     * Returns every attempt for the exam enriched with anti-cheat counters
     * (blur events, time spent outside the page), a derived status and a
     * heuristic suspicion score. Students never reach this endpoint (the
     * permission layer only lets it through for the Authenticated role, and
     * the controller re-checks isAdmin).
     */
    async monitoring(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({ where: { id: user.id } });
      if (!adminUser?.isAdmin) return ctx.forbidden();

      const { examDocumentId } = ctx.params;
      const exam = await strapi.documents("api::exam.exam").findOne({
        documentId: examDocumentId,
      });
      if (!exam) return ctx.notFound("Exam not found");

      const attempts = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findMany({
          where: { exam: exam.id },
          populate: ["user"],
          orderBy: { startedAt: "desc" },
        });

      const now = Date.now();
      const durationMs = (exam.duration || 30) * 60 * 1000;
      const closeAtMs = exam.closeAt ? new Date(exam.closeAt).getTime() : null;

      const enriched = attempts.map((a) => {
        const questions = a.questions || [];
        const answers = a.answers || {};

        // "Current question": last question index that has a non-empty answer.
        let answeredCount = 0;
        let lastAnsweredIndex = -1;
        questions.forEach((q, i) => {
          const val = answers[q.id];
          const filled = Array.isArray(val)
            ? val.length > 0
            : val !== undefined &&
              val !== null &&
              String(val).trim() !== "";
          if (filled) {
            answeredCount++;
            lastAnsweredIndex = i;
          }
        });

        // Derive attempt status.
        let status;
        if (a.submittedAt) {
          status = "submitted";
        } else {
          const startedMs = a.startedAt ? new Date(a.startedAt).getTime() : now;
          const timedOut =
            (closeAtMs !== null && now > closeAtMs) ||
            now - startedMs > durationMs + 30 * 1000;
          if (timedOut) {
            status = "expired";
          } else {
            const lastActMs = a.lastActivityAt
              ? new Date(a.lastActivityAt).getTime()
              : startedMs;
            const graceMs = Math.max(30 * 60 * 1000, durationMs * 2);
            status = now - lastActMs > graceMs ? "abandoned" : "in_progress";
          }
        }

        const blurEventCount = a.blurEventCount || 0;
        const totalTimeOutsideSeconds = a.totalTimeOutsideSeconds || 0;
        // Simple heuristic: every blur event + time spent away.
        const suspicionScore = Math.round(
          blurEventCount * 10 + totalTimeOutsideSeconds / 5,
        );

        return {
          id: a.id,
          documentId: a.documentId,
          status,
          startedAt: a.startedAt,
          lastActivityAt: a.lastActivityAt || a.updatedAt,
          submittedAt: a.submittedAt,
          blurEventCount,
          totalTimeOutsideSeconds,
          lastVisibilityState: a.lastVisibilityState || null,
          lastKnownPage: a.lastKnownPage || null,
          questionCount: questions.length,
          answeredCount,
          currentQuestionIndex: Math.max(lastAnsweredIndex + 1, 1),
          suspicionScore,
          user: a.user
            ? {
                id: a.user.id,
                username: a.user.username,
                email: a.user.email,
                firstName: a.user.firstName || "",
                lastName: a.user.lastName || "",
              }
            : null,
        };
      });

      return ctx.send({
        data: {
          exam: {
            documentId: exam.documentId,
            title: exam.title || exam.titleLv || exam.titleEn || exam.titleRu || "",
          },
          attempts: enriched,
        },
      });
    },
  }),
);

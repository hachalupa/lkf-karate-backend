"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

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
      const { score, passed, manualGrades } = ctx.request.body;

      const updated = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .update({
          where: { id },
          data: { score, passed, manualGrades },
        });

      return ctx.send({ data: updated });
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

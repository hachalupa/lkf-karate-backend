"use strict";

const { isCorrect } = require("../../../utils/answer-grading");

// This Strapi setup stores a draft + a published row per document, so raw
// db queries return every document twice. Collapse to one row per documentId,
// preferring the published row (publishedAt set) when both exist.
function dedupeByDocumentId(rows) {
  const byDoc = new Map();
  for (const row of rows || []) {
    const key = row.documentId;
    const existing = byDoc.get(key);
    if (!existing || (row.publishedAt && !existing.publishedAt)) {
      byDoc.set(key, row);
    }
  }
  return Array.from(byDoc.values());
}

/**
 * Question shape sent to the student UI.
 *
 * Every language field travels to the client and is resolved there with
 * `getLocalizedField` / `getLocalizedArray` (AGENTS §6) — the backend must not
 * pick a language, or a Russian reader silently gets Latvian text no matter
 * what the UI asks for. `correctAnswer` is only attached by the callers that
 * are allowed to reveal it (`showResults === true`, and the intentional
 * self-study exception in /exams/quick-quiz).
 *
 * The flattened `text` / `options` are kept as a last-resort fallback so an
 * older client that reads the raw field still renders something.
 */
function toClientQuestion(q, { includeCorrectAnswer = false } = {}) {
  const question = {
    id: q.id,
    documentId: q.documentId,
    text: q.text || q.textLv || q.textEn || q.textRu || "",
    textLv: q.textLv ?? null,
    textRu: q.textRu ?? null,
    textEn: q.textEn ?? null,
    type: q.type,
    options: (q.options?.length > 0 ? q.options : null) ||
             (q.optionsLv?.length > 0 ? q.optionsLv : null) ||
             (q.optionsRu?.length > 0 ? q.optionsRu : null) ||
             (q.optionsEn?.length > 0 ? q.optionsEn : null) ||
             ["true", "false"],
    optionsLv: Array.isArray(q.optionsLv) ? q.optionsLv : null,
    optionsRu: Array.isArray(q.optionsRu) ? q.optionsRu : null,
    optionsEn: Array.isArray(q.optionsEn) ? q.optionsEn : null,
    media: q.media,
    videoAkaUrl: q.videoAkaUrl || null,
    videoAoUrl: q.videoAoUrl || null,
  };
  if (includeCorrectAnswer) {
    question.correctAnswer = q.correctAnswer;
  }
  return question;
}

module.exports = {
  async start(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("You must be logged in");
    }

    const { examId } = ctx.request.body;

    if (!examId) {
      return ctx.badRequest("examId is required");
    }

    // Find the exam
    const exam = await strapi.documents("api::exam.exam").findOne({
      documentId: examId,
      populate: ["course"],
    });
    
    if (!exam) {
      return ctx.notFound("Exam not found");
    }

    // Review exams (created after a question import) are admin-only workspace
    // containers — students must never start or see them.
    if (exam.reviewType) {
      return ctx.badRequest(
        "This exam is a review exam and is not available to students"
      );
    }

    // Check if exam is open
    const now = new Date();
    if (exam.openAt && new Date(exam.openAt) > now) {
      return ctx.badRequest("Exam has not started yet");
    }
    if (exam.closeAt && new Date(exam.closeAt) < now) {
      return ctx.badRequest("Exam has closed");
    }

    // Check if user already has a submitted attempt
    const submittedAttempt = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .findOne({
        where: {
          exam: exam.id,
          user: user.id,
          submittedAt: { $notNull: true },
        },
        orderBy: { submittedAt: "desc" },
      });

    if (submittedAttempt) {
      return ctx.badRequest("You have already completed this exam");
    }

    // Check if user already has an active attempt
    const existing = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .findOne({
        where: {
          exam: exam.id,
          user: user.id,
          submittedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

    if (existing) {
      const now = new Date();
      let remainingSeconds = exam.duration * 60;

      // Touch lastActivityAt so the monitoring view shows the student is back
      await strapi.db.query("api::exam-attempt.exam-attempt").update({
        where: { id: existing.id },
        data: { lastActivityAt: now },
      });

      const startedAt = new Date(existing.startedAt);
      const secondsSinceStart = Math.floor(
        (Number(now) - Number(startedAt)) / 1000,
      );
      remainingSeconds = Math.max(0, exam.duration * 60 - secondsSinceStart);

      if (exam.closeAt) {
        const closeAt = new Date(exam.closeAt);
        const secondsUntilClose = Math.floor(
          (Number(closeAt) - Number(now)) / 1000,
        );
        remainingSeconds = Math.min(remainingSeconds, secondsUntilClose);
      }

      // Re-fetch questions with media
      // Guard against legacy/corrupt rows where `questions` may be undefined
      // (previously this threw and turned a resume into a 500).
      const existingQuestions = existing.questions || [];
      const questionIds = existingQuestions.map((q) => q.id);
      const questionsWithMedia = await strapi.db
        .query("api::question.question")
        .findMany({
          where: { id: { $in: questionIds } },
          populate: ["media"],
        });

      // Preserve original question order
      const questionsMap = {};
      questionsWithMedia.forEach((q) => {
        questionsMap[q.id] = q;
      });
      const orderedQuestions = existingQuestions.map(
        (q) => questionsMap[q.id] || q,
      );

      const showResultsInResume = exam.showResults === true;
      // Only send correct answers to client if results are released
      const questionsForClient = orderedQuestions.map((q) =>
        toClientQuestion(q, { includeCorrectAnswer: showResultsInResume }),
      );

      return ctx.send({
        attemptId: existing.id,
        duration: exam.duration,
        remainingSeconds,
        showResults: showResultsInResume,
        questions: questionsForClient,
        answers: existing.answers || {},
        examTitle: exam.title,
      });
    }

    // Get exam with selected questions
    const examWithQuestions = await strapi.documents("api::exam.exam").findOne({
      documentId: examId,
      populate: ["course", "questions", "questions.media"],
    });

    let selected = [];

    if (examWithQuestions.questions && examWithQuestions.questions.length > 0) {
      // Use the admin-selected questions, shuffle their order per attempt
      selected = examWithQuestions.questions.sort(() => Math.random() - 0.5);
    } else {
      // Exams require an explicit question set — the admin must pick the
      // questions in the admin panel. There is intentionally no fallback to
      // a random course pool anymore: a stored questionCount with no actual
      // selection made the student card claim "N questions" while the admin
      // editor showed none chosen.
      return ctx.badRequest(
        "This exam has no questions selected. An administrator must choose the questions first.",
      );
    }

    // Strip correct answers before sending to client (no includeCorrectAnswer)
    const questionsForClient = selected.map((q) => toClientQuestion(q));

    // Store full questions (with answers) in the attempt
    const attempt = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .create({
        data: {
          kind: "exam",
          exam: exam.id,
          user: user.id,
          startedAt: new Date(),
          questions: selected,
          answers: {},
          lastActivityAt: new Date(),
          blurEventCount: 0,
          totalTimeOutsideSeconds: 0,
          lastVisibilityState: "visible",
          lastKnownPage: "exam",
          publishedAt: new Date(),
        },
      });

    // Calculate remaining time
    let remainingSeconds = exam.duration * 60;

    if (exam.closeAt) {
      const now = new Date();
      const closeAt = new Date(exam.closeAt);
      const secondsUntilClose = Math.floor(
        (Number(closeAt) - Number(now)) / 1000,
      );
      remainingSeconds = Math.min(remainingSeconds, secondsUntilClose);
    }

    return ctx.send({
      attemptId: attempt.id,
      duration: exam.duration,
      remainingSeconds,
      showResults: exam.showResults === true,
      questions: questionsForClient,
      answers: attempt.answers || {},
      examTitle: exam.title,
    });
  },

  async submit(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { attemptId, answers } = ctx.request.body;
    if (!attemptId || !answers) {
      return ctx.badRequest("attemptId and answers are required");
    }

    // Find the attempt
    const attempt = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .findOne({
        where: { id: attemptId, user: user.id },
        populate: ["exam", "course"],
      });

    if (!attempt) return ctx.notFound("Attempt not found");
    if (attempt.submittedAt) return ctx.badRequest("Attempt already submitted");

    // Get exam directly using documentId from populated relation
    const examData = attempt.exam;
    const courseData = attempt.course;
    const isQuickQuiz = !examData && !!courseData;

    const now = new Date();
    const startedAt = attempt.startedAt ? new Date(attempt.startedAt) : null;

    // Check if time has expired — soft warning, don't reject
    let timedOut = false;
    if (examData?.closeAt && new Date(examData.closeAt) < now) {
      timedOut = true;
    }
    if (examData?.duration && startedAt) {
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      const maxDurationSeconds = examData.duration * 60;
      if (elapsedSeconds > maxDurationSeconds + 30) {
        timedOut = true;
      }
    }

    const passingScore = examData?.passingScore || 70;
    const showResults = examData?.showResults === true;

    const questions = attempt.questions || [];

    // If time has expired, accept whatever answers exist (don't reject)
    // Unanswered questions count as wrong
    const unanswered = questions.filter((q) => {
      const userAnswer = answers[q.id];
      return (
        userAnswer === undefined ||
        userAnswer === null ||
        String(userAnswer).trim() === ""
      );
    });

    if (unanswered.length > 0 && !timedOut) {
      return ctx.badRequest(
        `Please answer all questions before submitting. ${unanswered.length} unanswered.`,
      );
    }

    let correct = 0;
    questions.forEach((q) => {
      // Grading is language-aware: the answer is matched by option index, so a
      // student reading Russian options is graded exactly like one reading the
      // Latvian the answer was authored in (see utils/answer-grading.js).
      if (isCorrect(q, answers[q.id])) {
        correct++;
      }
    });
    const correct = computed.totalPoints;
    const total = computed.maxPoints;
    const score = computed.score;
    const passed = isQuickQuiz ? null : computed.passed;

    const submittedAt = new Date();
    const timeSpentSeconds =
      startedAt ? Math.max(0, Math.floor((submittedAt - startedAt) / 1000)) : null;

    // Persist any monitoring counters the client reported on submit too
    // (the student page sends them with the final answers).
    const submitTracking = {
      blurEventCount: ctx.request.body.blurCount,
      totalTimeOutsideSeconds: ctx.request.body.totalTimeOutsideSeconds,
      lastVisibilityState: ctx.request.body.lastVisibilityState,
      lastKnownPage: ctx.request.body.lastKnownPage,
    };
    const submitData = {
      answers,
      score,
      passed,
      submittedAt,
      timeSpentSeconds,
      lastActivityAt: submittedAt,
    };
    for (const [key, value] of Object.entries(submitTracking)) {
      if (value !== undefined && value !== null) submitData[key] = value;
    }

    await strapi.db.query("api::exam-attempt.exam-attempt").update({
      where: { id: attemptId },
      data: submitData,
    });

    if (!showResults && !isQuickQuiz) {
      // Hide score data until admin releases results
      return ctx.send({
        showResults: false,
        submittedAt,
        timeSpentSeconds,
        startedAt,
      });
    }

    return ctx.send({
      score,
      passed,
      correct,
      total,
      showResults,
      timeSpentSeconds,
      startedAt,
      submittedAt,
    });
  },

  async quickQuiz(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { courseDocumentId, count } = ctx.request.body;
    if (!courseDocumentId)
      return ctx.badRequest("courseDocumentId is required");

    const course = await strapi.documents("api::course.course").findOne({
      documentId: courseDocumentId,
    });

    if (!course) return ctx.notFound("Course not found");

    // Match questions by the course DOCUMENT id, not the numeric row id.
    // Draft-and-publish courses exist as two rows (draft + published), and
    // questions link to whichever row was live at creation time — querying
    // `course: course.id` (documents.findOne returns the draft row) finds
    // nothing when the questions point at the published row (BUG: quick quiz
    // reported "No questions available" despite 120 questions existing).
    const allQuestions = dedupeByDocumentId(
      await strapi.db
        .query("api::question.question")
        .findMany({
          where: { course: { documentId: { $eq: courseDocumentId } } },
          populate: ["media"],
        }),
    );
    if (allQuestions.length === 0) {
      return ctx.badRequest("No questions available for this course");
    }

    // Quick quizzes auto-score on submit (no judge), but open-text questions
    // cannot be auto-graded — they would silently contribute 0 points and
    // mislead the student. Exclude them from the quiz pool so every question
    // shown is actually scored. (Open-text practice happens in real exams.)
    const quizQuestions = allQuestions.filter(
      (q) => !isOpenTextQuestion(q)
    );
    if (quizQuestions.length === 0) {
      return ctx.badRequest(
        "No auto-scored questions available for this course (open-text questions are excluded from quick quizzes)"
      );
    }

    const questionCount =
      count === "all"
        ? quizQuestions.length
        : Math.min(Number(count) || 10, quizQuestions.length);

    const shuffled = quizQuestions.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, questionCount);

    // Quick quiz is the deliberate self-study exception: it ships the answers
    // on purpose, so students can check themselves (AGENTS §5.4).
    const questionsForClient = selected.map((q) =>
      toClientQuestion(q, { includeCorrectAnswer: true }),
    );

    const attempt = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .create({
        data: {
          kind: "quick_quiz",
          user: user.id,
          course: course.id,
          questions: selected,
          answers: {},
          startedAt: new Date(),
          publishedAt: new Date(),
        },
      });

    return ctx.send({
      attemptId: attempt.id,
      questions: questionsForClient,
      courseTitle: course.title || course.titleLv || course.titleEn || course.titleRu || '',
      total: questionsForClient.length,
      startedAt: attempt.startedAt,
    });
  },

  async saveProgress(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { attemptId, answers } = ctx.request.body;
    if (!attemptId || !answers) {
      return ctx.badRequest("attemptId and answers are required");
    }

    const attempt = await strapi.db
      .query("api::exam-attempt.exam-attempt")
      .findOne({
        where: { id: attemptId, user: user.id },
      });

    if (!attempt) return ctx.notFound("Attempt not found");
    if (attempt.submittedAt) return ctx.badRequest("Attempt already submitted");

    const currentAnswers = attempt.answers || {};
    const mergedAnswers = { ...currentAnswers, ...answers };

    const data = { answers: mergedAnswers, lastActivityAt: new Date() };

    // Silent monitoring counters — sent by the student exam page along with
    // every save. Only overwrite when the client actually reports a value.
    const tracking = {
      blurCount: "blurEventCount",
      totalTimeOutsideSeconds: "totalTimeOutsideSeconds",
      lastVisibilityState: "lastVisibilityState",
      lastKnownPage: "lastKnownPage",
    };
    for (const [bodyKey, fieldKey] of Object.entries(tracking)) {
      const value = ctx.request.body[bodyKey];
      if (value !== undefined && value !== null) {
        data[fieldKey] = value;
      }
    }

    await strapi.db.query("api::exam-attempt.exam-attempt").update({
      where: { id: attemptId },
      data,
    });

    return ctx.send({ ok: true, answers: mergedAnswers });
  },
};

"use strict";

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
      const questionIds = existing.questions.map((q) => q.id);
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
      const orderedQuestions = existing.questions.map(
        (q) => questionsMap[q.id] || q,
      );

      const showResultsInResume = exam.showResults === true;
      const questionsForClient = orderedQuestions.map((q) => {
        const question = {
          id: q.id,
          documentId: q.documentId,
          text: q.text || q.textLv || q.textEn || q.textRu || "",
          type: q.type,
          options: (q.options?.length > 0 ? q.options : null) ||
                   (q.optionsLv?.length > 0 ? q.optionsLv : null) ||
                   (q.optionsRu?.length > 0 ? q.optionsRu : null) ||
                   (q.optionsEn?.length > 0 ? q.optionsEn : null) ||
                   ["true", "false"],
          media: q.media,
          videoAkaUrl: q.videoAkaUrl || null,
          videoAoUrl: q.videoAoUrl || null,
        };
        // Only send correct answers to client if results are released
        if (showResultsInResume) {
          question.correctAnswer = q.correctAnswer;
        }
        return question;
      });

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

    // Strip correct answers before sending to client
    const questionsForClient = selected.map((q) => ({
      id: q.id,
      documentId: q.documentId,
      text: q.text || q.textLv || q.textEn || q.textRu || "",
      type: q.type,
      options: (q.options?.length > 0 ? q.options : null) ||
               (q.optionsLv?.length > 0 ? q.optionsLv : null) ||
               (q.optionsRu?.length > 0 ? q.optionsRu : null) ||
               (q.optionsEn?.length > 0 ? q.optionsEn : null) ||
               ["true", "false"],
      media: q.media,
      videoAkaUrl: q.videoAkaUrl || null,
      videoAoUrl: q.videoAoUrl || null,
    }));

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
      const userAnswer = answers[q.id];
      // Multiple-select (multiple_choice): grade by set equality on the arrays.
      // Only treat correctAnswers as the expected list when it actually holds
      // values — an empty array must fall through to the single-answer check.
      const expectedList =
        Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0
          ? q.correctAnswers
          : null;
      if (expectedList) {
        const ua = (Array.isArray(userAnswer) ? userAnswer : [])
          .map((v) => String(v))
          .sort();
        const ex = expectedList.map((v) => String(v)).sort();
        if (ua.length === ex.length && ua.every((v, i) => v === ex[i])) {
          correct++;
        }
      } else if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
        if (
          String(userAnswer).toLowerCase() ===
          String(q.correctAnswer).toLowerCase()
        ) {
          correct++;
        }
      }
    });

    const score = Math.round((correct / questions.length) * 100);
    const passed = isQuickQuiz ? null : score >= passingScore;

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
      total: questions.length,
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

    const questionCount =
      count === "all"
        ? allQuestions.length
        : Math.min(Number(count) || 10, allQuestions.length);

    const shuffled = allQuestions.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, questionCount);

    const questionsForClient = selected.map((q) => ({
      id: q.id,
      documentId: q.documentId,
      text: q.text || q.textLv || q.textEn || q.textRu || "",
      type: q.type,
      options: (q.options?.length > 0 ? q.options : null) ||
               (q.optionsLv?.length > 0 ? q.optionsLv : null) ||
               (q.optionsRu?.length > 0 ? q.optionsRu : null) ||
               (q.optionsEn?.length > 0 ? q.optionsEn : null) ||
               ["true", "false"],
      media: q.media,
      videoAkaUrl: q.videoAkaUrl || null,
      videoAoUrl: q.videoAoUrl || null,
      correctAnswer: q.correctAnswer,
    }));

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

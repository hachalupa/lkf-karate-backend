'use strict'

module.exports = {
  async start(ctx) {
    const user = ctx.state.user

    if (!user) {
      return ctx.unauthorized('You must be logged in')
    }

    const { examId } = ctx.request.body

    if (!examId) {
      return ctx.badRequest('examId is required')
    }

    // Find the exam
    const exam = await strapi.documents('api::exam.exam').findOne({
      documentId: examId,
      populate: ['course'],
    })

    if (!exam) {
      return ctx.notFound('Exam not found')
    }

    // Check if exam is open
    const now = new Date()
    if (exam.openAt && new Date(exam.openAt) > now) {
      return ctx.badRequest('Exam has not started yet')
    }
    if (exam.closeAt && new Date(exam.closeAt) < now) {
      return ctx.badRequest('Exam has closed')
    }

    // Check if user already has an active attempt
    const existing = await strapi.db.query('api::exam-attempt.exam-attempt').findOne({
      where: {
        exam: exam.id,
        user: user.id,
        submittedAt: null,
      },
    })

    if (existing) {
      return ctx.send({
        attemptId: existing.id,
        duration: exam.duration,
        questions: existing.questions.map(q => ({
          id: q.id,
          documentId: q.documentId,
          text: q.text,
          type: q.type,
          options: q.options,
        })),
      })
    }

    // Get all questions for this course
    const allQuestions = await strapi.db.query('api::question.question').findMany({
      where: { course: exam.course.id },
    })

    if (allQuestions.length === 0) {
      return ctx.badRequest('No questions available for this exam')
    }

    // Pick random N questions
    const count = Math.min(exam.questionCount || 10, allQuestions.length)
    const shuffled = allQuestions.sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, count)

    // Strip correct answers before sending to client
    const questionsForClient = selected.map(q => ({
      id: q.id,
      documentId: q.documentId,
      text: q.text,
      type: q.type,
      options: q.options,
    }))

    // Store full questions (with answers) in the attempt
    const attempt = await strapi.db.query('api::exam-attempt.exam-attempt').create({
      data: {
        exam: exam.id,
        user: user.id,
        startedAt: new Date(),
        questions: selected,
        answers: {},
      },
    })

    return ctx.send({
      attemptId: attempt.id,
      duration: exam.duration,
      questions: questionsForClient,
    })
  },

 async submit(ctx) {
  const user = ctx.state.user

  if (!user) {
    return ctx.unauthorized('You must be logged in')
  }

  const { attemptId, answers } = ctx.request.body

  if (!attemptId || !answers) {
    return ctx.badRequest('attemptId and answers are required')
  }

  // Find the attempt
  const attempt = await strapi.db.query('api::exam-attempt.exam-attempt').findOne({
    where: { id: attemptId, user: user.id },
    populate: ['exam'],
  })

  if (!attempt) {
    return ctx.notFound('Attempt not found')
  }

  if (attempt.submittedAt) {
    return ctx.badRequest('Attempt already submitted')
  }

  // Grade the attempt
  const questions = attempt.questions
  let correct = 0

  questions.forEach(q => {
    const userAnswer = answers[q.id]
    if (userAnswer !== undefined && userAnswer !== null) {
      if (String(userAnswer).toLowerCase() === String(q.correctAnswer).toLowerCase()) {
        correct++
      }
    }
  })

  const score = Math.round((correct / questions.length) * 100)
  const passed = score >= (attempt.exam?.passingScore || 70)

  // Update attempt
  await strapi.db.query('api::exam-attempt.exam-attempt').update({
    where: { id: attemptId },
    data: {
      answers,
      score,
      passed,
      submittedAt: new Date(),
    },
  })

  return ctx.send({
    score,
    passed,
    correct,
    total: questions.length,
  })
},
}

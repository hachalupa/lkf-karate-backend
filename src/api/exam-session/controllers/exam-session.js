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
  const now = new Date()
  let remainingSeconds = exam.duration * 60

  const startedAt = new Date(existing.startedAt)
  const secondsSinceStart = Math.floor((Number(now) - Number(startedAt)) / 1000)
  remainingSeconds = Math.max(0, exam.duration * 60 - secondsSinceStart)

  if (exam.closeAt) {
    const closeAt = new Date(exam.closeAt)
    const secondsUntilClose = Math.floor((Number(closeAt) - Number(now)) / 1000)
    remainingSeconds = Math.min(remainingSeconds, secondsUntilClose)
  }

  // Re-fetch questions with media
  const questionIds = existing.questions.map(q => q.id)
  const questionsWithMedia = await strapi.db.query('api::question.question').findMany({
    where: { id: { $in: questionIds } },
    populate: ['media'],
  })

  // Preserve original question order
  const questionsMap = {}
  questionsWithMedia.forEach(q => { questionsMap[q.id] = q })
  const orderedQuestions = existing.questions.map(q => questionsMap[q.id] || q)

  const questionsForClient = orderedQuestions.map(q => ({
    id: q.id,
    documentId: q.documentId,
    text: q.text,
    type: q.type,
    options: q.options,
    media: q.media || null,
  }))

  return ctx.send({
    attemptId: existing.id,
    duration: exam.duration,
    remainingSeconds,
    showResults: exam.showResults === true,
    questions: questionsForClient,
  })
}

    // Get all questions for this course
    const allQuestions = await strapi.db.query('api::question.question').findMany({
      where: { course: exam.course.id },
      populate: ['media'],
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
      media: q.media,
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

    // Calculate remaining time
    let remainingSeconds = exam.duration * 60

      if (exam.closeAt) {
        const now = new Date()
        const closeAt = new Date(exam.closeAt)
        const secondsUntilClose = Math.floor((Number(closeAt) - Number(now)) / 1000)
        remainingSeconds = Math.min(remainingSeconds, secondsUntilClose)
      }

      return ctx.send({
        attemptId: attempt.id,
        duration: exam.duration,
        remainingSeconds,
        showResults: exam.showResults ?? true,
        questions: questionsForClient,
      })
  },

  async submit(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const { attemptId, answers } = ctx.request.body
    if (!attemptId || !answers) {
      return ctx.badRequest('attemptId and answers are required')
    }

    // Find the attempt
    const attempt = await strapi.db.query('api::exam-attempt.exam-attempt').findOne({
      where: { id: attemptId, user: user.id },
      populate: ['exam'],
    })

    if (!attempt) return ctx.notFound('Attempt not found')
    if (attempt.submittedAt) return ctx.badRequest('Attempt already submitted')

    // Get exam directly using documentId from populated relation
    const examData = attempt.exam
    const passingScore = examData?.passingScore || 70
    const showResults = examData?.showResults === true

    // Grade
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
    const passed = score >= passingScore

    await strapi.db.query('api::exam-attempt.exam-attempt').update({
      where: { id: attemptId },
      data: { answers, score, passed, submittedAt: new Date() },
    })

    console.log('EXAM DATA:', examData)
    console.log('SHOW RESULTS:', showResults)
    
    return ctx.send({ 
      score, 
      passed, 
      correct, 
      total: questions.length, 
      showResults,
      resultsReleased: examData?.resultsReleased === true,
    })
},

  async quickQuiz(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const { courseDocumentId, count } = ctx.request.body
    if (!courseDocumentId) return ctx.badRequest('courseDocumentId is required')

    const course = await strapi.documents('api::course.course').findOne({
      documentId: courseDocumentId,
    })

    if (!course) return ctx.notFound('Course not found')

    const allQuestions = await strapi.db.query('api::question.question').findMany({
      where: { course: course.id },
      populate: ['media'],
    })

    if (allQuestions.length === 0) {
      return ctx.badRequest('No questions available for this course')
    }

    const questionCount = count === 'all'
      ? allQuestions.length
      : Math.min(Number(count) || 10, allQuestions.length)

    const shuffled = allQuestions.sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, questionCount)

    const questionsForClient = selected.map(q => ({
      id: q.id,
      documentId: q.documentId,
      text: q.text,
      type: q.type,
      options: q.options,
      media: q.media,
    }))

    return ctx.send({
      questions: questionsForClient,
      courseTitle: course.title,
      total: questionsForClient.length,
    })
  },
}

// api/dashboard/controllers/dashboard.js
'use strict';

module.exports = {
  async user(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const now = new Date()

    const days30Ago = new Date(now)
    days30Ago.setDate(days30Ago.getDate() - 30)

    const days360Ago = new Date(now)
    days360Ago.setDate(days360Ago.getDate() - 360)

    // 1) Last results – latest 3 submitted (all time)
    const lastResults = await strapi.db
      .query('api::exam-attempt.exam-attempt')
      .findMany({
        where: {
          user: user.id,
          submittedAt: { $notNull: true },
        },
        orderBy: { submittedAt: 'desc' },
        limit: 3,
        populate: ['exam', 'course'],
      })

    // 2a) Quiz count – last 30 days
    const recentQuizAttempts = await strapi.db
      .query('api::exam-attempt.exam-attempt')
      .findMany({
        where: {
          user: user.id,
          submittedAt: { $notNull: true, $gte: days30Ago },
          course: { $notNull: true },
          exam: null,
        },
      })

    const quizCount = recentQuizAttempts.length

    // 2b) Exam stats – last 360 days
    const recentExamAttempts = await strapi.db
      .query('api::exam-attempt.exam-attempt')
      .findMany({
        where: {
          user: user.id,
          submittedAt: { $notNull: true, $gte: days360Ago },
          exam: { $notNull: true },
        },
      })

    let examCount = 0
    let completedExams = 0

    for (const a of recentExamAttempts) {
      examCount += 1                   // all submitted exams in 360 days
      if (a.passed === true) {
        completedExams += 1            // passed exams in 360 days
      }
    }

    // 2c) Study hours – placeholder for now
    const studyHours = 0

    // 3) Upcoming exam (nearest openAt in future)
    
    const upcoming = await strapi
      .documents('api::exam.exam')
      .findMany({
        where: {
          openAt: { $gt: now },
        },
        orderBy: { openAt: 'asc' },
        limit: 1,
        populate: ['course', 'questions'],   // add this
      })

    let upcomingExam = null

    if (upcoming && upcoming.length > 0) {
      const exam = upcoming[0]
      const openAt = new Date(exam.openAt)

      const diffMs = openAt - now
      const diffSec = Math.max(0, Math.floor(diffMs / 1000))
      const days = Math.floor(diffSec / 86400)
      const hours = Math.floor((diffSec % 86400) / 3600)

      const parts = []
      if (days > 0) parts.push(`${days} days`)
      if (hours > 0) parts.push(`${hours} hours`)

      upcomingExam = {
        id: exam.id,
        documentId: exam.documentId,
        title: exam.title,
        opensInHuman: parts.join(' ') || 'soon',
        courseTitle: exam.course?.title || null,
        questionCount: exam.questions?.length || 0,
        passingScore: exam.passingScore ?? null,   // adjust field name to match your schema
      }
    }

    // 4) Greeting
    let greeting = null
    const hour = now.getHours()
    if (hour < 12) greeting = 'Good morning'
    else if (hour < 18) greeting = 'Good afternoon'
    else greeting = 'Good evening'

    return ctx.send({
      greeting,
      stats: {
        quizCount,        // last 30 days
        examCount,        // last 360 days
        studyHours,       // 0 for now
        completedExams,   // passed in last 360 days
      },
      lastResults,
      upcomingExam,
    })
  },
}
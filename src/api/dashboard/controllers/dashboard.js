// api/dashboard/controllers/dashboard.js
'use strict';

module.exports = {
  async user(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const now = new Date()
    const days30Ago = new Date(now)
    days30Ago.setDate(days30Ago.getDate() - 30)

    // 1) Last results (exams + quick quizzes) – latest 3 submitted
    const lastResults = await strapi.db.query('api::exam-attempt.exam-attempt').findMany({
      where: {
        user: user.id,
        submittedAt: { $notNull: true },
      },
      orderBy: { submittedAt: 'desc' },
      limit: 3,
      populate: ['exam', 'course'],
    })

    // 2) Stats over last 30 days (you can change to 90 later if you want)
    const recentAttempts = await strapi.db.query('api::exam-attempt.exam-attempt').findMany({
      where: {
        user: user.id,
        submittedAt: { $notNull: true, $gte: days30Ago },
      },
      populate: ['exam', 'course'],
    })

    let quizCount = 0
    let completedExams = 0
    let studySeconds = 0
    // completedChapters: 0 for now unless you track it elsewhere
    let completedChapters = 0

    for (const a of recentAttempts) {
      const isQuickQuiz = !!a.course && !a.exam
      const isExam = !!a.exam
      if (isQuickQuiz) quizCount += 1
      if (isExam && a.passed === true) completedExams += 1
      if (a.timeSpentSeconds) studySeconds += a.timeSpentSeconds
    }

    const studyHours = Number((studySeconds / 3600).toFixed(1))

    // 3) Upcoming exam (nearest openAt in future that user can take)
    const upcoming = await strapi.documents('api::exam.exam').findMany({
      where: {
        openAt: { $gt: now },
        // add any extra filters (e.g. published, allowed roles)
      },
      orderBy: { openAt: 'asc' },
      limit: 1,
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
      }
    }

    // 4) Greeting can be done on frontend, but you can send it if you like
    let greeting = null
    const hour = now.getHours()
    if (hour < 12) greeting = 'Good morning'
    else if (hour < 18) greeting = 'Good afternoon'
    else greeting = 'Good evening'

    return ctx.send({
      greeting,
      stats: {
        quizCount,
        studyHours,
        completedChapters,
        completedExams,
      },
      lastResults,
      upcomingExam,
    })
  },
}
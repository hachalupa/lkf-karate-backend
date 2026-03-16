module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/exams/start',
      handler: 'exam-session.start',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/exams/submit',
      handler: 'exam-session.submit',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}

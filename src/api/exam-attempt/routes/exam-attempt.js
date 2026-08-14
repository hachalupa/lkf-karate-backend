'use strict'

const { createCoreRouter } = require('@strapi/strapi').factories

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/exam-attempts',
      handler: 'exam-attempt.find',
      config: { policies: [], middlewares: [] },
    },
    // Static route MUST be registered before the param route (/exam-attempts/:id)
    // so 'all' is not swallowed as an :id value (koa-router matches in order).
    {
      method: 'GET',
      path: '/exam-attempts/all',
      handler: 'exam-attempt.findAll',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/exam-attempts/monitoring/:examDocumentId',
      handler: 'exam-attempt.monitoring',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/exam-attempts/:id',
      handler: 'exam-attempt.findOne',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'PUT',
      path: '/exam-attempts/grade/:id',
      handler: 'exam-attempt.grade',
      config: { policies: [], middlewares: [] },
    },
  ],
}
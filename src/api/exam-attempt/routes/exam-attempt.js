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
    {
      method: 'GET',
      path: '/exam-attempts/all',
      handler: 'exam-attempt.findAll',
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
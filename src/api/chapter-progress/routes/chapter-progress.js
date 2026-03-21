'use strict'

const { createCoreRouter } = require('@strapi/strapi').factories

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/chapter-progress',
      handler: 'chapter-progress.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/chapter-progress/mark-seen',
      handler: 'chapter-progress.markSeen',
      config: { policies: [], middlewares: [] },
    },
  ],
}
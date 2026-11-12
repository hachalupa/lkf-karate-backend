'use strict';

/**
 * exam router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// Writes are admin-only (see global::is-admin). find/findOne stay open so
// students can read scheduled exams for the calendar.
module.exports = createCoreRouter('api::exam.exam', {
  config: {
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

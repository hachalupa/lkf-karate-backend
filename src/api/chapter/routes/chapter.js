'use strict';

/**
 * chapter router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// Writes are admin-only (see global::is-admin).
module.exports = createCoreRouter('api::chapter.chapter', {
  config: {
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

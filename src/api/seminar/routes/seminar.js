'use strict';

/**
 * seminar router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// Reads are for signed-in users; writes are admin-only (see global::is-admin).
module.exports = createCoreRouter('api::seminar.seminar', {
  config: {
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

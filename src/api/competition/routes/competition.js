'use strict';

/**
 * competition router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// Reads are public (landing calendar); writes are admin-only (global::is-admin).
module.exports = createCoreRouter('api::competition.competition', {
  config: {
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

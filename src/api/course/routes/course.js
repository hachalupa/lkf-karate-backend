'use strict';

/**
 * course router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

// Writes are admin-only. The permission layer cannot separate an admin from a
// student (both hold the `authenticated` role), so the gate lives in a policy
// on the write actions while find/findOne stay open to students.
module.exports = createCoreRouter('api::course.course', {
  config: {
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

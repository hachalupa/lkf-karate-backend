'use strict';

const { createId } = require('@paralleldrive/cuid2');

/**
 * `plugin::users-permissions.permission` rows are created through Strapi's
 * legacy query layer — both by this app's bootstrap and inside Strapi's own
 * users-permissions role service (`strapi.db.query(...).create`). That layer
 * does not populate the `document_id` column, so those rows are stored with a
 * null `documentId`.
 *
 * @fourlights/strapi-plugin-deep-populate indexes every visited relation by
 * documentId while walking a `populate=*` graph. A null documentId therefore
 * crashes it with `Cannot read properties of null (reading 'startsWith')` as
 * soon as a request reaches a `user → role → permissions` chain — for example
 * opening a course that has exam attempts or chapter progress. The plugin is
 * also patched defensively (see scripts/patch-deep-populate.js); this helper
 * keeps the underlying data consistent.
 *
 * Idempotent: it backfills only rows whose documentId is still null and returns
 * how many it repaired.
 *
 * @param {object} strapi - the Strapi instance
 * @param {() => string} [generateId] - documentId factory (injectable for tests)
 * @returns {Promise<number>} number of repaired permission rows
 */
async function repairPermissionDocumentIds(strapi, generateId = createId) {
  const permissions = strapi.query('plugin::users-permissions.permission');
  const missing = await permissions.findMany({ where: { documentId: { $null: true } } });

  for (const permission of missing) {
    await permissions.update({
      where: { id: permission.id },
      data: { documentId: generateId() },
    });
  }

  return missing.length;
}

module.exports = { repairPermissionDocumentIds };

'use strict';

/**
 * Relation input normalization.
 *
 * BUG-001 fix (see QA_AUDIT.md): creating or updating a `question` or
 * `chapter` with a `course` relation passed as a documentId string (e.g.
 * `course: "v9x6..."` or `course: { connect: ["v9x6..."] }`) crashes with
 * `Cannot read properties of null (reading 'startsWith')` inside the
 * `@fourlights/strapi-plugin-deep-populate` plugin.
 *
 * Passing the numeric id (e.g. `course: { connect: [{ id: 13 }] }`) works
 * reliably. This helper rewrites documentId strings to numeric ids before the
 * entity service processes the relation, so the admin forms, the DOCX/PDF
 * imports, and any API client keep working unchanged.
 */

async function resolveDocumentId(strapi, contentType, documentId, field) {
  // Prefer the published working copy; fall back to the draft. Without an
  // explicit status, Strapi 5's findOne returns the DRAFT row (publishedAt
  // null) when both copies exist — connecting the draft row silently drops
  // the relation, so we must ask for the published copy explicitly.
  const published = await strapi.documents(contentType).findOne({
    documentId,
    status: 'published',
  });
  if (published) return published.id;

  const draft = await strapi.documents(contentType).findOne({ documentId, status: 'draft' });
  if (draft) return draft.id;

  const err = new Error(`Relation "${field}" not found for documentId "${documentId}"`);
  err.status = 400;
  throw err;
}

/**
 * Normalize a single relation value:
 *   'v9x...'                    -> { connect: [{ id: 13 }] }
 *   { connect: ['v9x...'] }     -> { connect: [{ id: 13 }] }
 *   { connect: [{ id: 13 }] }   -> unchanged
 *   13 / { id: 13 } / null      -> unchanged
 */
async function normalizeRelationValue(strapi, contentType, field, value) {
  if (value == null || typeof value === 'number') return value;

  if (typeof value === 'string') {
    const id = await resolveDocumentId(strapi, contentType, value, field);
    return { connect: [{ id }] };
  }

  if (Array.isArray(value)) {
    // Bare arrays are not a documented Strapi 5 relation input — wrap in
    // { connect: [...] } so the documents service accepts them.
    const out = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        const id = await resolveDocumentId(strapi, contentType, entry, field);
        out.push({ id });
      } else {
        out.push(entry);
      }
    }
    return { connect: out };
  }

  if (value && typeof value === 'object') {
    // Already an explicit numeric id — nothing to do.
    if (value.id != null) return value;

    const out = { ...value };
    for (const op of ['connect', 'set', 'disconnect']) {
      if (!Array.isArray(value[op])) continue;
      out[op] = [];
      for (const entry of value[op]) {
        if (typeof entry === 'string') {
          const id = await resolveDocumentId(strapi, contentType, entry, field);
          out[op].push({ id });
        } else if (entry && typeof entry === 'object' && entry.documentId && entry.id == null) {
          const id = await resolveDocumentId(strapi, contentType, entry.documentId, field);
          out[op].push({ ...entry, id });
        } else {
          out[op].push(entry);
        }
      }
    }
    return out;
  }

  return value;
}

/**
 * Normalize relation fields on a create/update payload.
 *
 * @param {object} strapi
 * @param {object} data - the raw payload (e.g. `data.course`)
 * @param {Record<string, string>} fields - attribute name -> content-type UID
 */
async function normalizeRelations(strapi, data, fields) {
  if (!data || typeof data !== 'object') return data;

  const out = { ...data };
  for (const [field, contentType] of Object.entries(fields)) {
    if (field in out && out[field] !== undefined) {
      out[field] = await normalizeRelationValue(strapi, contentType, field, out[field]);
    }
  }
  return out;
}

module.exports = { normalizeRelations };

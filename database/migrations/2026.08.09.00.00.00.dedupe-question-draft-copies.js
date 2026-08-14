// Strapi Knex migration — Dedupe question draft/published copies
//
// Strapi 5's draftAndPublish model keeps a draft working copy AND a published
// copy as two rows sharing the same document_id. Every REST create defaults to
// status=published, so each question was stored twice (published_at IS NULL
// + published_at set). The question content type is switching to
// draftAndPublish: false, so this migration collapses each pair to a single
// row and removes the orphaned link rows of the deleted drafts.
//
// Which row survives: the published copy (published_at set) — that is what the
// REST API returned by default, so it matches what admins already see. If a
// question ever held unpublished edits in its draft working copy, those are
// discarded; the app never used status=draft for questions, so content is in
// sync between the pairs.

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('questions');
  if (!hasTable) return;

  const hasPublishedAt = await knex.schema.hasColumn('questions', 'published_at');

  // Find document ids that appear more than once
  const dupes = await knex('questions')
    .select('document_id')
    .count('* as c')
    .whereNotNull('document_id')
    .groupBy('document_id')
    .having(knex.raw('count(*) > 1'));

  let removed = 0;

  for (const { document_id } of dupes) {
    // Keep the published row: order drafts last portably.
    // SQLite sorts NULLs last in DESC; Postgres sorts NULLs first in DESC,
    // so `ORDER BY published_at DESC` would keep the WRONG row on Postgres.
    // `(published_at IS NULL) ASC` is 0 for published / 1 for draft on both.
    let query = knex('questions')
      .where({ document_id });

    if (hasPublishedAt) {
      query = query.orderByRaw('(published_at IS NULL) ASC').orderBy('id', 'asc');
    } else {
      query = query.orderBy('id', 'asc');
    }

    const rows = await query;

    const keep = rows[0];
    for (const row of rows.slice(1)) {
      await knex('questions_course_lnk').where({ question_id: row.id }).del();
      await knex('questions_chapter_lnk').where({ question_id: row.id }).del();
      await knex('exams_questions_lnk').where({ question_id: row.id }).del();
      await knex('questions').where({ id: row.id }).del();
      removed++;
    }
  }

  console.log(`[Migration] Removed ${removed} duplicate question draft rows (kept ${dupes.length} documents)`);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  // No rollback — this is a destructive data deduplication
  console.log('[Migration] No rollback for question dedupe migration');
};

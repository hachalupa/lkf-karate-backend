// Strapi Knex migration — Migrate custom `published` field to `published_at`
//
// The course schema previously had a custom boolean `published` field that
// conflicted with Strapi's draftAndPublish system (publishedAt). The field
// was removed from the schema. This migration sets `published_at` for any
// existing courses that had `published = 1` (true) but `published_at IS NULL`.
//
// The `published` column may still exist in the database as an orphaned
// column even though it's no longer in the Strapi schema.

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  // Check if the `published` column exists in the `courses` table
  const hasPublishedColumn = await knex.schema.hasColumn('courses', 'published');

  if (hasPublishedColumn) {
    // Set published_at for courses that were published via the old custom field
    // but don't have published_at set yet. Use knex.fn.now() for cross-DB compat.
    const now = knex.fn.now();
    const result = await knex.raw(`
      UPDATE courses
      SET published_at = COALESCE(created_at, ?)
      WHERE published = 1
        AND published_at IS NULL
    `, [now]);

    // knex.raw with UPDATE returns different shapes per driver;
    // log affected rows if available
    const count = result.changes ?? result.rowCount ?? 0;
    console.log(`[Migration] Updated ${count} courses with published_at from legacy published field`);
  } else {
    console.log('[Migration] No `published` column found on courses table — skipping');
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  // No rollback — this is a data migration
  console.log('[Migration] No rollback for data migration');
};

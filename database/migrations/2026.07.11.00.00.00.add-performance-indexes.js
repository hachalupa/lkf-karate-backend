// Strapi Knex migration — Postgres performance indexes
//
// Strapi v5 stores relationships in separate _lnk join tables rather
// than FK columns on the main tables. These indexes speed up the
// JOIN queries used by Strapi's populate/where filters.
//
// SQLite does not require these indexes for small-to-medium datasets,
// but they become important for production Postgres deployments.
//
// Apply: Strapi auto-runs migrations in database/migrations/ on startup.
// Manual: npx knex migrate:latest --knexfile config/knexfile.js

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  // ── exam_attempts _lnk tables ──────────────────────────────────────────

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_lnk_user
    ON exam_attempts_user_lnk (user_id);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_lnk_exam
    ON exam_attempts_exam_lnk (exam_id);
  `);

  // exam_attempts.submitted_at — used in dashboard time-range queries
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_submitted_at
    ON exam_attempts (submitted_at);
  `);

  // ── chapter_progresses _lnk tables ─────────────────────────────────────

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_chapter_progress_user_lnk_user
    ON chapter_progresses_users_permissions_user_lnk (user_id);
  `);

  // ── exams ──────────────────────────────────────────────────────────────

  // exams.open_at — used for "upcoming exam" dashboard query (sorted asc)
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_exams_open_at
    ON exams (open_at);
  `);

  // ── questions _lnk tables ──────────────────────────────────────────────

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_questions_course_lnk_course
    ON questions_course_lnk (course_id);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_questions_chapter_lnk_chapter
    ON questions_chapter_lnk (chapter_id);
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_exam_attempts_user_lnk_user');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_exam_attempts_exam_lnk_exam');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_exam_attempts_submitted_at');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_chapter_progress_user_lnk_user');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_exams_open_at');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_questions_course_lnk_course');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_questions_chapter_lnk_chapter');
};

// Strapi Knex migration — Create the exam-question-decision + grading-audit-log tables
//
// Background:
// The content types `api::exam-question-decision.exam-question-decision` and
// `api::grading-audit-log.grading-audit-log` were added to src/api/ while the
// database already existed. Strapi's schema metadata (strapi_database_schema)
// was updated to expect their tables, but the physical tables were never
// created — every boot reported "Schema unchanged" and any query touching the
// Question ↔ ExamQuestionDecision relation crashed with:
//   SqliteError: no such table: exam_question_decisions
//
// This migration creates the missing tables (and their _lnk join tables)
// idempotently with the exact names/columns/indexes/foreign keys Strapi's own
// schema builder would produce, so the subsequent automatic schema sync finds
// everything consistent and does not attempt ALTERs.
//
// Column structure mirrors the stored Strapi schema metadata and the existing
// tables (e.g. exam_attempts) for the same relation shapes:
//   - main tables: id, document_id, columns, created_at/updated_at/published_at,
//     created_by_id/updated_by_id, locale
//   - manyToOne link tables: id, <singularName>_id, <target>_id[, <singularName>_ord]
//     plus fk / ifk / uq / oifk indexes named after the table.
//
// Dialect notes:
//   - `recalculated_attempts` is jsonb in the metadata; Postgres gets jsonb,
//     SQLite gets json (SQLite has no jsonb — Strapi's own DDL maps jsonb to
//     json there).
//   - SQLite does not enforce FK constraints by default; the constraints are
//     still declared for consistency with Strapi's builder output.
//
// Rollback: dropping the tables is safe (they only exist for new grading data)
// but intentionally not implemented — mirrors the other non-reversible
// migrations in this folder.

const MAIN_TABLES = [
  {
    name: 'exam_question_decisions',
    singular: 'exam_question_decision',
    columns: [
      { name: 'decision', type: 'string' },
      { name: 'field_index', type: 'integer' },
    ],
    links: [
      { suffix: 'exam', target: 'exams', ord: true },
      { suffix: 'question', target: 'questions', ord: true },
      { suffix: 'changed_by', target: 'up_users', ord: false },
    ],
  },
  {
    name: 'grading_audit_logs',
    singular: 'grading_audit_log',
    columns: [
      { name: 'old_decision', type: 'string' },
      { name: 'new_decision', type: 'string' },
      { name: 'field_index', type: 'integer' },
      { name: 'recalculated_attempts', type: 'jsonb' },
    ],
    links: [
      { suffix: 'admin', target: 'up_users', ord: false },
      { suffix: 'exam', target: 'exams', ord: false },
      { suffix: 'question', target: 'questions', ord: false },
    ],
  },
];

const isPostgres = (knex) =>
  ['pg', 'postgres', 'postgresql'].includes(String(knex.client.config.client).toLowerCase());

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const pg = isPostgres(knex);

  for (const table of MAIN_TABLES) {
    const main = table.name;
    const base = table.singular;

    if (!(await knex.schema.hasTable(main))) {
      await knex.schema.createTable(main, (t) => {
        t.increments('id');
        t.string('document_id');
        for (const col of table.columns) {
          if (col.type === 'jsonb') {
            if (pg) t.jsonb(col.name);
            else t.json(col.name);
          } else if (col.type === 'integer') {
            t.integer(col.name);
          } else {
            t.string(col.name);
          }
        }
        t.datetime('created_at', { useTz: false, precision: 6 });
        t.datetime('updated_at', { useTz: false, precision: 6 });
        t.datetime('published_at', { useTz: false, precision: 6 });
        t.integer('created_by_id').unsigned();
        t.integer('updated_by_id').unsigned();
        t.string('locale');
      });

      await knex.schema.raw(
        `CREATE INDEX \`${main}_documents_idx\` ON \`${main}\` (\`document_id\`, \`locale\`, \`published_at\`)`
      );
      await knex.schema.raw(
        `CREATE INDEX \`${main}_created_by_id_fk\` ON \`${main}\` (\`created_by_id\`)`
      );
      await knex.schema.raw(
        `CREATE INDEX \`${main}_updated_by_id_fk\` ON \`${main}\` (\`updated_by_id\`)`
      );
    }

    for (const link of table.links) {
      const lnk = `${main}_${link.suffix}_lnk`;
      if (await knex.schema.hasTable(lnk)) continue;

      await knex.schema.createTable(lnk, (t) => {
        t.increments('id');
        t.integer(`${base}_id`).unsigned();
        const targetCol =
          link.suffix === 'changed_by' || link.suffix === 'admin'
            ? 'user_id'
            : `${link.suffix}_id`;
        t.integer(targetCol).unsigned();
        if (link.ord) t.double(`${base}_ord`).unsigned();
      });

      const fkCol =
        link.suffix === 'changed_by' || link.suffix === 'admin'
          ? 'user_id'
          : `${link.suffix}_id`;

      await knex.schema.raw(`CREATE INDEX \`${lnk}_fk\` ON \`${lnk}\` (\`${base}_id\`)`);
      await knex.schema.raw(`CREATE INDEX \`${lnk}_ifk\` ON \`${lnk}\` (\`${fkCol}\`)`);
      await knex.schema.raw(
        `CREATE UNIQUE INDEX \`${lnk}_uq\` ON \`${lnk}\` (\`${base}_id\`, \`${fkCol}\`)`
      );
      if (link.ord) {
        await knex.schema.raw(
          `CREATE INDEX \`${lnk}_oifk\` ON \`${lnk}\` (\`${base}_ord\`)`
        );
      }
    }
  }

  console.log('[Migration] Ensured exam_question_decisions + grading_audit_logs tables exist');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  console.log('[Migration] No rollback for grading-table creation migration');
};
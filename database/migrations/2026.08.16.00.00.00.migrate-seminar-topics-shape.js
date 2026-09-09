// Strapi Knex migration — Convert legacy seminar `topics` keys to agenda rows
//
// Seminars used to store preset topic keys (['kata_theory', 'kumite_practice'])
// with labels resolved on the frontend from the i18n `topics.<key>` block. The
// `topics` field is now the seminar agenda: an array of { text, hours } rows —
// one row per session (e.g. "praktiskais Kata uzdevumi" + "2").
//
// This migration rewrites any rows that still hold plain-string keys into the
// new shape, resolving each key to its Latvian label (the federation's working
// language — the new shape stores one free-text label per row). Rows already
// in the new shape ({ text, hours }) are left untouched, so the migration is
// safe to re-run. Rows with null/empty topics are skipped.

const TOPIC_LABELS = {
  kata_theory: 'Katas teorija',
  kata_practice: 'Katas prakse',
  kumite_theory: 'Kumites teorija',
  kumite_practice: 'Kumites prakse',
  secretary: 'Sekretariāta darbs',
  refereeing: 'Tiesnešu darbs',
  competition_organisation: 'Sacensību organizēšana',
  other: 'Cits',
}

// Strapi stores JSON attributes as JSONB on Postgres (knex returns parsed
// values) and as TEXT on SQLite (knex returns the raw string).
const parseTopics = (raw) => {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

// Returns the converted array, or null when nothing changed.
const convertTopics = (topics) => {
  if (!Array.isArray(topics)) return null
  const next = topics.map((topic) => {
    // Legacy rows: plain i18n keys ('kata_theory', ...)
    if (typeof topic === 'string') {
      return { text: TOPIC_LABELS[topic] || topic, hours: '' }
    }
    // New rows: { text, hours } — keep as-is
    if (topic && typeof topic === 'object' && topic.text) {
      return topic
    }
    return topic
  })
  return JSON.stringify(next) === JSON.stringify(topics) ? null : next
}

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('seminars')
  if (!hasTable) return

  const hasTopics = await knex.schema.hasColumn('seminars', 'topics')
  if (!hasTopics) return

  const isSqlite = String(knex.client.config.client || '').includes('sqlite')
  const rows = await knex('seminars').select('id', 'topics')

  let updated = 0
  for (const row of rows) {
    const converted = convertTopics(parseTopics(row.topics))
    if (!converted) continue
    await knex('seminars').where({ id: row.id }).update({
      topics: isSqlite ? JSON.stringify(converted) : converted,
    })
    updated++
  }

  console.log(`[Migration] Converted seminar topics to agenda rows for ${updated} row(s)`)
}

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  // No rollback — one-way shape conversion; the text is already free-form.
  console.log('[Migration] No rollback for seminar topics migration')
}

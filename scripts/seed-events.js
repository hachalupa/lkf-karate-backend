'use strict';

/**
 * Seed script to create test seminars and competitions for the calendar.
 *
 * Generates events for the current month and the 3 following months, so the
 * calendar always has fresh content. Idempotent per month: each event slug
 * includes the year-month, so re-running only adds new (future) months.
 *
 * Usage:
 *   cd backend
 *   node scripts/seed-events.js
 */

const pad = (n) => String(n).padStart(2, '0');

const COMPETITIONS = [
  { title: 'Latvijas Grand Prix', rating: 'International', days: 3 },
  { title: 'Rīgas atklātais čempionāts', rating: 'LV', days: 1 },
  { title: 'Baltijas kauss', rating: 'EKF', days: 2 },
  { title: 'Jauniešu līga', rating: 'LV', days: 1 },
];

// Strapi v5 time fields require seconds (HH:mm:ss.SSS) — use HH:mm:ss.
const SEMINARS = [
  { title: 'Kata seminārs', type: 'Practical Kata', timeFrom: '10:00:00', timeTo: '16:00:00' },
  { title: 'Tiesnešu seminārs', type: 'Teoretical Kumite', timeFrom: '17:00:00', timeTo: '20:00:00' },
  { title: 'Kumite seminārs', type: 'Practical Kumite', timeFrom: '10:00:00', timeTo: '15:00:00' },
  { title: 'Sekretāru apmācības', type: 'Secretary', timeFrom: '09:00:00', timeTo: '13:00:00' },
];

const PLACES = [
  { country: 'Latvia', city: 'Rīga', address: 'Skanstes iela 21, Arēna Rīga' },
  { country: 'Latvia', city: 'Rīga', address: 'Krišjāņa Barona iela 99, Olimpiskais sporta centrs' },
  { country: 'Latvia', city: 'Rīga', address: 'Ganību dambis 30, LKF mācību telpa' },
];

// Latvian diacritics → ASCII so slugs stay readable (ā → a, š → s, ...).
const TRANSLIT = {
  ā: 'a', ē: 'e', ī: 'i', ū: 'u', ō: 'o', ģ: 'g', ķ: 'k', ļ: 'l', ņ: 'n', š: 's', ž: 'z', č: 'c',
};
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[āēīūōģķļņšžč]/g, (ch) => TRANSLIT[ch])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Build test events for the month at `offset` from today. */
function buildMonth(offset) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = base.getFullYear();
  const m = base.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const day = (n) => Math.min(Math.max(1, n), daysInMonth);
  const ym = `${y}-${pad(m + 1)}`;
  const iso = (d) => `${ym}-${pad(day(d))}`;
  const idx = ((offset % 4) + 4) % 4;

  const compA = COMPETITIONS[idx];
  const compB = COMPETITIONS[(idx + 1) % 4];
  const semA = SEMINARS[idx];
  const semB = SEMINARS[(idx + 1) % 4];

  // `kind` discriminates the content type — `type` is the seminar enum field,
  // so they must not share a key (the enum would overwrite the discriminator).
  return [
    {
      kind: 'competition',
      slug: `${slugify(compA.title)}-${ym}`,
      title: compA.title,
      place: PLACES[0],
      date_from: iso(10),
      date_to: iso(10 + compA.days - 1),
      rating: compA.rating,
    },
    {
      kind: 'competition',
      slug: `${slugify(compB.title)}-${ym}`,
      title: compB.title,
      place: PLACES[1],
      date_from: iso(22),
      date_to: compB.days > 1 ? iso(22 + compB.days - 1) : null,
      rating: compB.rating,
    },
    {
      kind: 'seminar',
      slug: `${slugify(semA.title)}-${ym}`,
      title: semA.title,
      place: PLACES[2],
      date: iso(14),
      time_from: semA.timeFrom,
      time_to: semA.timeTo,
      type: semA.type,
    },
    {
      kind: 'seminar',
      slug: `${slugify(semB.title)}-${ym}`,
      title: semB.title,
      place: PLACES[(idx + 2) % 3],
      date: iso(26),
      time_from: semB.timeFrom,
      time_to: semB.timeTo,
      type: semB.type,
    },
  ];
}

async function seedEvents() {
  console.log('Seeding seminars & competitions...');

  // Current month + the 3 following months
  const events = [0, 1, 2, 3].flatMap(buildMonth);

  let created = 0;
  let skipped = 0;

  for (const event of events) {
    const uid = event.kind === 'competition'
      ? 'api::competition.competition'
      : 'api::seminar.seminar';

    const existing = await strapi.documents(uid).findFirst({
      filters: { slug: event.slug },
    });

    if (existing) {
      console.log(`  ⏩ ${event.kind} "${event.title}" (${event.slug}) already exists, skipping.`);
      skipped++;
      continue;
    }

    const { kind, ...data } = event;
    const doc = await strapi.documents(uid).create({
      data,
      // Strapi v5: publishing is done via the `status` param (publishedAt in
      // data is stripped by the document service).
      status: 'published',
    });

    console.log(`  ✅ ${kind} "${event.title}" created (${doc.id})`);
    created++;
  }

  console.log(`Done — ${created} created, ${skipped} skipped.`);
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await seedEvents();
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

'use strict';

/**
 * Seed script to create test exams for the calendar.
 *
 * Creates a few exams with openAt/closeAt spread over the current and next
 * months, linked to the first available course. Idempotent: an exam with the
 * same title + openAt is skipped on re-runs.
 *
 * Usage:
 *   cd backend
 *   node scripts/seed-exams.js
 */

const pad = (n) => String(n).padStart(2, '0');

// Exam templates — openAt is offset by month index so they land in different
// months. closeAt is openAt + duration (+ a safety margin).
const EXAM_TEMPLATES = [
  { title: 'Kata pamateksāmens', duration: 30, passingScore: 70, questionCount: 10, showResults: true, day: 8, hour: 10 },
  { title: 'Kumite teorijas eksāmens', duration: 45, passingScore: 60, questionCount: 15, showResults: true, day: 15, hour: 14 },
  { title: 'Tiesnešu kvalifikācijas eksāmens', duration: 60, passingScore: 75, questionCount: 20, showResults: true, day: 22, hour: 17 },
];

async function seedExams() {
  console.log('Seeding exams...');

  const course = await strapi.documents('api::course.course').findFirst();
  if (!course) {
    console.log('  ⚠️ No course found — cannot link exams. Run the course seed first.');
    return;
  }
  console.log(`  Using course: "${course.titleLv || course.title}" (${course.documentId})`);

  // Attach real questions to every exam. Exams deliberately have NO random
  // fallback pool, so a stored questionCount with no selection is a dead end:
  // the student card promises "N questions" and starting the exam then errors.
  const courseQuestions = await strapi.db
    .query('api::question.question')
    .findMany({
      where: { course: { documentId: { $eq: course.documentId } } },
      orderBy: { order: 'asc' },
    })

  if (courseQuestions.length === 0) {
    console.log('  ⚠️ No questions found for this course — exams will get 0 questions.');
  } else {
    console.log(`  Found ${courseQuestions.length} question(s) to draw from.`);
  }

  let created = 0;
  let skipped = 0;

  // Current month + 2 following months
  for (const offset of [0, 1, 2]) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (const tmpl of EXAM_TEMPLATES) {
      const day = Math.min(tmpl.day, daysInMonth);
      // openAt: local time -> ISO UTC (calendar formats it back to local)
      const openAt = new Date(y, m, day, tmpl.hour, 0, 0, 0);
      const closeAt = new Date(openAt.getTime() + (tmpl.duration + 60) * 60 * 1000);

      const existing = await strapi.documents('api::exam.exam').findFirst({
        filters: {
          title: { $eq: tmpl.title },
          openAt: { $eq: openAt.toISOString() },
        },
        populate: ['questions'],
      });

      if (existing) {
        // Repair an exam that an earlier run left promising questions it does
        // not have (a stored questionCount with an empty selection).
        const hasQuestions = (existing.questions || []).length > 0
        if (!hasQuestions && (existing.questionCount || 0) > 0) {
          const repairSelection = courseQuestions.slice(0, tmpl.questionCount)
          await strapi.documents('api::exam.exam').update({
            documentId: existing.documentId,
            data: {
              questionCount: repairSelection.length,
              questions: repairSelection.map((q) => q.documentId),
            },
          })
          console.log(
            `  🔧 "${tmpl.title}" had no questions selected — linked ${repairSelection.length}.`
          )
          continue
        }
        console.log(`  ⏩ "${tmpl.title}" @ ${openAt.toISOString().slice(0, 16)} already exists, skipping.`);
        skipped++;
        continue;
      }

      // Never claim more questions than the course can supply.
      const selected = courseQuestions.slice(0, tmpl.questionCount)

      const doc = await strapi.documents('api::exam.exam').create({
        data: {
          title: tmpl.title,
          duration: tmpl.duration,
          passingScore: tmpl.passingScore,
          questionCount: selected.length,
          showResults: tmpl.showResults,
          openAt: openAt.toISOString(),
          closeAt: closeAt.toISOString(),
          course: course.documentId,
          questions: selected.map((q) => q.documentId),
        },
      });

      console.log(
        `  ✅ "${tmpl.title}" created (${doc.documentId}) with ${selected.length} question(s) @ ${openAt.toISOString().slice(0, 16)}`
      );
      created++;
    }
  }

  console.log(`Done — ${created} created, ${skipped} skipped.`);
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await seedExams();
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

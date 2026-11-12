'use strict';

/**
 * Seed script to create initial courses: Kata, Kumite, Seminar.
 *
 * Usage:
 *   cd backend
 *   node scripts/seed-courses.js
 */

const COURSES = [
  {
    titleLv: 'Kata',
    titleRu: 'Ката',
    titleEn: 'Kata',
    descriptionLv: 'Kata ir formālo kustību secība, kas imitē cīņu pret vairākiem iedomātiem pretiniekiem. Šis kurss aptver pamata un augstākā līmeņa kata tehnikas, vērtēšanas kritērijus un sacensību noteikumus.',
    descriptionRu: 'Ката — это формальная последовательность движений, имитирующая бой с несколькими воображаемыми противниками. Этот курс охватывает базовые и продвинутые техники ката, критерии оценки и правила соревнований.',
    descriptionEn: 'Kata is a formal sequence of movements that simulates fighting multiple imaginary opponents. This course covers basic and advanced kata techniques, judging criteria, and competition rules.',
    category: 'kata',
    slug: 'kata',
  },
  {
    titleLv: 'Kumite',
    titleRu: 'Кумитэ',
    titleEn: 'Kumite',
    descriptionLv: 'Kumite ir brīvā cīņa jeb sparinga forma karatē. Šis kurss aptver kumite noteikumus, punktu skaitīšanas sistēmu, tiesnešu signālus un stratēģijas vērtēšanai.',
    descriptionRu: 'Кумитэ — это форма свободного боя или спарринга в каратэ. Этот курс охватывает правила кумитэ, систему подсчёта очков, сигналы судей и стратегии судейства.',
    descriptionEn: 'Kumite is the free fighting or sparring form of karate. This course covers kumite rules, point scoring system, referee signals, and judging strategies.',
    category: 'kumite',
    slug: 'kumite',
  },
  {
    titleLv: 'Seminārs',
    titleRu: 'Семинар',
    titleEn: 'Seminar',
    descriptionLv: 'Semināru kurss paredzēts karatē tiesnešu kvalifikācijas paaugstināšanai. Ietver jaunākos noteikumus, vērtēšanas standartus un profesionālās attīstības tēmas.',
    descriptionRu: 'Курс семинаров предназначен для повышения квалификации судей каратэ. Включает новейшие правила, стандарты оценки и темы профессионального развития.',
    descriptionEn: 'The seminar course is designed for karate referee qualification improvement. Covers the latest rules, judging standards, and professional development topics.',
    category: 'seminar',
    slug: 'seminar',
  },
];

/**
 * Assert that a course really is published, and fail loudly if it is not.
 *
 * Draft-and-publish stores a course as TWO rows sharing one documentId (a draft
 * working copy + a published version), so a plain read returns the draft row,
 * whose `publishedAt` is always null — see AGENTS.md §5.1. Every lookup below
 * therefore pins `status: 'published'` instead of trusting the first row.
 */
function assertPublished(course, courseData, action) {
  if (!course || !course.publishedAt) {
    throw new Error(
      `Course "${courseData.titleEn}" is still unpublished after ${action} — check this seed.`
    );
  }
}

async function seedCourses() {
  try {
    console.log('Seeding courses...');

    for (const courseData of COURSES) {
      // Only a PUBLISHED course counts as "already there". Reading without a
      // status would find the draft copy of an unpublished course and skip it,
      // leaving the student app showing "0 of 0 courses".
      const published = await strapi.documents('api::course.course').findFirst({
        filters: { slug: courseData.slug },
        status: 'published',
      });

      if (published) {
        console.log(
          `  ⏩ Course "${courseData.titleEn}" already published (ID: ${published.id}), skipping.`
        );
        continue;
      }

      // Nothing published: either nothing exists, or a previous run left a
      // draft behind (Strapi strips `publishedAt` out of `data`, so the old
      // version of this script created unpublished rows).
      const draft = await strapi.documents('api::course.course').findFirst({
        filters: { slug: courseData.slug },
        status: 'draft',
      });

      if (draft) {
        const repaired = await strapi.documents('api::course.course').update({
          documentId: draft.documentId,
          data: {},
          status: 'published',
        });
        assertPublished(
          await strapi.documents('api::course.course').findOne({
            documentId: draft.documentId,
            status: 'published',
          }) || repaired,
          courseData,
          'publishing the draft'
        );
        console.log(`  🔧 Course "${courseData.titleEn}" was an unpublished draft — published.`);
        continue;
      }

      // Publishing goes through the `status` option, NOT through `publishedAt`
      // in `data`: the document service strips that field, which left every
      // course as a draft and made the whole course flow invisible.
      // (seed-events.js documents the same trap.)
      const course = await strapi.documents('api::course.course').create({
        data: courseData,
        status: 'published',
      });

      // Fail loudly rather than silently leaving an un-publishable draft.
      const saved = await strapi.documents('api::course.course').findOne({
        documentId: course.documentId,
        status: 'published',
      });
      assertPublished(saved, courseData, 'creation');

      console.log(`  ✅ Course "${courseData.titleEn}" created + published (ID: ${course.id})`);
    }

    console.log('Done — all courses processed.');
  } catch (error) {
    console.error('Failed to seed courses:', error);
    process.exit(1);
  }
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await seedCourses();
  await app.destroy();

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

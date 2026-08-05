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

async function seedCourses() {
  try {
    console.log('Seeding courses...');

    for (const courseData of COURSES) {
      // Check if a course with this slug already exists
      const existing = await strapi.documents('api::course.course').findFirst({
        filters: { slug: courseData.slug },
      });

      if (existing) {
        console.log(`  ⏩ Course "${courseData.titleEn}" already exists (ID: ${existing.id}), skipping.`);
        continue;
      }

      const course = await strapi.documents('api::course.course').create({
        data: {
          ...courseData,
          publishedAt: new Date().toISOString(),
        },
      });

      console.log(`  ✅ Course "${courseData.titleEn}" created (ID: ${course.id})`);
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

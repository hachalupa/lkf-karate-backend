'use strict';

/**
 * SCRATCH — design-review content only.
 *
 * Adds one chapter (Kata) + five bank questions and links them to the
 * current-month "Kata pamateksāmens" exam so the student course / chapter /
 * quick-quiz / exam pages have real content to review visually.
 *
 * Idempotent: skips anything whose title/text already exists.
 * Local SQLite only. Creates nothing else and deletes nothing.
 *
 * Usage: cd backend && node _cbreview_seed_content.js
 */

const KATA_COURSE_DOC = 'rtpvco0erc8uvagkdfybwfg0'; // seeded "Kata" course
const KATA_EXAM_DOC = 'd2ncusp4bqfkmplqw1ydb7wo'; // seeded current-month Kata exam
const CHAPTER_TITLE = { lv: 'Vispārīgie noteikumi', ru: 'Общие положения', en: 'General provisions' };

const P = (text) => ({ type: 'text', content: `<p>${text}</p>` });

const BLOCKS_LV = [
  P('Karate sacensības notiek saskaņā ar Pasaules Karatē federācijas (WKF) noteikumiem. Tiesnesim ir jāpārzina gan sacensību norise, gan punktu piešķiršanas kārtība.'),
  P('2.1 Tiesnešu pienākumi'),
  P('Katram tiesnesim ir jāieņem savs vietu laukumā pirms cīņas sākuma un jāseko galvenā tiesneša norādēm visas cīņas laikā.'),
  {
    type: 'list',
    items: [
      'Jāziņo par jebkuru pārkāpumu uzreiz pēc tā konstatēšanas.',
      'Jānovērtē tehnika atbilstoši kontroles, distances un laika kritērijiem.',
      'Pēc cīņas jāatgriežas sākuma pozīcijā.',
    ],
  },
  {
    type: 'table',
    content: {
      headers: ['Pārkāpums', 'Sods', 'Piezīme'],
      rows: [
        ['Pārmērīgs kontakts', 'Sodījums', 'Pēc ārsta apskates'],
        ['Zem jostas', 'Sodījums', 'Nav atļauts'],
        ['Atstāšana no laukuma', 'Piezīme', 'Bez tiesneša atļaujas'],
      ],
    },
    caption: '11. tabula — biežākie pārkāpumi',
  },
  { type: 'note', content: 'Kontroles pakāpe vienmēr tiek vērtēta no upura perspektīvas, nevis no izpildītāja nodoma.' },
  P('10.7 Kvalifikācijas zaudēšana'),
  P('Sportists, kurš trīs reizes pārkāpj kontroles noteikumus vienas cīņas laikā, tiek diskvalificēts.'),
];

const BLOCKS_RU = [
  P('Соревнования по карате проводятся в соответствии с правилами Всемирной федерации карате (WKF). Судья обязан знать как ход соревнований, так и порядок начисления баллов.'),
  P('2.1 Обязанности судей'),
  P('Каждый судья обязан занять своё место на площадке до начала поединка и следовать указаниям главного судьи в течение всего поединка.'),
  {
    type: 'list',
    items: [
      'Сообщать о любом нарушении сразу после его обнаружения.',
      'Оценивать технику по критериям контроля, дистанции и времени.',
      'После поединка вернуться в исходную позицию.',
    ],
  },
  {
    type: 'table',
    content: {
      headers: ['Нарушение', 'Наказание', 'Примечание'],
      rows: [
        ['Чрезмерный контакт', 'Предупреждение', 'После осмотра врачом'],
        ['Ниже пояса', 'Предупреждение', 'Не разрешается'],
        ['Выход с площадки', 'Замечание', 'Без разрешения судьи'],
      ],
    },
    caption: 'Таблица 11 — частые нарушения',
  },
  { type: 'note', content: 'Степень контроля всегда оценивается с точки зрения пострадавшего, а не намерения исполнителя.' },
  P('10.7 Лишение квалификации'),
  P('Спортсмен, трижды нарушивший правила контроля в одном поединке, дисквалифицируется.'),
];

const BLOCKS_EN = [
  P('Karate competitions are conducted under World Karate Federation (WKF) rules. A judge must know both how the competition runs and how points are awarded.'),
  P('2.1 Duties of judges'),
  P('Every judge must take their position on the tatami before the bout begins and follow the chief referee for its entire duration.'),
  {
    type: 'list',
    items: [
      'Report any infringement immediately after noticing it.',
      'Assess technique against the criteria of control, distance and timing.',
      'Return to the starting position after the bout.',
    ],
  },
  {
    type: 'table',
    content: {
      headers: ['Infringement', 'Penalty', 'Note'],
      rows: [
        ['Excessive contact', 'Warning', 'After medical examination'],
        ['Below the belt', 'Warning', 'Not permitted'],
        ['Leaving the area', 'Note', "Without the referee's permission"],
      ],
    },
    caption: 'Table 11 — common infringements',
  },
  { type: 'note', content: 'The degree of control is always judged from the victim’s perspective, never from the perpetrator’s intent.' },
  P('10.7 Forfeiture of qualification'),
  P('A competitor who infringes the control rules three times in a single bout is disqualified.'),
];

// Questions — correctAnswer is byte-identical to the option string, per the
// grading rule. LV/RU/EN each carry their own matching option.
const QUESTIONS = [
  {
    order: 1,
    textLv: 'Cik reizes vienā cīņā drīkst pārkāpt kontroles noteikumus, pirms sportists tiek diskvalificēts?',
    textRu: 'Сколько раз в одном поединке можно нарушить правила контроля до дисквалификации?',
    textEn: 'How many times may control rules be infringed in a single bout before disqualification?',
    type: 'single_choice',
    optionsLv: ['Vienu reizi', 'Divas reizes', 'Trīs reizes', 'Neierobežoti'],
    optionsRu: ['Один раз', 'Два раза', 'Три раза', 'Без ограничений'],
    optionsEn: ['Once', 'Twice', 'Three times', 'Without limit'],
    correctAnswer: 'Trīs reizes',
    correctAnswersLv: ['Trīs reizes'],
    correctAnswersRu: ['Три раза'],
    correctAnswersEn: ['Three times'],
  },
  {
    order: 2,
    textLv: 'Vai tiesnesis drīkst novērtēt kontroles pakāpi no izpildītāja nodoma?',
    textRu: 'Может ли судья оценивать степень контроля исходя из намерения исполнителя?',
    textEn: 'May a judge assess the degree of control from the perpetrator’s intent?',
    type: 'yes_no',
    optionsLv: ['true', 'false'],
    optionsRu: ['true', 'false'],
    optionsEn: ['true', 'false'],
    correctAnswer: 'false',
    correctAnswersLv: [],
    correctAnswersRu: [],
    correctAnswersEn: [],
  },
  {
    order: 3,
    textLv: 'Kad tiesnesim jāziņo par konstatēto pārkāpumu?',
    textRu: 'Когда судья должен сообщить об обнаруженном нарушении?',
    textEn: 'When must a judge report an observed infringement?',
    type: 'single_choice',
    optionsLv: ['Pēc cīņas beigām', 'Uzreiz pēc konstatēšanas', 'Tikai pēc galvenā tiesneša jautājuma', 'Nākamajā sacensību dienā'],
    optionsRu: ['После окончания поединка', 'Сразу после обнаружения', 'Только по вопросу главного судьи', 'На следующий день соревнований'],
    optionsEn: ['After the bout ends', 'Immediately after noticing it', 'Only when the chief referee asks', 'The next competition day'],
    correctAnswer: 'Uzreiz pēc konstatēšanas',
    correctAnswersLv: ['Uzreiz pēc konstatēšanas'],
    correctAnswersRu: ['Сразу после обнаружения'],
    correctAnswersEn: ['Immediately after noticing it'],
  },
  {
    order: 4,
    textLv: 'Vai tehnika zem jostas ir atļauta?',
    textRu: 'Разрешена ли техника ниже пояса?',
    textEn: 'Is a technique below the belt permitted?',
    type: 'yes_no',
    optionsLv: ['true', 'false'],
    optionsRu: ['true', 'false'],
    optionsEn: ['true', 'false'],
    correctAnswer: 'false',
    correctAnswersLv: [],
    correctAnswersRu: [],
    correctAnswersEn: [],
  },
  {
    order: 5,
    textLv: 'Kā sauc galvenā tiesneša dotās komandas izpildi pirms cīņas sākuma?',
    textRu: 'Как называется выполнение команд главного судьи перед началом поединка?',
    textEn: 'What is the execution of the chief referee’s commands before a bout called?',
    type: 'open_text',
    optionsLv: [],
    optionsRu: [],
    optionsEn: [],
    correctAnswer: '',
    correctAnswersLv: [],
    correctAnswersRu: [],
    correctAnswersEn: [],
  },
];

// 127.0.0.1, not localhost: Strapi binds IPv4 and Node's fetch prefers ::1.
const BASE = 'http://127.0.0.1:1337/api';

async function api(path, { method = 'GET', jwt, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

async function main() {
  const login = await api('/auth/local', {
    method: 'POST',
    body: { identifier: 'codebuff-review-admin@example.com', password: 'ReviewPass!2026' },
  });
  const jwt = login.jwt;
  console.log('logged in as', login.user.email);

  // ── Chapter (published) ────────────────────────────────────────────────
  const existingChapter = await api(
    `/chapters?filters[chapterKey][$eq]=cbreview-1&status=published`
  ).catch(() => ({ data: [] }));

  let chapterDocId = existingChapter.data?.[0]?.documentId;

  if (chapterDocId) {
    console.log('chapter already exists:', chapterDocId);
  } else {
    const chapter = await api('/chapters', {
      method: 'POST',
      jwt,
      body: {
        data: {
          titleLv: CHAPTER_TITLE.lv,
          titleRu: CHAPTER_TITLE.ru,
          titleEn: CHAPTER_TITLE.en,
          order: 1,
          baseLanguage: 'lv',
          sourceMode: 'manual',
          chapterKey: 'cbreview-1',
          blocksLv: BLOCKS_LV,
          blocksRu: BLOCKS_RU,
          blocksEn: BLOCKS_EN,
          course: { connect: [KATA_COURSE_DOC] },
        },
      },
    });
    chapterDocId = chapter.data.documentId;
    // publish it
    await api(`/chapters/${chapterDocId}?status=published`, {
      method: 'PUT',
      jwt,
      body: { data: { publishedAt: new Date().toISOString() } },
    });
    console.log('chapter created + published:', chapterDocId);
  }

  // ── Questions (question has draftAndPublish:false — no publish needed) ──
  const questionDocIds = [];
  for (const q of QUESTIONS) {
    const found = await api(
      `/questions?filters[order][$eq]=${q.order}&filters[course][documentId][$eq]=${KATA_COURSE_DOC}`
    ).catch(() => ({ data: [] }));
    if (found.data?.length) {
      questionDocIds.push(found.data[0].documentId);
      console.log(`  q${q.order} exists`);
      continue;
    }
    const created = await api('/questions', {
      method: 'POST',
      jwt,
      body: {
        data: {
          order: q.order,
          type: q.type,
          textLv: q.textLv,
          textRu: q.textRu,
          textEn: q.textEn,
          optionsLv: q.optionsLv,
          optionsRu: q.optionsRu,
          optionsEn: q.optionsEn,
          correctAnswer: q.correctAnswer,
          correctAnswers: q.correctAnswersLv,
          sourceLang: 'lv',
          sourceMode: 'manual',
          sourceDocumentKey: 'cbreview-doc-1',
          answerStatus: q.correctAnswer ? 'answered' : 'missing',
          showInChapter: true,
          course: { connect: [KATA_COURSE_DOC] },
          chapter: { connect: [chapterDocId] },
        },
      },
    });
    questionDocIds.push(created.data.documentId);
    console.log(`  ✅ q${q.order} created (${created.data.documentId})`);
  }

  // ── Link the five questions to the current-month Kata exam ─────────────
  await api(`/exams/${KATA_EXAM_DOC}`, {
    method: 'PUT',
    jwt,
    body: {
      data: {
        questionCount: questionDocIds.length,
        questions: { connect: questionDocIds },
      },
    },
  });
  console.log(`linked ${questionDocIds.length} questions to exam ${KATA_EXAM_DOC}`);

  const check = await api(`/exams/${KATA_EXAM_DOC}?populate[questions]=true`);
  console.log(
    'exam now has questions:',
    check.data?.questions?.length ?? check.data?.attributes?.questions?.data?.length ?? '?'
  );
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

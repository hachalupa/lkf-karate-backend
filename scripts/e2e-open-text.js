#!/usr/bin/env node
/**
 * End-to-end integration test for configurable open-text answer fields.
 *
 * Requires the Strapi backend running locally (npm run develop) with the
 * default SQLite database. Creates throwaway users (one admin, two students),
 * an open-text question with 6 example answer fields, a yes/no question, two
 * exams sharing the same questions, submits attempts, grades them per field,
 * and verifies that editing the examples later never changes saved results.
 *
 * Run: npm run test:e2e
 */

const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.API_URL || 'http://localhost:1337/api';
const DB_PATH = path.join(__dirname, '..', '.tmp', 'data.db');
const PASSWORD = 'E2ePassword123!';

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS  ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const okStatus = (s) => s === 200 || s === 201;

// Admins read attempts via /all (findOne enforces ownership even for admins).
async function getAttemptById(token, id) {
  const res = await api('GET', '/exam-attempts/all', { token });
  const list = res.json?.data || [];
  return list.find((a) => a.id === id) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, body } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function rand(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function promoteToAdmin(userId) {
  const db = new Database(DB_PATH);
  db.prepare('UPDATE up_users SET is_admin = 1 WHERE id = ?').run(userId);
  db.close();
}

async function registerUser(username, email, firstName, lastName) {
  const res = await api('POST', '/auth/local/register', {
    body: { username, email, password: PASSWORD },
  });
  if (res.status !== 200) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  // The app sets profile fields via PUT /users/:id after registering.
  await api('PUT', `/users/${res.json.user.id}`, {
    token: res.json.jwt,
    body: { firstName, lastName, verification: 'approved' },
  });
  return { jwt: res.json.jwt, id: res.json.user.id, username };
}

async function main() {
  console.log('\n== Open-text answer fields E2E ==\n');

  const admin = await registerUser(rand('e2e_admin'), `${rand('admin')}@e2e.test`, 'E2E', 'Admin');
  promoteToAdmin(admin.id);
  // Re-login after promotion so the JWT reflects the flag (the backend reads
  // isAdmin from the DB on every request, so the original token also works).
  const adminLogin = await api('POST', '/auth/local', {
    body: { identifier: admin.username, password: PASSWORD },
  });
  check('admin login works', adminLogin.status === 200);
  const adminToken = adminLogin.json.jwt;

  const s1 = await registerUser(rand('e2e_s1'), `${rand('s1')}@e2e.test`, 'E2E', 'Student One');
  const s2 = await registerUser(rand('e2e_s2'), `${rand('s2')}@e2e.test`, 'E2E', 'Student Two');
  const s1Login = await api('POST', '/auth/local', {
    body: { identifier: s1.username, password: PASSWORD },
  });
  const s2Login = await api('POST', '/auth/local', {
    body: { identifier: s2.username, password: PASSWORD },
  });
  const s1Token = s1Login.json.jwt;
  const s2Token = s2Login.json.jwt;

  // ── Course ────────────────────────────────────────────────────────────────
  const courseRes = await api('POST', '/courses', {
    token: adminToken,
    body: {
      data: {
        titleLv: 'E2E open-text course',
        titleEn: 'E2E open-text course',
        titleRu: 'E2E open-text course',
        category: 'kumite',
      },
    },
  });
  check('course created', okStatus(courseRes.status), `${courseRes.status}`);
  const course = courseRes.json.data;

  // ── Questions ─────────────────────────────────────────────────────────────
  const expected = (i) => `Expected answer ${i + 1}`;
  const fields6 = Array.from({ length: 6 }, (_, i) => ({
    expected: expected(i),
  }));

  const qOpenRes = await api('POST', '/questions', {
    token: adminToken,
    body: {
      data: {
        textLv: 'Uzskaiti 6 kritērijus trieciena vērtēšanai kumite',
        textRu: 'Перечисли 6 критериев оценки удара в кумите',
        textEn: 'List 6 criteria for evaluating a strike in kumite',
        type: 'open_text',
        optionsLv: [],
        optionsRu: [],
        optionsEn: [],
        correctAnswer: null,
        answerFieldsLv: fields6,
        answerFieldsRu: fields6,
        answerFieldsEn: fields6,
        course: course.documentId,
      },
    },
  });
  check('open-text question (6 fields) created', okStatus(qOpenRes.status), `${qOpenRes.status}`);
  const qOpen = qOpenRes.json.data;

  const qYesRes = await api('POST', '/questions', {
    token: adminToken,
    body: {
      data: {
        textLv: 'Jā/Nē: kumite ir pieļaujams uzbrukums.',
        textEn: 'True/False: an attack is allowed in kumite.',
        type: 'yes_no',
        optionsLv: ['true', 'false'],
        correctAnswer: 'true',
        course: course.documentId,
      },
    },
  });
  check('yes/no question created', okStatus(qYesRes.status), `${qYesRes.status}`);
  const qYes = qYesRes.json.data;

  // ── Exams ─────────────────────────────────────────────────────────────────
  const makeExam = async (title) => {
    const res = await api('POST', '/exams', {
      token: adminToken,
      body: {
        data: {
          title,
          duration: 30,
          passingScore: 50,
          showResults: false,
          course: { connect: [course.documentId] },
          questions: { set: [qOpen.documentId, qYes.documentId] },
        },
      },
    });
    return res;
  };

  const examARes = await makeExam('E2E Exam A (open text)');
  check('exam A created', okStatus(examARes.status), `${examARes.status}`);
  const examA = examARes.json.data;
  const examBRes = await makeExam('E2E Exam B (control)');
  check('exam B created', okStatus(examBRes.status), `${examBRes.status}`);
  const examB = examBRes.json.data;

  // ── Student 1 starts exam A ───────────────────────────────────────────────
  const startRes = await api('POST', '/exams/start', {
    token: s1Token,
    body: { examId: examA.documentId },
  });
  check('student can start exam A', startRes.status === 200, `${startRes.status}`);
  const started = startRes.json;
  const openQ = started.questions.find((q) => q.type === 'open_text');
  check('open-text question carries answerFieldCount = 6', openQ?.answerFieldCount === 6, JSON.stringify(openQ));
  const leaksExpected =
    JSON.stringify(started.questions).includes('answerFields') ||
    JSON.stringify(started.questions).includes('Expected answer');
  check('no expected answers leaked to the student', !leaksExpected);

  // ── Student 1 submits exam A (some fields empty) ──────────────────────────
  const attemptId = started.attemptId;
  const qidOpen = openQ.id;
  const qidYes = started.questions.find((q) => q.type === 'yes_no').id;

  const submitRes = await api('POST', '/exams/submit', {
    token: s1Token,
    body: {
      attemptId,
      answers: {
        [qidYes]: 'true',
        // 4 of 6 fields filled, 2 empty — must be accepted (empty = 0 pts)
        [qidOpen]: ['crit A', 'crit B', 'crit C', 'crit D', '', ''],
      },
    },
  });
  check('submission with some empty fields accepted', submitRes.status === 200, `${submitRes.status}`);
  // Auto-graded score: 1 yes/no point of 7 possible (open text not yet graded)
  const attemptAfterSubmit = await getAttemptById(adminToken, attemptId);
  check(
    'initial score excludes ungraded open-text points',
    attemptAfterSubmit?.score === Math.round((1 / 7) * 100),
    JSON.stringify(attemptAfterSubmit?.score)
  );

  // ── Admin grades the attempt per field ────────────────────────────────────
  const gradeRes = await api('PUT', `/exam-attempts/grade/${attemptId}`, {
    token: adminToken,
    body: {
      manualGrades: {
        [qidOpen]: { 0: 1, 1: 1, 2: 0, 3: 1, 4: 0, 5: 0 }, // 3 of 6 correct
      },
    },
  });
  check('admin grade accepted', gradeRes.status === 200, `${gradeRes.status}`);
  // 1 (yes/no) + 3 (open text) = 4 of 7 → 57%
  check(
    'score includes open-text points',
    gradeRes.json?.data?.score === Math.round((4 / 7) * 100),
    JSON.stringify(gradeRes.json?.data?.score)
  );
  check('passed recalculated', gradeRes.json?.data?.passed === true, JSON.stringify(gradeRes.json?.data?.passed));

  // ── Student cannot grade ──────────────────────────────────────────────────
  const studentGrade = await api('PUT', `/exam-attempts/grade/${attemptId}`, {
    token: s1Token,
    body: { manualGrades: { [qidOpen]: { 0: 1 } } },
  });
  check('student cannot grade (403)', studentGrade.status === 403, `${studentGrade.status}`);

  // ── Student cannot read another student's attempt ─────────────────────────
  const s2Start = await api('POST', '/exams/start', {
    token: s2Token,
    body: { examId: examB.documentId },
  });
  const s2AttemptId = s2Start.json.attemptId;
  const foreignRead = await api('GET', `/exam-attempts/${s2AttemptId}`, { token: s1Token });
  check('student cannot read another student attempt (403)', foreignRead.status === 403, `${foreignRead.status}`);

  // ── Student 2 submits exam B (control exam) ───────────────────────────────
  const s2qYes = s2Start.json.questions.find((q) => q.type === 'yes_no').id;
  const s2qOpen = s2Start.json.questions.find((q) => q.type === 'open_text').id;
  await api('POST', '/exams/submit', {
    token: s2Token,
    body: {
      attemptId: s2AttemptId,
      answers: {
        [s2qYes]: 'true',
        [s2qOpen]: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
      },
    },
  });
  const s2Grade = await api('PUT', `/exam-attempts/grade/${s2AttemptId}`, {
    token: adminToken,
    body: {
      manualGrades: {
        [s2qOpen]: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, // all 6 correct
      },
    },
  });
  check('exam B attempt graded', s2Grade.status === 200, `${s2Grade.status}`);
  const s2ScoreBefore = s2Grade.json?.data?.score; // 1 + 6 = 7/7 = 100%

  // ── Examples are static: editing them never changes saved results ─────────
  // Scores come from the per-field manual grades saved on the attempt, never
  // from the question-bank example text.
  const reworded = fields6.map((f) => ({ expected: `${f.expected} (reworded)` }));
  const updateQ = await api('PUT', `/questions/${qOpen.documentId}`, {
    token: adminToken,
    body: {
      data: {
        answerFieldsLv: reworded,
        answerFieldsRu: reworded,
        answerFieldsEn: reworded,
      },
    },
  });
  check('question examples updated', okStatus(updateQ.status), `${updateQ.status}`);

  const attemptAfterEdit = await getAttemptById(adminToken, attemptId);
  check(
    'editing examples does not change saved results',
    attemptAfterEdit?.score === Math.round((4 / 7) * 100),
    JSON.stringify(attemptAfterEdit?.score)
  );
  const gradesAfterEdit = attemptAfterEdit?.manualGrades?.[qidOpen];
  check(
    'per-field decisions stay saved',
    gradesAfterEdit?.[0] === 1 && gradesAfterEdit?.[2] === 0,
    JSON.stringify(gradesAfterEdit)
  );

  // The bank stores example reference text only — no correct/incorrect flags.
  const bankQ = await api('GET', `/questions/${qOpen.documentId}`, { token: adminToken });
  const bankField0 = bankQ.json?.data?.answerFieldsLv?.[0];
  check(
    'question bank stores examples without decision flags',
    bankField0?.expected?.includes('(reworded)') && bankField0?.correct === undefined,
    JSON.stringify(bankField0)
  );

  // Exam B attempt is untouched by exam A's example edits.
  const s2AfterEdit = await getAttemptById(adminToken, s2AttemptId);
  check('exam B score unchanged', s2AfterEdit?.score === s2ScoreBefore, `${s2ScoreBefore} -> ${s2AfterEdit?.score}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for (const exam of [examA, examB]) {
    await api('DELETE', `/exams/${exam.documentId}`, { token: adminToken });
  }
  for (const q of [qOpen, qYes]) {
    await api('DELETE', `/questions/${q.documentId}`, { token: adminToken });
  }
  await api('DELETE', `/courses/${course.documentId}`, { token: adminToken });
  for (const u of [admin.id, s1.id, s2.id]) {
    await api('DELETE', `/users/${u}`, { token: adminToken });
  }

  console.log(`\n== E2E result: ${passed} passed, ${failed} failed ==\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E script crashed:', err);
  process.exit(1);
});
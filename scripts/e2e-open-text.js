#!/usr/bin/env node
/**
 * End-to-end integration test for configurable open-text answer fields.
 *
 * Requires the Strapi backend running locally (npm run develop) with the
 * default SQLite database. Creates throwaway users (one admin, two students),
 * an open-text question with 6 answer fields, a yes/no question, two exams
 * sharing the same questions, submits attempts, grades them, changes an
 * answer-bank decision and asserts that only the selected exam is
 * recalculated.
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
    correct: true,
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

  // ── Change answer-bank decision for exam A only ───────────────────────────
  // Field 0 is correct in the bank; flip it to incorrect for exam A.
  const changeRes = await api('PUT', '/exam-attempts/change-answer-decision', {
    token: adminToken,
    body: {
      examDocumentId: examA.documentId,
      questionDocumentId: qOpen.documentId,
      fieldIndex: 0,
      decision: 'incorrect',
    },
  });
  check('change answer decision accepted', changeRes.status === 200, `${changeRes.status}`);
  check('change reports recalculation', changeRes.json?.changed === true, JSON.stringify(changeRes.json));
  check('change reports 1 recalculated attempt', changeRes.json?.recalculatedAttempts === 1, JSON.stringify(changeRes.json?.recalculatedAttempts));

  // Exam A attempt: field 0 now incorrect → 2 open-text points + 1 yes/no = 3/7 = 43%
  const attemptAfter = await getAttemptById(adminToken, attemptId);
  check('exam A score recalculated', attemptAfter?.score === Math.round((3 / 7) * 100), JSON.stringify(attemptAfter?.score));
  check('exam A passed recalculated to false', attemptAfter?.passed === false, JSON.stringify(attemptAfter?.passed));
  const gradesAfter = attemptAfter?.manualGrades?.[qidOpen];
  check('exam A field 0 flipped to incorrect', gradesAfter?.[0] === 0, JSON.stringify(gradesAfter));

  // Exam B attempt must be untouched
  const s2After = await getAttemptById(adminToken, s2AttemptId);
  check('exam B score unchanged', s2After?.score === s2ScoreBefore, `${s2ScoreBefore} -> ${s2After?.score}`);
  const s2GradesAfter = s2After?.manualGrades?.[s2qOpen];
  check('exam B field 0 still correct', s2GradesAfter?.[0] === 1, JSON.stringify(s2GradesAfter));

  // ── Repeating the same change is a no-op ──────────────────────────────────
  const repeatRes = await api('PUT', '/exam-attempts/change-answer-decision', {
    token: adminToken,
    body: {
      examDocumentId: examA.documentId,
      questionDocumentId: qOpen.documentId,
      fieldIndex: 0,
      decision: 'incorrect',
    },
  });
  check('repeated change is a no-op', repeatRes.status === 200 && repeatRes.json?.changed === false, JSON.stringify(repeatRes.json));
  const repeatAttempt = await getAttemptById(adminToken, attemptId);
  check('score not doubled by repeated recalculation', repeatAttempt?.score === Math.round((3 / 7) * 100), JSON.stringify(repeatAttempt?.score));

  // ── Student cannot change answer decisions ────────────────────────────────
  const studentChange = await api('PUT', '/exam-attempts/change-answer-decision', {
    token: s1Token,
    body: {
      examDocumentId: examA.documentId,
      questionDocumentId: qOpen.documentId,
      fieldIndex: 0,
      decision: 'correct',
    },
  });
  check('student cannot change answer decisions (403)', studentChange.status === 403, `${studentChange.status}`);

  // ── Question bank + audit trail ───────────────────────────────────────────
  const bankQ = await api('GET', `/questions/${qOpen.documentId}`, { token: adminToken });
  const bankField0 = bankQ.json?.data?.answerFieldsLv?.[0];
  check('question bank decision updated', bankField0?.correct === false, JSON.stringify(bankField0));

  const db = new Database(DB_PATH, { readonly: true });
  const audit = db
    .prepare('SELECT id, old_decision, new_decision, field_index, recalculated_attempts FROM grading_audit_logs ORDER BY id DESC LIMIT 1')
    .get();
  const auditAdmin = audit
    ? db.prepare('SELECT user_id FROM grading_audit_logs_admin_lnk WHERE grading_audit_log_id = ?').get(audit.id)
    : null;
  const auditExam = audit
    ? db.prepare('SELECT exam_id FROM grading_audit_logs_exam_lnk WHERE grading_audit_log_id = ?').get(audit.id)
    : null;
  const auditQuestion = audit
    ? db.prepare('SELECT question_id FROM grading_audit_logs_question_lnk WHERE grading_audit_log_id = ?').get(audit.id)
    : null;
  db.close();
  check('audit trail written', !!audit, 'no audit row');
  check('audit records old decision', audit?.old_decision === 'correct', JSON.stringify(audit?.old_decision));
  check('audit records new decision', audit?.new_decision === 'incorrect', JSON.stringify(audit?.new_decision));
  check('audit records the admin', auditAdmin?.user_id === admin.id, `${auditAdmin?.user_id} vs ${admin.id}`);
  check('audit links the exam', auditExam?.exam_id === examA.id, `${auditExam?.exam_id} vs ${examA.id}`);
  check('audit links the question', auditQuestion?.question_id === qOpen.id, `${auditQuestion?.question_id} vs ${qOpen.id}`);
  const recalcJson = audit ? JSON.parse(audit.recalculated_attempts || '[]') : [];
  check('audit lists recalculated attempt + scores', recalcJson.length === 1 && typeof recalcJson[0]?.previousScore === 'number' && typeof recalcJson[0]?.newScore === 'number', JSON.stringify(recalcJson));

  const decisionsDb = new Database(DB_PATH, { readonly: true });
  const override = decisionsDb
    .prepare('SELECT id, decision, field_index FROM exam_question_decisions ORDER BY id DESC LIMIT 1')
    .get();
  const overrideChangedBy = override
    ? decisionsDb.prepare('SELECT user_id FROM exam_question_decisions_changed_by_lnk WHERE exam_question_decision_id = ?').get(override.id)
    : null;
  const overrideExam = override
    ? decisionsDb.prepare('SELECT exam_id FROM exam_question_decisions_exam_lnk WHERE exam_question_decision_id = ?').get(override.id)
    : null;
  decisionsDb.close();
  check('exam-specific override record written', override?.decision === 'incorrect' && override?.field_index === 0, JSON.stringify(override));
  check('override tied to exam A', overrideExam?.exam_id === examA.id, JSON.stringify(overrideExam));
  check('override records the admin', overrideChangedBy?.user_id === admin.id, `${overrideChangedBy?.user_id} vs ${admin.id}`);

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
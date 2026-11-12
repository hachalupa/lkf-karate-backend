'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getAnswerFieldCount,
  normalizeOpenTextAnswer,
  getFieldGrades,
  buildFieldGrades,
  autoGradeQuestion,
  getQuestionMaxPoints,
  getQuestionPoints,
  computeScore,
  getExpectedAnswer,
} = require('../src/utils/grading');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Open-text fields hold judge-facing EXAMPLE text only — no decisions.
const openText6 = {
  id: 1,
  type: 'open_text',
  answerFieldsLv: Array.from({ length: 6 }, (_, i) => ({ expected: `A${i}` })),
};

const openText11 = {
  id: 2,
  type: 'open_text',
  answerFieldsLv: Array.from({ length: 11 }, (_, i) => ({ expected: `A${i + 1}` })),
};

const yesNo = { id: 3, type: 'yes_no', correctAnswer: 'true' };
const mc = {
  id: 4,
  type: 'multiple_choice',
  correctAnswers: ['x', 'y'],
};

// ── Field count ──────────────────────────────────────────────────────────────

test('getAnswerFieldCount: 6 configured fields', () => {
  assert.equal(getAnswerFieldCount(openText6), 6);
});

test('getAnswerFieldCount: 11 configured fields', () => {
  assert.equal(getAnswerFieldCount(openText11), 11);
});

test('getAnswerFieldCount: legacy open-text question without config → 1', () => {
  assert.equal(getAnswerFieldCount({ id: 5, type: 'open_text' }), 1);
});

test('getAnswerFieldCount: choice questions → 1', () => {
  assert.equal(getAnswerFieldCount(yesNo), 1);
});

test('getAnswerFieldCount: counts the largest language array (arrays kept in sync)', () => {
  assert.equal(
    getAnswerFieldCount({
      type: 'open_text',
      answerFieldsLv: [{ expected: 'a' }],
      answerFieldsEn: [{ expected: 'a' }, { expected: 'b' }],
    }),
    2,
  );
});

// ── Answer normalization ─────────────────────────────────────────────────────

test('normalizeOpenTextAnswer: legacy string → single-element array', () => {
  assert.deepEqual(normalizeOpenTextAnswer('kata'), ['kata']);
});

test('normalizeOpenTextAnswer: array passes through with strings', () => {
  assert.deepEqual(normalizeOpenTextAnswer(['a', '', 'c']), ['a', '', 'c']);
});

test('normalizeOpenTextAnswer: null/undefined → empty array', () => {
  assert.deepEqual(normalizeOpenTextAnswer(null), []);
  assert.deepEqual(normalizeOpenTextAnswer(undefined), []);
});

// ── Manual grades (legacy + new formats) ────────────────────────────────────

test('getFieldGrades: legacy number grade (single field)', () => {
  assert.deepEqual(getFieldGrades({ 1: 1 }, 1, 1), { 0: 1 });
  assert.deepEqual(getFieldGrades({ 1: 0 }, 1, 1), { 0: 0 });
});

test('getFieldGrades: per-field object', () => {
  const manualGrades = { 1: { 0: 1, 2: 0 } };
  assert.deepEqual(getFieldGrades(manualGrades, 1, 3), { 0: 1, 2: 0 });
});

test('getFieldGrades: missing grade → not reviewed (empty)', () => {
  assert.deepEqual(getFieldGrades({ 1: {} }, 1, 3), {});
});

test('getFieldGrades: invalid values are ignored', () => {
  assert.deepEqual(getFieldGrades({ 1: { 0: 5, 1: '1', 2: 'x' } }, 1, 3), {
    1: 1,
  });
});

// ── Scoring ─────────────────────────────────────────────────────────────────

test('open-text question max points = number of fields', () => {
  assert.equal(getQuestionMaxPoints(openText6), 6);
  assert.equal(getQuestionMaxPoints(openText11), 11);
  assert.equal(getQuestionMaxPoints(yesNo), 1);
});

test('points: all fields correct → max points', () => {
  const manualGrades = { 1: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } };
  assert.equal(getQuestionPoints(openText6, ['a', 'b', 'c', 'd', 'e', 'f'], manualGrades), 6);
});

test('points: some fields incorrect → partial points', () => {
  const manualGrades = { 1: { 0: 1, 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 } };
  assert.equal(getQuestionPoints(openText6, ['a', 'b', 'c', 'd', 'e', 'f'], manualGrades), 4);
});

test('points: unreviewed fields contribute 0, never negative', () => {
  const manualGrades = { 1: { 0: 1 } };
  assert.equal(getQuestionPoints(openText6, ['a', 'b'], manualGrades), 1);
});

test('points: cannot exceed the configured field count', () => {
  // Malicious/legacy grade map with more entries than fields
  const manualGrades = { 1: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } };
  assert.equal(getQuestionPoints(openText6, [], manualGrades), 6);
});

test('points: empty student answer + no grades → 0', () => {
  assert.equal(getQuestionPoints(openText6, ['', '', '', '', '', ''], {}), 0);
});

test('points: question-bank example text never affects the score', () => {
  // Only the saved per-field decisions count. Rewriting the examples must not
  // change an already-graded result.
  const manualGrades = { 1: { 0: 1, 1: 0 } };
  assert.equal(getQuestionPoints(openText6, ['a', 'b'], manualGrades), 1);
  const reworded = {
    ...openText6,
    answerFieldsLv: Array.from({ length: 6 }, (_, i) => ({ expected: `NEW ${i}` })),
  };
  assert.equal(getQuestionPoints(reworded, ['a', 'b'], manualGrades), 1);
});

test('auto-grade: yes/no works as before', () => {
  assert.equal(autoGradeQuestion(yesNo, 'true'), true);
  assert.equal(autoGradeQuestion(yesNo, 'false'), false);
});

test('auto-grade: multiple_choice set equality works as before', () => {
  assert.equal(autoGradeQuestion(mc, ['y', 'x']), true);
  assert.equal(autoGradeQuestion(mc, ['x']), false);
});

test('computeScore: mixed exam includes open-text points in the total', () => {
  const questions = [yesNo, openText6];
  const answers = { 3: 'true', 1: ['a', 'b', 'c', 'd', 'e', 'f'] };
  // yes/no correct (1 pt) + 4 of 6 open-text fields correct
  const manualGrades = { 1: { 0: 1, 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 } };
  const result = computeScore({
    questions,
    answers,
    manualGrades,
    passingScore: 60,
  });
  assert.equal(result.totalPoints, 5);
  assert.equal(result.maxPoints, 7);
  assert.equal(result.score, Math.round((5 / 7) * 100));
  assert.equal(result.passed, result.score >= 60);
});

test('computeScore: empty question list → 0 / not passed (no Infinity)', () => {
  const result = computeScore({ questions: [], answers: {}, manualGrades: {} });
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
});

test('computeScore: legacy manualGrades number format still counts', () => {
  const questions = [openText6];
  const result = computeScore({
    questions,
    answers: { 1: ['a'] },
    manualGrades: { 1: 1 },
    passingScore: 50,
  });
  assert.equal(result.totalPoints, 1);
  assert.equal(result.maxPoints, 6);
});

test('quick-quiz rationale: ungraded open-text always scores 0 even with a full answer', () => {
  // Quick quizzes have no judge, so manualGrades is always empty — this is
  // why quickQuiz() excludes open-text questions from the pool.
  const questions = [openText6];
  const result = computeScore({
    questions,
    answers: { 1: ['A', 'B', 'C', 'D', 'E', 'F'] },
    manualGrades: {},
    passingScore: 50,
  });
  assert.equal(result.totalPoints, 0);
  assert.equal(result.maxPoints, 6);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
});

test('quick-quiz rationale: an all-open-text quiz pool would be entirely unscored', () => {
  const questions = [openText6, openText11];
  const result = computeScore({
    questions,
    answers: {},
    manualGrades: {},
    passingScore: 50,
  });
  assert.equal(result.totalPoints, 0);
  assert.equal(result.maxPoints, 17);
});

test('computeScore: recalculation is idempotent — same grades, same score', () => {
  const base = {
    questions: [yesNo, openText6],
    answers: { 3: 'true', 1: ['a', 'b'] },
    manualGrades: { 1: { 0: 1, 1: 0, 2: 1 } },
    passingScore: 50,
  };
  const first = computeScore(base);
  const second = computeScore(base);
  assert.deepEqual(first, second);
});

// ── Expected (example) answers ──────────────────────────────────────────────

test('getExpectedAnswer: language-aware with Lv → En fallback', () => {
  const q = {
    type: 'open_text',
    answerFieldsLv: [{ expected: 'Latviski' }],
    answerFieldsEn: [{ expected: 'English' }],
  };
  assert.equal(getExpectedAnswer(q, 0, 'lv'), 'Latviski');
  assert.equal(getExpectedAnswer(q, 0, 'en'), 'English');
  assert.equal(getExpectedAnswer(q, 0, 'ru'), 'Latviski'); // falls back to Lv
  assert.equal(getExpectedAnswer(q, 1, 'lv'), '');
});

test('getExpectedAnswer: tolerates legacy entries that still carry a correct flag', () => {
  const q = {
    type: 'open_text',
    answerFieldsLv: [{ expected: 'Legacy', correct: true }],
  };
  assert.equal(getExpectedAnswer(q, 0, 'lv'), 'Legacy');
});

test('buildFieldGrades: only accepts 0/1 per field', () => {
  assert.deepEqual(buildFieldGrades({ 0: 1, 1: 0, 2: '1', 3: 9 }), {
    0: 1,
    1: 0,
    2: 1,
  });
});

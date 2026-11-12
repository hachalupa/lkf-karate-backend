'use strict';

/**
 * Shared grading helpers for open-text answer fields and exam scoring.
 *
 * These functions are PURE (no `strapi` dependency) so they can be unit
 * tested directly and reused by every controller that grades attempts
 * (exam-session.submit, exam-attempt.grade).
 *
 * Data model:
 *  - open-text questions store one entry per expected answer field in
 *    `answerFieldsLv / answerFieldsRu / answerFieldsEn` — each entry is
 *    `{ expected: string }`, a judge-facing EXAMPLE only. The array length IS
 *    the number of answer fields (e.g. 6 or 11). The three language arrays
 *    must stay in sync (the admin editor keeps them equal).
 *  - The examples carry NO correct/incorrect flag: correctness is decided per
 *    student answer during manual grading and stored in `manualGrades`.
 *  - A student's answer to an open-text question is stored in
 *    `answers[questionId]` as an array of strings (one per field). Legacy
 *    attempts stored a plain string — treated as a single field.
 *  - Manual grades are stored in `manualGrades[questionId]`:
 *      legacy: number 1 | 0 (single field)
 *      new:    object { [fieldIndex]: 1 | 0 }  (missing key = not reviewed)
 *
 * Scoring rule: an open-text question is worth exactly one point per answer
 * field (max = field count). Choice / yes-no questions are worth 1 point.
 * The exam percentage = totalPoints / totalMaxPoints * 100.
 */

const ANSWER_FIELD_LANGS = ['Lv', 'Ru', 'En'];

// Does this question use the configurable open-text answer fields?
function isOpenTextQuestion(q) {
  return q?.type === 'open_text';
}

/**
 * Number of answer fields for an open-text question. Falls back to 1 for
 * legacy questions (single expected answer) and for questions where no field
 * config exists. Choice questions always return 1.
 */
function getAnswerFieldCount(q) {
  if (!isOpenTextQuestion(q)) return 1;
  let max = 0;
  for (const lang of ANSWER_FIELD_LANGS) {
    const arr = q?.[`answerFields${lang}`];
    if (Array.isArray(arr) && arr.length > max) max = arr.length;
  }
  return Math.max(1, max);
}

/**
 * Normalize a stored open-text answer into an array of strings.
 * `"text"`        -> ["text"]            (legacy single answer)
 * `["a", "", "c"]` -> ["a", "", "c"]      (new multi-field answer)
 * `null`/undefined -> []
 */
function normalizeOpenTextAnswer(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => (v == null ? '' : String(v)));
  }
  return [String(value)];
}

/**
 * Per-field manual grades for one question, handling legacy and new formats.
 * Returns an object keyed by field index: { 0: 1, 2: 0 }. Missing keys mean
 * the field has not been reviewed (contributes 0 points, not 1).
 */
function getFieldGrades(manualGrades, qid, fieldCount) {
  const out = {};
  const g = manualGrades ? manualGrades[qid] : undefined;
  if (g == null) return out;

  // Legacy single-field format: manualGrades[qid] === 1 | 0
  if (typeof g === 'number' || typeof g === 'string') {
    out[0] = Number(g) === 1 ? 1 : 0;
    return out;
  }

  // New per-field format: manualGrades[qid] = { 0: 1, 1: 0, ... }
  if (typeof g === 'object') {
    for (let i = 0; i < fieldCount; i++) {
      const v = g[i];
      if (v === 1 || v === '1') out[i] = 1;
      else if (v === 0 || v === '0') out[i] = 0;
    }
    return out;
  }

  return out;
}

/**
 * Build a `manualGrades` per-field object from an explicit decision map.
 * `fieldDecisions` = { [fieldIndex]: 1 | 0 }. Only listed fields are marked.
 */
function buildFieldGrades(decisions) {
  const out = {};
  if (!decisions || typeof decisions !== 'object') return out;
  for (const [index, value] of Object.entries(decisions)) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) continue;
    if (value === 1 || value === '1') out[i] = 1;
    else if (value === 0 || value === '0') out[i] = 0;
  }
  return out;
}

/**
 * Auto-grade a non-open-text question (multiple_choice / single_choice /
 * yes_no / aka_ao). Mirrors the pre-existing submit() logic:
 *  - multiple_choice with a non-empty correctAnswers array: set equality.
 *  - otherwise compare the normalized single answer strings.
 */
function autoGradeQuestion(q, userAnswer) {
  if (isOpenTextQuestion(q)) return false;

  const correctAnswers =
    q?.type === 'multiple_choice' &&
    Array.isArray(q.correctAnswers) &&
    q.correctAnswers.length > 0
      ? q.correctAnswers
      : null;

  if (correctAnswers) {
    if (!Array.isArray(userAnswer)) return false;
    const ua = userAnswer.map((v) => String(v)).sort();
    const ex = correctAnswers.map((v) => String(v)).sort();
    if (ua.length !== ex.length) return false;
    return ua.every((v, i) => v === ex[i]);
  }

  if (q?.correctAnswer === undefined || q?.correctAnswer === null) return false;

  return (
    String(userAnswer ?? '').toLowerCase() ===
    String(q.correctAnswer).toLowerCase()
  );
}

/**
 * Points earned for one question (0..max). Open-text questions sum the
 * per-field manual grades (never exceeding the field count); every other
 * type is 1 point when auto-correct, otherwise 0.
 */
function getQuestionPoints(q, userAnswer, manualGrades) {
  if (isOpenTextQuestion(q)) {
    const count = getAnswerFieldCount(q);
    const grades = getFieldGrades(manualGrades, q?.id, count);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      if (grades[i] === 1) sum += 1;
    }
    return Math.min(sum, count);
  }
  return autoGradeQuestion(q, userAnswer) ? 1 : 0;
}

/**
 * Maximum points a question can earn. Open-text = number of answer fields;
 * everything else = 1.
 */
function getQuestionMaxPoints(q) {
  return isOpenTextQuestion(q) ? getAnswerFieldCount(q) : 1;
}

/**
 * Compute the full exam score from the attempt snapshot.
 *
 * @param {object} params
 * @param {Array}  params.questions     - question snapshot stored on the attempt
 * @param {object} params.answers       - student answers keyed by question id
 * @param {object} [params.manualGrades]- manual grades keyed by question id
 * @param {number} [params.passingScore]- exam passing threshold (percent)
 * @returns {{ totalPoints:number, maxPoints:number, score:number, passed:boolean }}
 */
function computeScore({ questions, answers, manualGrades, passingScore = 70 }) {
  const list = Array.isArray(questions) ? questions : [];
  const ans = answers && typeof answers === 'object' ? answers : {};

  let totalPoints = 0;
  let maxPoints = 0;
  for (const q of list) {
    maxPoints += getQuestionMaxPoints(q);
    totalPoints += getQuestionPoints(q, ans[q?.id], manualGrades);
  }

  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const threshold = Number(passingScore) || 0;

  return {
    totalPoints,
    maxPoints,
    score,
    passed: maxPoints > 0 ? score >= threshold : false,
  };
}

/**
 * The example answer (judge reference) for one field, in the requested
 * language, falling back Lv → En.
 */
function getExpectedAnswer(q, fieldIndex, language) {
  if (!isOpenTextQuestion(q)) {
    return language === 'lv' ? q?.correctAnswer || '' : q?.correctAnswer || '';
  }
  const order =
    language === 'ru' ? ['Ru', 'Lv', 'En'] : language === 'en' ? ['En', 'Lv', 'Ru'] : ['Lv', 'En', 'Ru'];
  for (const lang of order) {
    const arr = q?.[`answerFields${lang}`];
    if (Array.isArray(arr) && arr[fieldIndex] != null) {
      const expected = arr[fieldIndex].expected;
      if (expected != null && String(expected).trim() !== '') return String(expected);
    }
  }
  return '';
}

module.exports = {
  isOpenTextQuestion,
  getAnswerFieldCount,
  normalizeOpenTextAnswer,
  getFieldGrades,
  buildFieldGrades,
  autoGradeQuestion,
  getQuestionPoints,
  getQuestionMaxPoints,
  computeScore,
  getExpectedAnswer,
};
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateOpenTextFields,
  stripAnswerFieldDecisions,
} = require('../src/api/question/controllers/question');

// Example text only — the question never stores correct/incorrect decisions.
const fields = (n) =>
  Array.from({ length: n }, (_, i) => ({ expected: `A${i + 1}` }));

// ── Valid payloads ───────────────────────────────────────────────────────────

test('valid: 6 example answer fields in all three languages', () => {
  assert.equal(
    validateOpenTextFields({
      answerFieldsLv: fields(6),
      answerFieldsRu: fields(6),
      answerFieldsEn: fields(6),
    }),
    null,
  );
});

test('valid: 11 configured answer fields', () => {
  assert.equal(validateOpenTextFields({ answerFieldsLv: fields(11) }), null);
});

test('valid: no answer-field config (legacy open-text question)', () => {
  assert.equal(validateOpenTextFields({ type: 'open_text' }), null);
  assert.equal(validateOpenTextFields({}), null);
});

test('valid: legacy decision flags on the payload are ignored, not required', () => {
  assert.equal(
    validateOpenTextFields({
      answerFieldsLv: [
        { expected: 'x', correct: true },
        { expected: 'y', correct: false },
      ],
    }),
    null,
  );
});

// ── Invalid payloads ─────────────────────────────────────────────────────────

test('invalid: answer fields must be arrays', () => {
  assert.ok(validateOpenTextFields({ answerFieldsLv: 'not-an-array' }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: { expected: 'x' } }));
});

test('invalid: language arrays must have the same length', () => {
  assert.ok(
    validateOpenTextFields({
      answerFieldsLv: fields(6),
      answerFieldsEn: fields(5),
    }),
  );
});

test('invalid: zero answer fields rejected', () => {
  assert.ok(validateOpenTextFields({ answerFieldsLv: [] }));
});

test('invalid: more than 50 answer fields rejected', () => {
  assert.ok(validateOpenTextFields({ answerFieldsLv: fields(51) }));
});

test('invalid: entry must be an object with a string expected example', () => {
  assert.ok(validateOpenTextFields({ answerFieldsLv: ['plain string'] }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: [{ correct: true }] }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: [{ expected: 42 }] }));
});

test('null/undefined config treated as absent (legacy question)', () => {
  assert.equal(validateOpenTextFields({ answerFieldsLv: null }), null);
  assert.equal(validateOpenTextFields({ answerFieldsLv: undefined }), null);
});

// ── Sanitization: decisions are stripped before saving ───────────────────────

test('stripAnswerFieldDecisions: keeps only the example text from every language', () => {
  const data = {
    answerFieldsLv: [{ expected: 'lv', correct: false }],
    answerFieldsRu: [{ expected: 'ru', correct: true }],
    answerFieldsEn: [{ expected: 'en' }],
  };
  stripAnswerFieldDecisions(data);
  assert.deepEqual(data.answerFieldsLv, [{ expected: 'lv' }]);
  assert.deepEqual(data.answerFieldsRu, [{ expected: 'ru' }]);
  assert.deepEqual(data.answerFieldsEn, [{ expected: 'en' }]);
  assert.equal('correct' in data.answerFieldsLv[0], false);
});

test('stripAnswerFieldDecisions: non-array config is left untouched', () => {
  const data = { answerFieldsLv: null };
  stripAnswerFieldDecisions(data);
  assert.equal(data.answerFieldsLv, null);
});

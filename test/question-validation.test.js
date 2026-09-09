'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateOpenTextFields } = require('../src/api/question/controllers/question');

const fields = (n) =>
  Array.from({ length: n }, (_, i) => ({ expected: `A${i + 1}`, correct: true }));

// ── Valid payloads ───────────────────────────────────────────────────────────

test('valid: 6 configured answer fields in all three languages', () => {
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
  assert.equal(
    validateOpenTextFields({
      answerFieldsLv: fields(11),
    }),
    null,
  );
});

test('valid: no answer-field config (legacy open-text question)', () => {
  assert.equal(validateOpenTextFields({ type: 'open_text' }), null);
  assert.equal(validateOpenTextFields({}), null);
});

test('valid: mixed correct/incorrect decisions', () => {
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
  assert.ok(validateOpenTextFields({ answerFieldsLv: { expected: 'x', correct: true } }));
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

test('invalid: entry must be an object with expected text and a boolean decision', () => {
  assert.ok(validateOpenTextFields({ answerFieldsLv: ['plain string'] }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: [{ correct: true }] }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: [{ expected: 'x', correct: 'yes' }] }));
  assert.ok(validateOpenTextFields({ answerFieldsLv: [{ expected: 42, correct: true }] }));
});

test('null/undefined config treated as absent (legacy question)', () => {
  assert.equal(validateOpenTextFields({ answerFieldsLv: null }), null);
  assert.equal(validateOpenTextFields({ answerFieldsLv: undefined }), null);
});
'use strict'

/**
 * Language-aware answer grading.
 *
 * The stored `correctAnswer` (and every entry of `correctAnswers`) is
 * byte-identical to one option string in the option array the admin typed —
 * but the student clicks whatever their own UI rendered (`optionsLv`,
 * `optionsRu` or `optionsEn`). Comparing the two strings directly therefore
 * passes only while the reader is on the same language the answer was authored
 * in, and silently fails for everyone else.
 *
 * So the comparison is canonicalised: each value is mapped to the INDEX it
 * occupies inside the question's option arrays, and the indices are compared.
 * An option that is absent in the student's language but present in another
 * still resolves to its index, so a translated option list keeps a stable
 * identity. Values that match no option at all (open text, aka/ao) fall back to
 * a case-insensitive string comparison — the previous behaviour.
 *
 * Do not "simplify" this back to a raw string comparison: that is exactly the
 * bug where a Russian answer to a Latvian-authored question scored zero.
 */

const LANGS = ['Lv', 'Ru', 'En']

const norm = (value) => String(value).trim().toLowerCase()

/** Every option array the question carries, base field first. */
function optionArrays(question) {
  const arrays = []
  if (Array.isArray(question.options)) arrays.push(question.options)
  for (const lang of LANGS) {
    const arr = question[`options${lang}`]
    if (Array.isArray(arr)) arrays.push(arr)
  }
  return arrays
}

/** Index of `value` in the first option array containing it, else -1. */
function indexOfOption(question, value) {
  const target = norm(value)
  for (const arr of optionArrays(question)) {
    const index = arr.findIndex((option) => norm(option) === target)
    if (index !== -1) return index
  }
  return -1
}

/**
 * Canonical token for one answer value: `#<index>` when the value is a known
 * option, otherwise the normalized string itself (so free text can still be
 * compared, and can never collide with an option index).
 */
function canonicalToken(question, value) {
  const index = indexOfOption(question, value)
  return index === -1 ? norm(value) : `#${index}`
}

const toTokenSet = (question, values) =>
  new Set((Array.isArray(values) ? values : [values]).map((v) => canonicalToken(question, v)))

const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/**
 * Is the student's answer correct for this question?
 *
 * Mirrors the two shapes the exam/quiz previously graded:
 *   - `correctAnswers` (multiple select) → set equality
 *   - `correctAnswer`   (single answer)  → one value
 * A question with neither is never counted as correct (unchanged behaviour).
 */
function isCorrect(question, userAnswer) {
  const expectedList =
    Array.isArray(question.correctAnswers) && question.correctAnswers.length > 0
      ? question.correctAnswers
      : null

  if (expectedList) {
    if (isBlank(userAnswer)) return false
    const expected = toTokenSet(question, expectedList)
    const given = toTokenSet(
      question,
      Array.isArray(userAnswer) ? userAnswer : [userAnswer],
    )
    if (expected.size !== given.size) return false
    for (const token of expected) {
      if (!given.has(token)) return false
    }
    return true
  }

  if (question.correctAnswer === undefined || question.correctAnswer === null) {
    return false
  }
  if (isBlank(userAnswer)) return false

  return (
    canonicalToken(question, userAnswer) ===
    canonicalToken(question, question.correctAnswer)
  )
}

module.exports = { isCorrect, indexOfOption, canonicalToken }

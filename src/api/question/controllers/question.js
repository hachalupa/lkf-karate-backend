'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

// Maximum number of configurable answer fields for an open-text question —
// mirrors the admin editor's MAX_ANSWER_FIELDS on the frontend.
const MAX_ANSWER_FIELDS = 50;

// Language-specific answer-field arrays that must stay in sync.
const ANSWER_FIELD_KEYS = ['answerFieldsLv', 'answerFieldsRu', 'answerFieldsEn'];

/**
 * Validate an open-text question's answer-field configuration.
 *
 * Returns an error message string, or null when the payload is valid.
 * Rules:
 *  - answerFieldsLv/Ru/En, when present, must be arrays of { expected, correct }.
 *  - All three arrays must have the same length (1..MAX_ANSWER_FIELDS) so the
 *    field count is identical in every language.
 *  - Each `correct` flag must be a boolean; `expected` must be a string.
 *  - Legacy open-text questions without any answer-field configuration are
 *    allowed (treated as a single field) so old data and the import flows
 *    keep working.
 */
function validateOpenTextFields(data) {
  const present = ANSWER_FIELD_KEYS.filter((key) => data[key] !== undefined && data[key] !== null);
  if (present.length === 0) return null; // legacy / no config → OK

  const invalid = present.filter((key) => !Array.isArray(data[key]));
  if (invalid.length > 0) {
    return `${invalid.join(', ')} must be an array of answer fields`;
  }

  const lengths = [...new Set(present.map((key) => data[key].length))];
  if (lengths.length !== 1) {
    return 'All answer-field language arrays must have the same number of answers';
  }

  const count = lengths[0];
  if (count < 1) {
    return 'An open-text question needs at least one answer field';
  }
  if (count > MAX_ANSWER_FIELDS) {
    return `An open-text question cannot have more than ${MAX_ANSWER_FIELDS} answer fields`;
  }

  for (const key of present) {
    for (let i = 0; i < data[key].length; i++) {
      const entry = data[key][i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return `Answer field ${i + 1} (${key}) must be an object with an expected answer`;
      }
      if (typeof entry.expected !== 'string') {
        return `Answer field ${i + 1} (${key}) needs a text value for the expected answer`;
      }
      if (typeof entry.correct !== 'boolean') {
        return `Answer field ${i + 1} (${key}) needs a correct/incorrect decision`;
      }
    }
  }

  return null;
}

const controllerFactory = createCoreController('api::question.question', ({ strapi }) => ({
  /**
   * Create a question — validates the payload server-side (especially the
   * open-text answer-field configuration) before delegating to the core
   * controller. Client-side checks are never the only line of defense.
   */
  async create(ctx) {
    const data = ctx.request.body?.data ?? ctx.request.body;
    const error = this._validateQuestionPayload(ctx, data);
    if (error) return error;
    return super.create(ctx);
  },

  /**
   * Update a question — same server-side validation as create, so admins
   * cannot save an open-text question with mismatched or missing answer
   * fields even when editing directly through the API.
   */
  async update(ctx) {
    const data = ctx.request.body?.data ?? ctx.request.body;
    const error = this._validateQuestionPayload(ctx, data);
    if (error) return error;
    return super.update(ctx);
  },

  /**
   * Shared payload validation for create/update. Returns a badRequest error
   * response (koa ctx) or null when valid.
   */
  _validateQuestionPayload(ctx, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return ctx.badRequest('Question payload must be an object');
    }
    if (data.type === 'open_text') {
      const error = validateOpenTextFields(data);
      if (error) return ctx.badRequest(error);
    }
    return null;
  },

  /**
   * Admin-only bulk update of yes/no correct answers (the "import without
   * answers → quick quiz" flow).
   *
   * Body: {
   *   courseId: '<courseDocumentId>',
   *   updates: [ { id: 123, correctAnswer: 'true' }, { id: 124, correctAnswer: 'false' } ]
   * }
   *
   * The payload is validated fully before anything is written (all-or-nothing),
   * then all answers are applied inside a single DB transaction.
   */
  async bulkUpdateAnswers(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const adminUser = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { id: user.id } });
    if (!adminUser?.isAdmin) return ctx.forbidden();

    const { courseId, updates } = ctx.request.body || {};

    if (!courseId || typeof courseId !== 'string') {
      return ctx.badRequest('courseId is required');
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      return ctx.badRequest('updates must be a non-empty array');
    }
    if (updates.length > 1000) {
      return ctx.badRequest('Too many updates (max 1000)');
    }

    // Validate every entry before writing anything — nothing is saved unless
    // the whole payload passes.
    for (const u of updates) {
      if (!u || typeof u.id !== 'number' || !Number.isInteger(u.id)) {
        return ctx.badRequest('Each update must include a numeric question id');
      }
      if (u.correctAnswer !== 'true' && u.correctAnswer !== 'false') {
        return ctx.badRequest('correctAnswer must be "true" or "false"');
      }
    }

    const ids = [...new Set(updates.map((u) => u.id))];
    const questions = await strapi.db
      .query('api::question.question')
      .findMany({ where: { id: { $in: ids } }, populate: ['course'] });

    if (questions.length !== ids.length) {
      return ctx.badRequest('One or more questions were not found');
    }

    // All ids must belong to the expected course.
    for (const q of questions) {
      if (q.course?.documentId !== courseId) {
        return ctx.badRequest(
          `Question ${q.id} does not belong to the selected course`,
        );
      }
    }

    const answerByQuestion = new Map(updates.map((u) => [u.id, u.correctAnswer]));

    try {
      // strapi.db.transaction() establishes a transaction context that every
      // query executed inside automatically joins — all-or-nothing on error.
      await strapi.db.transaction(async () => {
        for (const id of ids) {
          await strapi.db
            .query('api::question.question')
            .update({
              where: { id },
              data: {
                correctAnswer: answerByQuestion.get(id),
                // The admin's choice becomes the official answer used by
                // exams/quizzes — mark the question as answered via the quiz.
                answerStatus: 'fromQuiz',
              },
            });
        }
      });
    } catch (err) {
      strapi.log.error('[questions] bulk-update-answers failed:', err);
      return ctx.internalServerError('Failed to save answers');
    }

    return ctx.send({ ok: true, updated: ids.length });
  },
}));

module.exports = controllerFactory;
// Exported for unit tests (the factory only needs strapi when Strapi calls it).
module.exports.validateOpenTextFields = validateOpenTextFields;

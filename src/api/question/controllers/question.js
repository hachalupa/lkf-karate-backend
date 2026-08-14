'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::question.question', ({ strapi }) => ({
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
                // exams/quizzes — mark the question as fully answered.
                answerStatus: 'answered',
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

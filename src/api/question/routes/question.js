'use strict';

/**
 * question router
 *
 * Explicit route list (mirrors the core router) plus a static
 * `PUT /questions/bulk-update-answers` route. The static route MUST be
 * registered before the parametric `PUT /questions/:id` route, otherwise
 * koa-router would swallow "bulk-update-answers" as an `:id` value.
 */
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/questions',
      handler: 'question.find',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'POST',
      path: '/questions',
      handler: 'question.create',
      // Writes are admin-only (global::is-admin). Reads stay open to students.
      config: { policies: ['global::is-admin'], middlewares: [] },
    },
    // Static route before :id routes (koa-router matches in order)
    {
      method: 'PUT',
      path: '/questions/bulk-update-answers',
      handler: 'question.bulkUpdateAnswers',
      // Gated like every other catalogue write. The controller also re-checks
      // isAdmin (AGENTS.md §5), so this is the outer of two locks, not the only
      // one — `scripts/check-authz.js` fails if either the policy or the
      // controller check is removed.
      config: { policies: ['global::is-admin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/questions/:id',
      handler: 'question.findOne',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'PUT',
      path: '/questions/:id',
      handler: 'question.update',
      config: { policies: ['global::is-admin'], middlewares: [] },
    },
    {
      method: 'DELETE',
      path: '/questions/:id',
      handler: 'question.delete',
      config: { policies: ['global::is-admin'], middlewares: [] },
    },
  ],
};

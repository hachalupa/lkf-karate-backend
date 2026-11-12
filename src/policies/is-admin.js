'use strict'

const { errors } = require('@strapi/utils')

/**
 * Server-side admin gate for privileged (write) routes.
 *
 * Why a policy and not a permission grant: admins and students share the
 * `authenticated` role, so the users-permissions layer cannot tell them apart.
 * Granting (or stripping) an action there gates the whole role, which is why
 * the existing admin surface (user CRUD, exam monitoring, grading,
 * bulk-update-answers) is granted to `authenticated` and then re-checked
 * against `isAdmin` server-side. This policy generalises that same check to the
 * core write routes of the catalogue content types.
 *
 * `isAdmin` is a database flag (`up_users.isAdmin`) — it is never read from the
 * request body or from a client-supplied header, and the frontend `AdminRoute`
 * guard is only a convenience, never the authority.
 *
 * Attach it per action, e.g.:
 *   createCoreRouter('api::course.course', {
 *     config: {
 *       create: { policies: ['global::is-admin'] },
 *       update: { policies: ['global::is-admin'] },
 *       delete: { policies: ['global::is-admin'] },
 *     },
 *   })
 */
module.exports = async (ctx, _config, { strapi }) => {
  const user = ctx.state.user
  if (!user) {
    // The permission layer already rejects guests; keep this explicit so the
    // policy is safe even if a route is ever made public by mistake.
    throw new errors.UnauthorizedError()
  }

  const record = await strapi.db
    .query('plugin::users-permissions.user')
    .findOne({ where: { id: user.id }, select: ['id', 'isAdmin'] })

  if (!record?.isAdmin) {
    throw new errors.ForbiddenError('Admin privileges required')
  }

  return true
}

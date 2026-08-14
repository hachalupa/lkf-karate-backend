'use strict'

/**
 * Shared helper: does the authenticated user hold the `isAdmin` flag?
 * Mirrors the check used by the exam-attempt controllers.
 */
async function isAdminUser(ctx) {
  const user = ctx.state.user
  if (!user) return false
  const record = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: user.id },
    select: ['id', 'isAdmin'],
  })
  return !!record?.isAdmin
}

/**
 * Fields that must never be changed by non-admin users via PUT /users/:id.
 * Without this guard the plugin's update controller applies the raw request
 * body, so a student could self-approve (verification: 'approved'), grant
 * themselves admin (isAdmin: true), or change their own role — defeating the
 * verification gate entirely (BUG-004) and enabling privilege escalation.
 */
const PRIVILEGED_FIELDS = ['isAdmin', 'verification', 'rejectionReason', 'role', 'blocked', 'confirmed']

module.exports = (plugin) => {
  // ── BUG-004: verification must default to 'pending' on every creation ────
  // At extension-load time the plugin's auth controller and user service are
  // still empty stubs (only some controllers are populated), so wrapping
  // `auth.register` or `services.user.add` here would be silently discarded.
  // The robust hook is the plugin's own `register` lifecycle: it runs at boot
  // after `strapi.db` is initialized, so we can subscribe a GLOBAL beforeCreate
  // lifecycle on the user content type. This enforces `verification: 'pending'`
  // server-side on EVERY user creation path — REST registration, admin panel,
  // API clients — exactly the guarantee BUG-004 requires.
  //
  // Note: a plugin content-type `lifecycles.js` extension file cannot be used
  // here — this Strapi version's plugin loader only reads
  // `**/content-types/**/schema.json` and `**/strapi-server.js` from the
  // extensions directory, so plugin-CT lifecycle files are never loaded.
  const originalRegister = plugin.register
  plugin.register = async ({ strapi: s }) => {
    await originalRegister({ strapi: s })
    s.db.lifecycles.subscribe({
      beforeCreate(event) {
        if (event.model.uid !== 'plugin::users-permissions.user') return
        const { data } = event.params
        if (!data) return
        // Respect an explicit value (e.g. admin provisioning an approved user),
        // otherwise default to 'pending'. A null/absent value previously let
        // unapproved accounts bypass the frontend ProtectedRoute gate.
        if (data.verification === undefined || data.verification === null) {
          data.verification = 'pending'
        }
      },
    })
  }

  // ── BUG-002: user enumeration / PII lock-down ────────────────────────────
  // The default plugin controllers expose find / findOne / count to any
  // authenticated user (the Authenticated role holds those permissions), so
  // students could list every account and its PII. Permission grants are
  // role-based and admins share the Authenticated role, so the guard has to
  // live in the controller: allow the action, then enforce isAdmin.
  for (const action of ['find', 'findOne', 'count']) {
    const original = plugin.controllers.user[action]
    plugin.controllers.user[action] = async (ctx) => {
      if (!(await isAdminUser(ctx))) return ctx.forbidden()
      return original(ctx)
    }
  }

  // ── BUG-004: harden user updates ─────────────────────────────────────────
  // Non-admins may only update their own profile and must not be able to set
  // privileged fields (verification, isAdmin, rejectionReason, role, blocked,
  // confirmed).
  const originalDestroy = plugin.controllers.user.destroy
  plugin.controllers.user.destroy = async (ctx) => {
    // No user.destroy grant exists today, but the plugin controller has no
    // admin check — guard it the same way so a future grant/route can never
    // let a student delete accounts or probe PII.
    if (!(await isAdminUser(ctx))) return ctx.forbidden()
    return originalDestroy(ctx)
  }
  const originalUpdate = plugin.controllers.user.update
  plugin.controllers.user.update = async (ctx) => {
    const caller = ctx.state.user
    if (!caller) return ctx.unauthorized()

    const admin = await isAdminUser(ctx)
    const targetId = String(ctx.params.id)

    if (!admin && targetId !== String(caller.id)) {
      return ctx.forbidden('You can only update your own profile')
    }

    if (!admin && ctx.request.body && typeof ctx.request.body === 'object') {
      for (const field of PRIVILEGED_FIELDS) {
        delete ctx.request.body[field]
      }
    }

    return originalUpdate(ctx)
  }

  return plugin
}
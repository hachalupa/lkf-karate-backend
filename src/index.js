'use strict'

module.exports = {
  register(/*{ strapi }*/) {},

  bootstrap: async ({ strapi }) => {
    // ── Set the frontend reset password URL in the plugin store ──
    // This ensures forgot-password emails link to the React frontend
    // instead of the Strapi admin panel.
    //
    // The user can override this later in the admin panel at:
    //   Settings → Users & Permissions → Advanced Settings → "Reset password page"
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' })
      const advanced = await pluginStore.get({ key: 'advanced' })

      if (advanced) {
        const defaultResetUrl = '/admin/plugins/users-permissions/auth/reset-password'
        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
        const desiredUrl = `${frontendUrl}/auth/reset-password`

        // Only override if it's still the default admin URL
        if (!advanced.reset_password_url || advanced.reset_password_url === defaultResetUrl) {
          advanced.reset_password_url = desiredUrl
          await pluginStore.set({ key: 'advanced', value: advanced })
          strapi.log.info(`[bootstrap] Reset password URL → ${desiredUrl}`)
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not set reset password URL:', err.message)
    }

    // ── Ensure exam-attempt ownership-scoped routes stay authorized ──
    // GET /exam-attempts/:id uses a custom findOne controller that enforces
    // ownership (users can only read their own attempts). Strapi's permission
    // layer must still allow the action for the Authenticated role, otherwise
    // every request (including the owner's) is rejected with 403 before the
    // controller runs. Grant it idempotently so fresh DBs / resets work too.
    try {
      const action = 'api::exam-attempt.exam-attempt.findOne'
      const authRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authRole) {
        strapi.log.warn('[bootstrap] Authenticated role not found — cannot grant exam-attempt.findOne permission')
      } else {
        // Check the permission is granted specifically to the Authenticated role
        const granted = await strapi
          .query('plugin::users-permissions.permission')
          .findMany({ where: { action, role: authRole.id } })

        if (granted.length === 0) {
          await strapi
            .query('plugin::users-permissions.permission')
            .create({ data: { action, role: authRole.id } })
          strapi.log.info('[bootstrap] Granted exam-attempt.findOne to Authenticated role')
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure exam-attempt.findOne permission:', err.message)
    }

    // ── Allow the admin monitoring action through the permission layer ──
    // GET /exam-attempts/monitoring/:examDocumentId is admin-only; the
    // controller re-checks isAdmin. Grant the action idempotently so fresh
    // DBs / resets work too.
    try {
      const action = 'api::exam-attempt.exam-attempt.monitoring'
      const authRoleForMonitoring = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authRoleForMonitoring) {
        strapi.log.warn('[bootstrap] Authenticated role not found — cannot grant exam-attempt.monitoring permission')
      } else {
        const granted = await strapi
          .query('plugin::users-permissions.permission')
          .findMany({ where: { action, role: authRoleForMonitoring.id } })

        if (granted.length === 0) {
          await strapi
            .query('plugin::users-permissions.permission')
            .create({ data: { action, role: authRoleForMonitoring.id } })
          strapi.log.info('[bootstrap] Granted exam-attempt.monitoring to Authenticated role')
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure exam-attempt.monitoring permission:', err.message)
    }

    // ── Allow the bulk-update-answers action through the permission layer ──
    // PUT /questions/bulk-update-answers uses a custom controller action; the
    // users-permissions layer derives the scope from the action name and
    // rejects requests with 403 unless the Authenticated role holds the
    // permission. Actual admin authorization happens inside the controller
    // (mirrors the exam-attempt findAll/grade grants below). Grant it
    // idempotently so fresh DBs / resets work too.
    try {
      const action = 'api::question.question.bulkUpdateAnswers'
      const authRoleForBulk = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authRoleForBulk) {
        strapi.log.warn('[bootstrap] Authenticated role not found — cannot grant question.bulkUpdateAnswers permission')
      } else {
        const granted = await strapi
          .query('plugin::users-permissions.permission')
          .findMany({ where: { action, role: authRoleForBulk.id } })

        if (granted.length === 0) {
          await strapi
            .query('plugin::users-permissions.permission')
            .create({ data: { action, role: authRoleForBulk.id } })
          strapi.log.info('[bootstrap] Granted question.bulkUpdateAnswers to Authenticated role')
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure question.bulkUpdateAnswers permission:', err.message)
    }

    // ── Public read access to competitions for the landing-page calendar ──
    // Competitions are for everyone (seminars are judges-only), so guests must
    // be able to list them without an account. Grant the Public role the
    // find + findOne actions idempotently so fresh DBs / resets work too.
    try {
      const actions = [
        'api::competition.competition.find',
        'api::competition.competition.findOne',
      ]
      const publicRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } })

      if (!publicRole) {
        strapi.log.warn('[bootstrap] Public role not found — cannot grant competition read permissions')
      } else {
        for (const action of actions) {
          const granted = await strapi
            .query('plugin::users-permissions.permission')
            .findMany({ where: { action, role: publicRole.id } })
          if (granted.length === 0) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: publicRole.id } })
            strapi.log.info(`[bootstrap] Granted ${action} to Public role`)
          }
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure competition read permissions:', err.message)
    }
  },
}
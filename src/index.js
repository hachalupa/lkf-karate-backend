'use strict'

const { createId } = require('@paralleldrive/cuid2')
const { repairPermissionDocumentIds } = require('./utils/permission-document-ids')

module.exports = {
  register(/*{ strapi }*/) {},

  bootstrap: async ({ strapi }) => {
    // ── Backfill documentIds on permissions created by the query layer ──
    // Without a documentId these rows make deep-populate crash (see
    // src/utils/permission-document-ids.js).
    try {
      const repaired = await repairPermissionDocumentIds(strapi)
      if (repaired > 0) {
        strapi.log.info(`[bootstrap] Backfilled documentId for ${repaired} permission(s)`)
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not repair permission documentIds:', err.message)
    }

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
            .create({ data: { documentId: createId(), action, role: authRole.id } })
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
            .create({ data: { documentId: createId(), action, role: authRoleForMonitoring.id } })
          strapi.log.info('[bootstrap] Granted exam-attempt.monitoring to Authenticated role')
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure exam-attempt.monitoring permission:', err.message)
    }

    // ── Allow admin grading actions through the permission layer ──
    // PUT /exam-attempts/grade/:id and GET /exam-attempts/all are admin-only;
    // the controllers re-check isAdmin. Grant idempotently so fresh DBs / resets
    // work too (same pattern as findOne / monitoring / bulkUpdateAnswers).
    try {
      const actions = [
        "api::exam-attempt.exam-attempt.findAll",
        "api::exam-attempt.exam-attempt.grade",
      ];
      const authRoleForGrading = await strapi
        .query("plugin::users-permissions.role")
        .findOne({ where: { type: "authenticated" } });

      if (!authRoleForGrading) {
        strapi.log.warn(
          "[bootstrap] Authenticated role not found — cannot grant grading permissions"
        );
      } else {
        for (const action of actions) {
          const granted = await strapi
            .query("plugin::users-permissions.permission")
            .findMany({ where: { action, role: authRoleForGrading.id } });
          if (granted.length === 0) {
            await strapi
              .query("plugin::users-permissions.permission")
              .create({ data: { documentId: createId(), action, role: authRoleForGrading.id } });
            strapi.log.info(`[bootstrap] Granted ${action} to Authenticated role`);
          }
        }
      }
    } catch (err) {
      strapi.log.warn(
        "[bootstrap] Could not ensure exam-attempt grading permissions:",
        err.message
      );
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
            .create({ data: { documentId: createId(), action, role: authRoleForBulk.id } })
          strapi.log.info('[bootstrap] Granted question.bulkUpdateAnswers to Authenticated role')
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure question.bulkUpdateAnswers permission:', err.message)
    }

    // ── Public read access to seminars + competitions (calendar events) ──
    // The landing page shows competitions to everyone, and seminars are the
    // same kind of public calendar information. Guests must be able to list
    // them without an account — otherwise the calendar 403s the moment one of
    // the collections is empty (Strapi checks the permission before the data).
    // Grant the Public role the find + findOne actions idempotently so fresh
    // DBs / resets work too.
    try {
      const actions = [
        'api::seminar.seminar.find',
        'api::seminar.seminar.findOne',
        'api::competition.competition.find',
        'api::competition.competition.findOne',
      ]
      const publicRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } })

      if (!publicRole) {
        strapi.log.warn('[bootstrap] Public role not found — cannot grant seminar/competition read permissions')
      } else {
        for (const action of actions) {
          const granted = await strapi
            .query('plugin::users-permissions.permission')
            .findMany({ where: { action, role: publicRole.id } })
          if (granted.length === 0) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { documentId: createId(), action, role: publicRole.id } })
            strapi.log.info(`[bootstrap] Granted ${action} to Public role`)
          }
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure seminar/competition read permissions:', err.message)
    }

    // ── Authenticated read access to competitions and seminars ──
    // The grant above only covers the Public role. Strapi evaluates a request
    // that carries a JWT against the Authenticated role ALONE — roles do not
    // inherit — so signed-in users got 403 for competitions even though guests
    // could read them, and seminars had no permission records at all. Because
    // useCalendarEvents() fetches with Promise.all, that single 403 blanked the
    // whole calendar on /dashboard and /events, and made the admin Seminars and
    // Competitions pages dead for everyone.
    //
    // Seminars are judges-only, so they are granted to Authenticated and
    // deliberately NOT to Public (matching the intent above).
    try {
      const calendarActions = [
        'api::competition.competition.find',
        'api::competition.competition.findOne',
        'api::seminar.seminar.find',
        'api::seminar.seminar.findOne',
      ]
      const authRoleForCalendar = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authRoleForCalendar) {
        strapi.log.warn('[bootstrap] Authenticated role not found — cannot grant calendar read permissions')
      } else {
        for (const action of calendarActions) {
          const granted = await strapi
            .query('plugin::users-permissions.permission')
            .findMany({ where: { action, role: authRoleForCalendar.id } })
          if (granted.length === 0) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: authRoleForCalendar.id } })
            strapi.log.info(`[bootstrap] Granted ${action} to Authenticated role`)
          }
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure calendar read permissions:', err.message)
    }

    // ── Seminar / competition writes for the admin panel ──
    // No `api::seminar.*` write records existed at all and competitions had
    // only Public read, so POST/PUT/DELETE from /admin/seminars and
    // /admin/competitions were rejected by the permission layer (403) before
    // any controller or policy could run — the pages were dead on save.
    //
    // These grants are deliberately narrow in intent: the permission layer only
    // decides "may this role reach the route". The real authorization is the
    // `global::is-admin` policy attached to those routes, which rejects any
    // caller whose `isAdmin` flag is not set (admins and students share the
    // `authenticated` role, so the role alone cannot separate them).
    try {
      const writeActions = [
        'api::seminar.seminar.create',
        'api::seminar.seminar.update',
        'api::seminar.seminar.delete',
        'api::competition.competition.create',
        'api::competition.competition.update',
        'api::competition.competition.delete',
      ]
      const authRoleForWrites = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })

      if (!authRoleForWrites) {
        strapi.log.warn('[bootstrap] Authenticated role not found — cannot grant seminar/competition writes')
      } else {
        for (const action of writeActions) {
          const granted = await strapi
            .query('plugin::users-permissions.permission')
            .findMany({ where: { action, role: authRoleForWrites.id } })
          if (granted.length === 0) {
            await strapi
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: authRoleForWrites.id } })
            strapi.log.info(`[bootstrap] Granted ${action} to Authenticated role`)
          }
        }
      }
    } catch (err) {
      strapi.log.warn('[bootstrap] Could not ensure seminar/competition write permissions:', err.message)
    }
  },
}
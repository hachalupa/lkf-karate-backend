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
  },
}
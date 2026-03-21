'use strict'

module.exports = (plugin) => {
  const originalRegister = plugin.controllers.auth.register

  plugin.controllers.auth.register = async (ctx) => {
    await originalRegister(ctx)

    if (ctx.response.status !== 200) return

    const { user } = ctx.response.body
    if (user && user.id) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { verification: 'pending' },
      })
      ctx.response.body.user.verification = 'pending'
    }
  }

  return plugin
}
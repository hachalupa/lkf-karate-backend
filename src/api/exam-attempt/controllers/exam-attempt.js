'use strict'

const { createCoreController } = require('@strapi/strapi').factories

module.exports = createCoreController('api::exam-attempt.exam-attempt', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const attempts = await strapi.db.query('api::exam-attempt.exam-attempt').findMany({
      where: { user: user.id },
      populate: ['exam'],
      orderBy: { createdAt: 'desc' },
    })

    return ctx.send({ data: attempts })
  },

  async findAll(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const adminUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    })

    if (!adminUser?.isAdmin) return ctx.forbidden()

    const attempts = await strapi.db.query('api::exam-attempt.exam-attempt').findMany({
      populate: ['exam', 'user'],
      orderBy: { createdAt: 'desc' },
    })

    return ctx.send({ data: attempts })
  },

  async grade(ctx) {
    const user = ctx.state.user
    if (!user) return ctx.unauthorized()

    const adminUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    })

    if (!adminUser?.isAdmin) return ctx.forbidden()

    const { id } = ctx.params
    const { score, passed } = ctx.request.body

    const updated = await strapi.db.query('api::exam-attempt.exam-attempt').update({
      where: { id },
      data: { score, passed },
    })

    return ctx.send({ data: updated })
  },
}))
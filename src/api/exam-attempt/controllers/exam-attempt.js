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
  }
}))
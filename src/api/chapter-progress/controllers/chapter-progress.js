'use strict'

const { createCoreController } = require('@strapi/strapi').factories

module.exports = createCoreController('api::chapter-progress.chapter-progress', ({ strapi }) => ({
  async find(ctx) {
    try {
        const user = ctx.state.user
        if (!user) return ctx.unauthorized()

        const progress = await strapi.documents('api::chapter-progress.chapter-progress').findMany({
        filters: {
            users_permissions_user: { id: { $eq: user.id } }
        },
        populate: ['chapter'],
        })

        return ctx.send({ data: progress })
    } catch (err) {
        console.error('FIND ERROR:', err.message)
        return ctx.internalServerError(err.message)
    }
    },

  async markSeen(ctx) {
    try {
        const user = ctx.state.user
        if (!user) return ctx.unauthorized()

        const { chapterId } = ctx.request.body
        if (!chapterId) return ctx.badRequest('chapterId is required')

        const existing = await strapi.documents('api::chapter-progress.chapter-progress').findFirst({
        filters: {
            users_permissions_user: { id: { $eq: user.id } },
            chapter: { documentId: { $eq: chapterId } },
        },
        })

        if (existing) {
        return ctx.send({ data: existing })
        }

        const progress = await strapi.documents('api::chapter-progress.chapter-progress').create({
        data: {
            users_permissions_user: user.id,
            chapter: chapterId,
            seen: true,
            seenAt: new Date(),
        },
        })

        return ctx.send({ data: progress })
    } catch (err) {
        console.error('MARK SEEN ERROR:', err.message)
        return ctx.internalServerError(err.message)
    }
    },
}))
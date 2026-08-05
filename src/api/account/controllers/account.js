'use strict'

module.exports = {
  async deleteAccount(ctx) {
    const user = ctx.state.user
    if (!user) {
      return ctx.unauthorized('You must be logged in to delete your account')
    }

    // Delete related exam attempts first
    await strapi.db.query('api::exam-attempt.exam-attempt').deleteMany({
      where: { user: user.id },
    })

    // Delete related chapter progress
    await strapi.db.query('api::chapter-progress.chapter-progress').deleteMany({
      where: { users_permissions_user: user.id },
    })

    // Delete the user's uploaded files (profile picture)
    const userRecord = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
    })
    if (userRecord?.profilePicture) {
      try {
        await strapi.plugin('upload').service('upload').remove({
          id: userRecord.profilePicture.id,
        })
      } catch {
        // Best-effort cleanup
      }
    }

    // Delete the user
    await strapi.db.query('plugin::users-permissions.user').delete({
      where: { id: user.id },
    })

    return ctx.send({ message: 'Account deleted successfully' })
  },
}

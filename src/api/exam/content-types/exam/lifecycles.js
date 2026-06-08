'use strict'

module.exports = {
  async beforeDelete(event) {
    const { where } = event.params

    const exams = await strapi.db.query('api::exam.exam').findMany({
      where,
      select: ['id'],
    })

    if (!exams.length) return

    const examIds = exams.map((exam) => exam.id)

    await strapi.db.query('api::exam-attempt.exam-attempt').deleteMany({
      where: {
        exam: {
          id: {
            $in: examIds,
          },
        },
      },
    })
  },

  async beforeDeleteMany(event) {
    const { where } = event.params

    const exams = await strapi.db.query('api::exam.exam').findMany({
      where,
      select: ['id'],
    })

    if (!exams.length) return

    const examIds = exams.map((exam) => exam.id)

    await strapi.db.query('api::exam-attempt.exam-attempt').deleteMany({
      where: {
        exam: {
          id: {
            $in: examIds,
          },
        },
      },
    })
  },
}
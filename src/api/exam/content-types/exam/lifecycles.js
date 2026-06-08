'use strict'

function toDate(value) {
  return value ? new Date(value) : null
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function validateExamSchedule(data) {
  const openAt = toDate(data.openAt)
  const closeAt = toDate(data.closeAt)
  const durationMinutes = Number(data.duration || 0)

  if (openAt && !isValidDate(openAt)) {
    const err = new Error('OPEN_AT_INVALID')
    err.status = 400
    throw err
  }

  if (closeAt && !isValidDate(closeAt)) {
    const err = new Error('CLOSE_AT_INVALID')
    err.status = 400
    throw err
  }

  if (openAt && closeAt && closeAt <= openAt) {
    const err = new Error('CLOSE_BEFORE_OPEN')
    err.status = 400
    throw err
  }

  if (openAt && closeAt && durationMinutes > 0) {
    const examEndsAt = new Date(openAt.getTime() + durationMinutes * 60 * 1000)
    if (closeAt < examEndsAt) {
      const err = new Error('CLOSE_BEFORE_DURATION_END')
      err.status = 400
      throw err
    }
  }
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params
    validateExamSchedule(data)
  },

  async beforeUpdate(event) {
    const { data } = event.params

    const existing = await strapi.db.query('api::exam.exam').findOne({
      where: { id: event.params.where.id },
      select: ['openAt', 'closeAt', 'duration'],
    })

    validateExamSchedule({
      openAt: data.openAt ?? existing?.openAt,
      closeAt: data.closeAt ?? existing?.closeAt,
      duration: data.duration ?? existing?.duration,
    })
  },
  
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
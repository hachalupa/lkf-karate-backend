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

/**
 * How many questions does this exam end up with?
 *
 * Returns `null` when the payload says nothing about the selection, so the
 * caller can fall back to what is already stored instead of assuming "none" —
 * an update that only touches `questionCount` must not be mistaken for an exam
 * whose questions were removed.
 */
async function countSelectedQuestions(data, existingId) {
  const relation = data.questions

  if (Array.isArray(relation)) return relation.length

  if (relation && typeof relation === 'object') {
    // Document-service relation operators.
    if (Array.isArray(relation.set)) return relation.set.length
    if (Array.isArray(relation.connect) || Array.isArray(relation.disconnect)) {
      const current = await countStoredQuestions(existingId)
      const connected = Array.isArray(relation.connect) ? relation.connect.length : 0
      const disconnected = Array.isArray(relation.disconnect)
        ? relation.disconnect.length
        : 0
      return Math.max(0, current - disconnected + connected)
    }
  }

  return null
}

async function countStoredQuestions(examId) {
  if (!examId) return 0
  const exam = await strapi.db.query('api::exam.exam').findOne({
    where: { id: examId },
    populate: ['questions'],
  })
  return (exam?.questions || []).length
}

/**
 * An exam may not promise questions it does not have.
 *
 * A stored `questionCount` with an empty selection is a dead end: the student
 * card advertises "N questions", and starting the exam then fails because exams
 * have no random fallback pool by design (AGENTS §5.8). Reject the write here
 * rather than letting the admin panel save an exam nobody can take.
 */
async function validateQuestionSelection(data, existingId) {
  const questionCount = Number(data.questionCount || 0)
  if (questionCount <= 0) return

  const selected = await countSelectedQuestions(data, existingId)
  // No information about the selection in this payload — check what is stored.
  const effective = selected === null ? await countStoredQuestions(existingId) : selected

  if (effective === 0) {
    const err = new Error('EXAM_QUESTIONS_REQUIRED')
    err.status = 400
    throw err
  }
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params
    validateExamSchedule(data)
    await validateQuestionSelection(data, null)
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

    await validateQuestionSelection(data, event.params.where.id)
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
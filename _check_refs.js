'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  // Questions attached to chapters (all)
  const q = await app.db.query('api::question.question').findMany({ populate: ['chapter', 'course'] })
  console.log('QUESTIONS total:', q.length)
  for (const x of q.slice(0, 10)) console.log('  q', x.id, '| course:', x.course ? x.course.documentId : '-', '| chapter:', x.chapter ? x.chapter.documentId : '-')

  const cp = await app.db.query('api::chapter-progress.chapter-progress').count({})
  console.log('CHAPTER_PROGRESS total:', cp)

  const chAll = await app.db.query('api::chapter.chapter').count({})
  console.log('CHAPTERS total:', chAll)
  await app.destroy()
  process.exit(0)
}
main().catch(e => { console.error('ERR', e); process.exit(1) })

'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  const chs = await app.db.query('api::chapter.chapter').findMany({ populate: ['course'] })
  const noCourse = chs.filter(c => !c.course)
  console.log('CHAPTERS without course:', noCourse.length)
  for (const c of noCourse.slice(0, 15)) console.log('  -', c.documentId, c.chapterKey, (c.titleLv || c.titleEn || '').slice(0, 40))

  // Block composition of old kata-course chapters (the misplaced kumite ones)
  const kata = await app.db.query('api::course.course').findOne({
    where: { documentId: 'v9x6cil79cpu5fzie9m0yep2' },
    populate: ['chapters'],
  })
  let img = 0, tab = 0, txt = 0, lst = 0, total = 0
  for (const ch of (kata.chapters || [])) {
    for (const b of (ch.blocksEn || [])) {
      total++
      if (b.type === 'image' && (b.media || b.file || b.url)) img++
      else if (b.type === 'image') img++
      if (b.type === 'table') tab++
      if (b.type === 'text') txt++
      if (b.type === 'list') lst++
    }
  }
  console.log(`\nKATA-course chapters: ${(kata.chapters||[]).length}, blocksEn total:${total} text:${txt} list:${lst} table:${tab} image:${img}`)
  await app.destroy()
  process.exit(0)
}
main().catch(e => { console.error('ERR', e); process.exit(1) })

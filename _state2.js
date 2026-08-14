'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  const chs = await app.db.query('api::chapter.chapter').findMany({ populate: ['course'] })
  const byCourse = new Map()
  for (const c of chs) {
    const key = c.course ? `${c.course.titleEn}|${c.course.documentId}` : 'NO-COURSE'
    if (!byCourse.has(key)) byCourse.set(key, [])
    byCourse.get(key).push(c)
  }
  for (const [k, list] of byCourse) {
    console.log(`COURSE ${k} -> ${list.length} chapter rows`)
    for (const c of list.slice(0, 60)) {
      console.log('   ', c.id, c.documentId, '|', c.chapterKey, '|', (c.titleEn || c.titleLv || '').slice(0, 45), '| src:', (c.sourceFile || '-').slice(0, 30))
    }
  }

  const progs = await app.db.query('api::chapter-progress.chapter-progress').findMany({ populate: ['chapter'] })
  const byCh = new Map()
  for (const p of progs) {
    const key = p.chapter ? `${p.chapter.documentId} (${p.chapter.chapterKey})` : 'NO-CH' 
    if (!byCh.has(key)) byCh.set(key, 0)
    byCh.set(key, byCh.get(key) + 1)
  }
  console.log('\nCHAPTER_PROGRESS distribution (31 total):')
  for (const [k, n] of byCh) console.log('  ', n, 'x', k)
  await app.destroy()
  process.exit(0)
}
main().catch(e => { console.error('ERR', e); process.exit(1) })

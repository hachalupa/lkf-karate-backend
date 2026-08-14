'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  const courses = await app.db.query('api::course.course').findMany({
    populate: ['chapters'],
  })
  for (const c of courses) {
    console.log(`COURSE ${c.documentId} | ${c.titleLv} / ${c.titleEn} / ${c.titleRu} | cat:${c.category} | slug:${c.slug} | pub:${!!c.publishedAt}`)
    const chs = (c.chapters || []).sort((a, b) => (a.order || 0) - (b.order || 0))
    for (const ch of chs) {
      const bLv = Array.isArray(ch.blocksLv) ? ch.blocksLv.length : 0
      const bRu = Array.isArray(ch.blocksRu) ? ch.blocksRu.length : 0
      const bEn = Array.isArray(ch.blocksEn) ? ch.blocksEn.length : 0
      console.log(`   CH ${ch.documentId} | order:${ch.order} | key:${ch.chapterKey} | "${ch.titleLv || ch.titleEn || ch.titleRu}" | Lv:${bLv} Ru:${bRu} En:${bEn} | srcLang:${ch.sourceLanguage} | base:${ch.baseLanguage} | ver:${ch.sourceVersion || '-'} | file:${(ch.sourceFile || '').slice(-40)}`)
    }
  }

  const qcount = await app.db.query('api::question.question').count({})
  console.log(`\nTOTAL QUESTIONS: ${qcount}`)
  await app.destroy()
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })

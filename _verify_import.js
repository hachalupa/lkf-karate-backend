'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  const courses = await app.db.query('api::course.course').findMany({ populate: ['chapters'] })
  for (const c of courses) {
    const chs = (c.chapters || []).sort((a, b) => (a.order || 0) - (b.order || 0))
    console.log(`\nCOURSE ${c.documentId} | ${c.titleEn} | cat:${c.category} | pub:${!!c.publishedAt} | ${chs.length} chapters`)
    let img = 0
    let imgLv = 0
    let imgRu = 0
    for (const ch of chs) {
      const bEn = Array.isArray(ch.blocksEn) ? ch.blocksEn.length : 0
      const bLv = Array.isArray(ch.blocksLv) ? ch.blocksLv.length : 0
      const bRu = Array.isArray(ch.blocksRu) ? ch.blocksRu.length : 0
      const imgEn = (ch.blocksEn || []).filter(b => b.type === 'image' && (b.media?.file?.id || b.media?.file?.url)).length
      imgLv += (ch.blocksLv || []).filter(b => b.type === 'image' && (b.media?.file?.id || b.media?.file?.url)).length
      imgRu += (ch.blocksRu || []).filter(b => b.type === 'image' && (b.media?.file?.id || b.media?.file?.url)).length
      img += imgEn
      console.log(`  ${ch.order.toString().padEnd(4)} ${ch.chapterKey.padEnd(13)} "${(ch.titleEn || '').slice(0, 34).padEnd(36)}" En:${bEn} Lv:${bLv} Ru:${bRu} ${imgEn ? `| ${imgEn} figs` : ''}`)
    }
    console.log(`  TOTAL figures: EN ${img} | LV ${imgLv} | RU ${imgRu}`)
  }

  const orphanProg = await app.db.query('api::chapter-progress.chapter-progress').findMany({ populate: ['chapter'] })
  const orphan = orphanProg.filter(p => !p.chapter)
  console.log(`\nCHAPTER_PROGRESS: ${orphanProg.length} total, ${orphan.length} orphaned (no chapter)`)
  await app.destroy()
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })

'use strict'
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const app = await createStrapi(appContext).load()
  app.log.level = 'error'

  const chs = await app.db.query('api::chapter.chapter').findMany({ populate: ['course'], sort: ['order'] })
  console.log('CHAPTER rows total:', chs.length)

  // group by documentId
  const byDoc = new Map()
  for (const c of chs) {
    if (!byDoc.has(c.documentId)) byDoc.set(c.documentId, [])
    byDoc.get(c.documentId).push(c)
  }
  console.log('distinct chapter documents:', byDoc.size)

  // per course + key -> documentIds
  const byKey = new Map()
  for (const c of chs) {
    const key = `${c.course ? c.course.slug : 'NOCOURSE'}/${c.chapterKey}`
    if (!byKey.has(key)) byKey.set(key, new Set())
    byKey.get(key).add(c.documentId)
  }
  let dupes = 0
  for (const [k, set] of byKey) {
    if (set.size > 1) { dupes++; console.log(`  DUP KEY ${k} -> ${[...set].join(', ')}`) }
  }
  console.log('keys with >1 documentId:', dupes)

  // draft rows without published twin?
  for (const [doc, rows] of byDoc) {
    if (rows.length > 2) console.log(`  ! doc ${doc} has ${rows.length} rows`)
  }
  const statuses = chs.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc }, {})
  console.log('status counts:', JSON.stringify(statuses))
  const pubAt = chs.reduce((acc, c) => { acc[c.publishedAt ? 'with' : 'without'] = (acc[c.publishedAt ? 'with' : 'without'] || 0) + 1; return acc }, {})
  console.log('publishedAt counts:', JSON.stringify(pubAt))

  await app.destroy()
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })

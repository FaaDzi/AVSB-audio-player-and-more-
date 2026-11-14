// data/review_points/points_*.tsv -> app/public/data/review_points.json (§37):
// { points: { hash: [think, pros[], cons[]] }, reviews|videos|comments: { iemId: [hash] } }
// Each list follows reviews.json's order, so the app finds a review's summary by its position; the three
// maps are keyed like reviews.json so the catalog's duplicate merge carries them along.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { commentText, hashOf, jayText, videoText } from './review_text.mjs'

const points = {}
for (const f of readdirSync('data/review_points').filter((f) => /^points_\d+\.tsv$/.test(f)).sort()) {
  for (const [n, line] of readFileSync(`data/review_points/${f}`, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const [h, think = '', pros = '', cons = '', ...extra] = line.split('\t')
    if (!/^[0-9a-f]{10}$/.test(h) || extra.length) throw new Error(`${f}:${n + 1}: bad line`)
    const list = (s) => s.split('|').map((x) => x.trim()).filter(Boolean)
    points[h] = [think.trim(), list(pros), list(cons)]
  }
}
const r = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8'))
const out = { points, reviews: {}, videos: {}, comments: {} }
let missing = 0
const pick = (who, text) => {
  const h = hashOf(who, text)
  if (!points[h]) missing++
  return points[h] ? h : ''
}
for (const [id, list] of Object.entries(r.reviews)) out.reviews[id] = list.map((v) => pick('Jay Audio', jayText(v)))
for (const [id, list] of Object.entries(r.videos ?? {})) out.videos[id] = list.map((v) => pick('Jay Audio', videoText(v)))
for (const [id, list] of Object.entries(r.comments ?? {})) out.comments[id] = list.map((c) => pick(c.reviewer, commentText(c)))
writeFileSync('app/public/data/review_points.json', JSON.stringify(out))
console.log(`${Object.keys(points).length} summaries, ${new Set([...Object.keys(out.reviews), ...Object.keys(out.videos), ...Object.keys(out.comments)]).size} models, ${missing} reviews without one`)
if (missing) process.exitCode = 1

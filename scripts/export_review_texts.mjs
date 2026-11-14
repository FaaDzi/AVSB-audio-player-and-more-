// Unique review texts for the "what they think / pros / cons" summaries (§37): data/review_points/texts.tsv
// One line per distinct text: hash <TAB> reviewer <TAB> text. Summaries go in data/review_points/points_*.tsv
// (hash <TAB> what they think <TAB> pros joined by " | " <TAB> cons joined by " | "), then build_review_points.mjs.
import { readFileSync, writeFileSync } from 'node:fs'
import { commentText, hashOf, jayText, videoText } from './review_text.mjs'

const r = JSON.parse(readFileSync('app/public/data/reviews.json', 'utf8'))
const seen = new Map()
const add = (reviewer, text) => {
  if (!text) return
  const h = hashOf(reviewer, text)
  if (!seen.has(h)) seen.set(h, [reviewer, text])
}
for (const list of Object.values(r.reviews)) for (const v of list) add('Jay Audio', jayText(v))
for (const list of Object.values(r.videos ?? {})) for (const v of list) add('Jay Audio', videoText(v))
for (const list of Object.values(r.comments ?? {})) for (const c of list) add(c.reviewer, commentText(c))
writeFileSync('data/review_points/texts.tsv', [...seen].map(([h, [who, t]]) => `${h}\t${who}\t${t}`).join('\n') + '\n')
console.log(seen.size, 'unique texts')

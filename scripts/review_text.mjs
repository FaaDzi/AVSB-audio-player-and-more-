// The text each review summary is written from (§37), shared by export_review_texts and build_review_points.
import { createHash } from 'node:crypto'

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
export const hashOf = (reviewer, text) => createHash('sha1').update(reviewer + '\n' + text).digest('hex').slice(0, 10)

export function jayText(v) {
  const k = v.keywords
  const tags = (l) => l.map((x) => x.tag).join(', ')
  return flat(
    [
      v.jay.notes && `Notes: ${v.jay.notes}`,
      k.signature.length && `Sound: ${tags(k.signature)}`,
      k.strengths.length && `Strengths: ${tags(k.strengths)}`,
      k.weaknesses.length && `Weaknesses: ${tags(k.weaknesses)}`,
      k.goodFor.length && `Good for: ${tags(k.goodFor)}`,
      k.notFor.length && `Not for: ${tags(k.notFor)}`,
      v.jay.tuning && `Tuning grade ${v.jay.tuning}, tech ${v.jay.tech ?? '?'}`,
      v.jay.value && `Value: ${v.jay.value}`,
      v.jay.flags.includes('notRecommended') && 'Not recommended',
    ]
      .filter(Boolean)
      .join('. '),
  )
}
export const videoText = (v) => flat(`${v.verdict} Quote: "${v.quote}"`)
export const commentText = (c) => flat(`${c.verdict ?? ''} "${c.quote}"`)

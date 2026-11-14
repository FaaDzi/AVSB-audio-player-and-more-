import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ReviewData, ReviewPointData } from './reviews'

const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf-8'))

describe('review summaries (review_points.json)', () => {
  const data = read<ReviewData>('reviews.json')
  const p = read<ReviewPointData>('review_points.json')
  it('has a summary for every review, in the same order', () => {
    for (const [id, list] of Object.entries(data.reviews)) expect(p.reviews[id]?.length, id).toBe(list.length)
    for (const [id, list] of Object.entries(data.videos ?? {})) expect(p.videos[id]?.length, id).toBe(list.length)
    for (const [id, list] of Object.entries(data.comments ?? {})) expect(p.comments[id]?.length, id).toBe(list.length)
    for (const map of [p.reviews, p.videos]) for (const hs of Object.values(map)) for (const h of hs) expect(p.points[h], h).toBeDefined()
    // ranking-sheet one-liners are shown as written (ReviewThread), so they have no summary
    const asWritten = new Set(['Jaytiss', 'RequIEM', 'DankPods'])
    for (const [id, hs] of Object.entries(p.comments))
      hs.forEach((h, i) => {
        if (!asWritten.has(data.comments?.[id]?.[i]?.reviewer ?? '')) expect(p.points[h], `${id} #${i}`).toBeDefined()
      })
  })
  it('keeps pros and cons short', () => {
    for (const [think, pros, cons] of Object.values(p.points)) {
      expect(pros.length).toBeLessThanOrEqual(4)
      expect(cons.length).toBeLessThanOrEqual(4)
      expect(think.split(' ').length).toBeLessThanOrEqual(24)
    }
  })
})

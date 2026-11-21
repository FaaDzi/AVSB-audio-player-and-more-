// §106 C: Find similar. The chosen device's curve stands in as the target and every other device of the same kind is
// rated with Sean Olive's in-ear Preference Prediction Index against it (the Squig-Rank method):
//   100.0795 − 8.5·SD − 6.796·|slope| − 3.475·AAD
// SD and slope of the error over 20 Hz–10 kHz (slope against log10 frequency), AAD (mean absolute error) over
// 40 Hz–10 kHz, after both curves are smoothed to 1/6 octave and level-matched over 100 Hz–10 kHz. Above 10 kHz counts
// for nothing (couplers disagree there). Only the same kind compares: IEM with IEM, TWS with TWS, open headphones with
// open (semi-open counts as open), closed with closed; their curves come from the same calibrated rigs.
import { frDb, type Iem, type IemData } from '../audio/data'
import { smoothLog } from '../audio/filter'
import type { Database, Model } from './database/catalog'

/** Which devices compare with which: the kind, and for headphones the back ('hp' when it isn't known). */
export function similarGroup(m: Pick<Model, 'kind' | 'members'>): string {
  if (m.kind !== 'headphones') return m.kind
  const back = m.members.find((x) => x.back)?.back
  return back === 'closed' ? 'hp-closed' : back === 'open' || back === 'semi-open' ? 'hp-open' : 'hp'
}

/** 0–100: how much someone who likes `ref` would like `cand`, from the two curves on one grid (dB). */
export function matchScore(grid: ArrayLike<number>, ref: ArrayLike<number>, cand: ArrayLike<number>): number {
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  const a = smoothLog(ref, ppo, 1 / 6)
  const b = smoothLog(cand, ppo, 1 / 6)
  const err: number[] = []
  const logf: number[] = []
  let level = 0
  let nLevel = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] >= 100 && grid[i] <= 10000) {
      level += b[i] - a[i]
      nLevel++
    }
  }
  level = nLevel ? level / nLevel : 0
  let aad = 0
  let nAad = 0
  for (let i = 0; i < grid.length; i++) {
    const f = grid[i]
    if (f < 20 || f > 10000) continue
    const e = b[i] - a[i] - level
    err.push(e)
    logf.push(Math.log10(f))
    if (f >= 40) {
      aad += Math.abs(e)
      nAad++
    }
  }
  const n = err.length
  const meanE = err.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(err.reduce((s, v) => s + (v - meanE) ** 2, 0) / n)
  const meanX = logf.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (logf[i] - meanX) * (err[i] - meanE)
    sxx += (logf[i] - meanX) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  const ppi = 100.0795 - 8.5 * sd - 6.796 * Math.abs(slope) - 3.475 * (nAad ? aad / nAad : 0)
  return Math.max(0, Math.min(100, ppi))
}

export interface SimilarHit {
  model: Model
  /** The measurement of that model that matched best. */
  iem: Iem
  score: number
}

/** Every other model of the same group, best measurement each, best match first. */
export function findSimilar(db: Database, refModel: Model, ref: Iem): SimilarHit[] {
  const data: IemData = db.catalog.data
  const group = similarGroup(refModel)
  const refDb = frDb(data, ref.fr)
  const hits: SimilarHit[] = []
  for (const m of db.models) {
    if (m.id === refModel.id || m.custom || similarGroup(m) !== group) continue
    let best: SimilarHit | null = null
    for (const iem of m.members) {
      const score = matchScore(data.grid, refDb, frDb(data, iem.fr))
      if (!best || score > best.score) best = { model: m, iem, score }
    }
    if (best) hits.push(best)
  }
  return hits.sort((x, y) => y.score - x.score)
}

export const PRICE_BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'Under $50', lo: 0, hi: 50 },
  { label: '$50 to $150', lo: 50, hi: 150 },
  { label: '$150 to $500', lo: 150, hi: 500 },
  { label: '$500 to $1,500', lo: 500, hi: 1500 },
  { label: 'Over $1,500', lo: 1500, hi: Infinity },
]

/** The best `per` hits in each price band, then those without a price. */
export function byPriceBand(hits: SimilarHit[], per = 5): { label: string; hits: SimilarHit[] }[] {
  const bands = PRICE_BANDS.map((b) => ({ label: b.label, hits: hits.filter((h) => h.model.usd !== null && h.model.usd >= b.lo && h.model.usd < b.hi).slice(0, per) }))
  bands.push({ label: 'Price unknown', hits: hits.filter((h) => h.model.usd === null).slice(0, per) })
  return bands.filter((b) => b.hits.length)
}

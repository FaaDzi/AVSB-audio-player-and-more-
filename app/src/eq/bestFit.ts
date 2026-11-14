import type { Band } from '../audio/data'
import { chainDb } from './biquad'
import { fitParametric, type ParametricEq } from './parametric'

/**
 * "Best fit": the closest an IEM can get to the aim without asking more of it than it can give
 * (research_notes/peqdb_diamond_and_eq_limits.md). The full correction is cut back where:
 *  - the measurements disagree (a reviewer's unit/rig/tips, not the model): faded out by spread;
 *  - it's fit-dependent: nothing above 10 kHz (insertion depth moves it), nothing extra below 30 Hz;
 *  - it would fill a narrow dip (a cancellation: barely fills, rings): boosts under 1/3 octave go;
 *  - it's a big boost (distortion, headroom): +6 dB up to 5 kHz, +3 dB from 7 kHz.
 * Then ≤ 8 wide filters (Q ≤ 2) and a preamp matching the biggest boost.
 */

/** Disagreement (robust spread, dB) at which a band is still corrected in full, and where it's dropped. */
export const SPREAD_FULL_DB = 2
export const SPREAD_NONE_DB = 4
// filters sit below 9 kHz, but the flat 10–16 kHz counts in full, so their spill up there is kept small
export const BEST_FIT_FILTERS = { maxFilters: 8, qMin: 0.5, qMax: 2, maxGainDb: 8, fMin: 20, fMax: 9000, weightTo: 16000 }

export interface BestFit {
  /** What the filters do, dB on the grid (what plays and what the graph shows). */
  curve: Float64Array
  eq: ParametricEq
  /** How far the device is from the aim with no EQ, and with this one (dB rms, 20 Hz–10 kHz, level-matched). */
  beforeDb: number
  afterDb: number
}

const BAND_ORDER: Band[] = ['subBass', 'midBass', 'lowerMids', 'upperMids', 'lowerTreble', 'air']

/** Per grid point, how much of the correction to keep (0–1) given each band's spread; blended across band edges. */
export function agreementWeight(grid: ArrayLike<number>, bands: Record<Band, [number, number]>, spread: Partial<Record<Band, number>> | null): Float64Array {
  const w = new Float64Array(grid.length).fill(1)
  if (!spread) return w
  // one weight per band at its centre (log), linear in log f between centres
  const pts = BAND_ORDER.filter((b) => bands[b] && spread[b] !== undefined).map((b) => {
    const [lo, hi] = bands[b]
    const s = spread[b] as number
    return { x: Math.log2(Math.sqrt(lo * hi)), w: Math.min(1, Math.max(0, (SPREAD_NONE_DB - s) / (SPREAD_NONE_DB - SPREAD_FULL_DB))) }
  })
  if (!pts.length) return w
  for (let i = 0; i < grid.length; i++) {
    const x = Math.log2(grid[i])
    if (x <= pts[0].x) w[i] = pts[0].w
    else if (x >= pts[pts.length - 1].x) w[i] = pts[pts.length - 1].w
    else {
      let k = 0
      while (pts[k + 1].x < x) k++
      const t = (x - pts[k].x) / (pts[k + 1].x - pts[k].x)
      w[i] = pts[k].w + t * (pts[k + 1].w - pts[k].w)
    }
  }
  return w
}

/** Largest boost allowed at f: +6 dB up to 5 kHz, down to +3 dB from 7 kHz. */
export function boostCap(f: number): number {
  if (f <= 5000) return 6
  if (f >= 7000) return 3
  return 6 - (3 * Math.log(f / 5000)) / Math.log(7000 / 5000)
}

/** Morphological opening over a window of `half` points each side: removes peaks narrower than the window. */
function opening(v: Float64Array, half: number): Float64Array {
  const n = v.length
  const er = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let m = Infinity
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) m = Math.min(m, v[j])
    er[i] = m
  }
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let m = -Infinity
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) m = Math.max(m, er[j])
    out[i] = m
  }
  return out
}

function rmsLevelMatched(grid: ArrayLike<number>, d: ArrayLike<number>): number {
  let s = 0, n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 20 && grid[i] <= 10000) {
    s += d[i]
    n++
  }
  const m = s / n
  let e = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 20 && grid[i] <= 10000) e += (d[i] - m) ** 2
  return Math.sqrt(e / n)
}

/** The limited correction curve (before fitting filters). `full` is the correction the EQ would otherwise apply. */
export function bestFitTarget(
  grid: ArrayLike<number>,
  full: ArrayLike<number>,
  bands: Record<Band, [number, number]>,
  spread: Partial<Record<Band, number>> | null,
): Float64Array {
  const n = grid.length
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  // level: boosts and cuts are counted from the midrange, where every IEM is sure of itself
  const mids: number[] = []
  for (let i = 0; i < n; i++) if (grid[i] >= 300 && grid[i] <= 3000) mids.push(full[i])
  mids.sort((a, b) => a - b)
  const mid = mids.length ? mids[Math.floor(mids.length / 2)] : 0
  const w = agreementWeight(grid, bands, spread)
  const c = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const f = grid[i]
    // fit-dependent treble: faded out from 8 kHz, gone at 10 kHz
    const top = f <= 8000 ? 1 : f >= 10000 ? 0 : 1 - Math.log(f / 8000) / Math.log(10000 / 8000)
    c[i] = (full[i] - mid) * w[i] * top
  }
  // deep bass: hold whatever 30 Hz gets
  let i30 = 0
  while (i30 < n - 1 && grid[i30] < 30) i30++
  for (let i = 0; i < i30; i++) c[i] = c[i30]
  // narrow dips aren't filled: keep only boosts at least 1/3 octave wide
  const boosts = Float64Array.from(c, (v) => Math.max(0, v))
  const wide = opening(boosts, Math.max(1, Math.round(ppo / 6)))
  for (let i = 0; i < n; i++) if (c[i] > 0) c[i] = Math.min(wide[i], boostCap(grid[i]))
  return c
}

/**
 * Where the filters' response breaks the limits (dB over, ≥ 0): a boost above the cap or above the
 * target's own boost, any change from 10 kHz up, or a boost narrower than 1/3 octave.
 * Levels are counted from the response's midrange, as in bestFitTarget.
 */
function overshoot(grid: ArrayLike<number>, response: Float64Array, target: Float64Array, ppo: number): Float64Array {
  const n = grid.length
  const mids: number[] = []
  for (let i = 0; i < n; i++) if (grid[i] >= 300 && grid[i] <= 3000) mids.push(response[i] - target[i])
  mids.sort((a, b) => a - b)
  const off = mids.length ? mids[Math.floor(mids.length / 2)] : 0
  const r = Float64Array.from(response, (v) => v - off)
  const boosts = Float64Array.from(r, (v) => Math.max(0, v))
  const wide = opening(boosts, Math.max(1, Math.round(ppo / 6)))
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const f = grid[i]
    if (f > 16000) continue
    const allowed = f >= 10000 ? 0 : Math.min(boostCap(f), Math.max(0, target[i]) + 1)
    const capOver = Math.max(0, r[i] - allowed)
    const narrow = r[i] > 0 ? Math.max(0, r[i] - wide[i] - 1) : 0
    out[i] = Math.max(capOver, narrow)
  }
  return out
}

/** Best fit for a full correction curve: limited target → ≤ 8 wide filters. */
export function bestFit(
  grid: ArrayLike<number>,
  full: ArrayLike<number>,
  bands: Record<Band, [number, number]>,
  spread: Partial<Record<Band, number>> | null,
): BestFit {
  const target = bestFitTarget(grid, full, bands, spread)
  // the filters can overshoot what the target allows (a big wide boost trimmed by a narrow cut):
  // check what they actually do, take the overshoot out of the target and fit again
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  let aim = target
  let eq = fitParametric(grid, aim, BEST_FIT_FILTERS)
  let curve = chainDb(eq.filters, grid)
  for (let pass = 0; pass < 6; pass++) {
    const over = overshoot(grid, curve, target, ppo)
    if (Math.max(...over) < 0.5) break
    aim = Float64Array.from(aim, (v, i) => v - over[i])
    eq = fitParametric(grid, aim, BEST_FIT_FILTERS)
    curve = chainDb(eq.filters, grid)
  }
  const miss = Float64Array.from(full, (v, i) => v - curve[i])
  return { curve, eq, beforeDb: rmsLevelMatched(grid, full), afterDb: rmsLevelMatched(grid, miss) }
}

/** Worst (largest) spread per band of two measurement sets: the device's and the aim IEM's. */
export function worstSpread(
  a: Partial<Record<Band, number>> | null | undefined,
  b: Partial<Record<Band, number>> | null | undefined,
): Partial<Record<Band, number>> | null {
  if (!a && !b) return null
  const out: Partial<Record<Band, number>> = {}
  for (const k of BAND_ORDER) {
    const v = Math.max(a?.[k] ?? -Infinity, b?.[k] ?? -Infinity)
    if (Number.isFinite(v)) out[k] = v
  }
  return out
}

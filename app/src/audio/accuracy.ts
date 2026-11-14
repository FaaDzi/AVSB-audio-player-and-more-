import type { Band } from './data'
import { correctionCurve, IEM_OPTIONS, smoothLog, type CorrectionOptions } from './filter'

/**
 * How faithfully a candidate can be simulated on your device (HEADPHONE_SIM_RESEARCH.md §3.1).
 * Two things limit it, per band:
 * - what the filter can't do: the boost/cut limits (e.g. sub-bass an early-rolling IEM can't reach)
 *   and the smoothing, measured as raw difference minus applied filter;
 * - how sure we are of your device's own curve: the spread between reviewers' measurements of it
 *   (scripts/refs.py), or a default when only one measurement exists.
 * Above 10 kHz ear-simulator data is unreliable for everyone, so "air" is left out of the score.
 */
export type AccuracyLabel = 'accurate' | 'close' | 'rough'

export interface Accuracy {
  /** Combined error (dB rms over the scored bands). */
  errDb: number
  label: AccuracyLabel
  /** The band that limits it most, when it matters (≥ 1.5 dB). */
  limit: Band | null
  /** Why that band is off: your device can't reach it, or measurements of your device disagree there. */
  why: 'device' | 'measurement' | null
  perBand: Record<Band, number>
}

/** Spread assumed for a device measured once: typical unit-to-unit disagreement in refs.json. */
export const SINGLE_MEASUREMENT_DB = 0.8
const SCORED: Band[] = ['subBass', 'midBass', 'lowerMids', 'upperMids', 'lowerTreble']

export function simAccuracy(p: {
  grid: ArrayLike<number>
  bands: Record<Band, [number, number]>
  candidate: ArrayLike<number>
  reference: ArrayLike<number>
  /** Per-band spread of the device's measurements; omitted = measured once. */
  spread?: Record<Band, number> | null
  options?: CorrectionOptions
}): Accuracy {
  const { grid, bands, candidate, reference } = p
  const opts = p.options ?? IEM_OPTIONS
  const applied = correctionCurve(grid, candidate, reference, opts)
  // same smoothing as the filter, without the limits: what the filter would need to do
  const pointsPerOctave = Math.round(1 / Math.log2(grid[1] / grid[0]))
  const raw = new Float64Array(grid.length)
  for (let i = 0; i < grid.length; i++) raw[i] = candidate[i] - reference[i]
  const wanted = smoothLog(raw, pointsPerOctave, opts.smoothingOct)

  const perBand = {} as Record<Band, number>
  const limitDb = {} as Record<Band, number>
  for (const b of Object.keys(bands) as Band[]) {
    const [lo, hi] = bands[b]
    let sum = 0
    let n = 0
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] < lo || grid[i] >= hi) continue
      sum += (wanted[i] - applied[i]) ** 2
      n++
    }
    limitDb[b] = n ? Math.sqrt(sum / n) : 0
    const spread = p.spread ? p.spread[b] : SINGLE_MEASUREMENT_DB
    perBand[b] = Math.round(Math.hypot(limitDb[b], spread) * 10) / 10
  }
  const errDb = Math.sqrt(SCORED.reduce((s, b) => s + perBand[b] ** 2, 0) / SCORED.length)
  const worst = SCORED.reduce((a, b) => (perBand[b] > perBand[a] ? b : a))
  const limit = perBand[worst] >= 1.5 ? worst : null
  const spreadWorst = p.spread ? p.spread[worst] : SINGLE_MEASUREMENT_DB
  return {
    errDb: Math.round(errDb * 10) / 10,
    label: errDb < 1 ? 'accurate' : errDb < 2 ? 'close' : 'rough',
    limit,
    why: limit ? (limitDb[worst] >= spreadWorst ? 'device' : 'measurement') : null,
    perBand,
  }
}

export const BAND_WORDS: Record<Band, string> = {
  subBass: 'sub-bass',
  midBass: 'bass',
  lowerMids: 'lower mids',
  upperMids: 'upper mids',
  lowerTreble: 'treble',
  air: 'air',
}

/** Short label for a badge: "Accurate", "Close", "Rough: bass". */
export function accuracyText(a: Accuracy): string {
  const word = a.label === 'accurate' ? 'Accurate' : a.label === 'close' ? 'Close' : 'Rough'
  return a.limit ? `${word}: ${BAND_WORDS[a.limit]}` : word
}

/** Longer explanation for a tooltip. */
export function accuracyTitle(a: Accuracy, device: string): string {
  const head = `Simulation on ${device}: about ±${a.errDb} dB.`
  if (!a.limit) return head
  return a.why === 'device'
    ? `${head} ${device} can't reach this one's ${BAND_WORDS[a.limit]} (the EQ hits its limit there).`
    : `${head} Measurements of ${device} disagree in the ${BAND_WORDS[a.limit]}, so that part is less certain.`
}

import { smoothLog } from '../audio/filter'
import { addBiquadDb } from './biquad'

/** squig.link-style taste adjustments laid over any gallery EQ. */
export interface Taste {
  /** Low shelf at 105 Hz (dB). */
  bass: number
  /** High shelf at 10 kHz (dB). */
  treble: number
  /** Whole-curve tilt (dB per octave, pivoting at 1 kHz). */
  tilt: number
}

export const NO_TASTE: Taste = { bass: 0, treble: 0, tilt: 0 }

export const isNoTaste = (t: Taste) => !t.bass && !t.treble && !t.tilt

/** The taste adjustments as a curve (dB) on `grid`: AutoEq's shelf settings (Q 0.7). */
export function tasteCurve(grid: ArrayLike<number>, t: Taste): Float64Array {
  const out = new Float64Array(grid.length)
  addBiquadDb({ kind: 'lowshelf', fc: 105, gain: t.bass, q: 0.7 }, grid, out)
  addBiquadDb({ kind: 'highshelf', fc: 10000, gain: t.treble, q: 0.7 }, grid, out)
  if (t.tilt) for (let i = 0; i < grid.length; i++) out[i] += t.tilt * Math.log2(grid[i] / 1000)
  return out
}

/**
 * Smooth the treble of a correction curve. Above ~6 kHz, ear-simulator measurements are
 * dominated by coupler resonances and insertion depth, so the sharp peaks there aren't
 * real (AutoEq averages this region too). The curve is blended into a 1-octave smoothed
 * copy of itself, from none at `fromHz` to fully smoothed at `toHz`. The overall treble
 * level is kept; only the narrow spikes go.
 */
export function tameTreble(grid: ArrayLike<number>, curve: ArrayLike<number>, fromHz = 6000, toHz = 10000, octaves = 1): Float64Array {
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  const wide = smoothLog(curve, ppo, octaves)
  const out = Float64Array.from(curve)
  for (let i = 0; i < grid.length; i++) {
    const w = Math.min(1, Math.max(0, Math.log(grid[i] / fromHz) / Math.log(toHz / fromHz)))
    out[i] = (1 - w) * curve[i] + w * wide[i]
  }
  return out
}

/** a + b, pointwise. */
export function addCurves(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  return Float64Array.from(a, (v, i) => v + b[i])
}

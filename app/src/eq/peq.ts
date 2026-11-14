import { chainDb, type Biquad } from './biquad'
import type { ParametricEq } from './parametric'

/**
 * The gallery's Advanced custom EQ (plan §52.3): free parametric filters like Equalizer APO,
 * Wavelet's PEQ or SoundID. Ten is a habit from graphic EQs, not a DSP limit: biquads are cheap,
 * and the gallery plays any curve through one minimum-phase FIR anyway. Twenty keeps the
 * editor readable.
 */
export const PEQ_MAX_FILTERS = 20
export const PEQ_LIMITS = { fMin: 20, fMax: 20000, gainMin: -15, gainMax: 15, qMin: 0.3, qMax: 10 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A filter inside the editor's limits: whole Hz, 0.1 dB, Q to 2 decimals. */
export function tidyFilter(f: Biquad): Biquad {
  const L = PEQ_LIMITS
  return {
    kind: f.kind,
    fc: Math.round(clamp(f.fc, L.fMin, L.fMax)),
    gain: Math.round(clamp(f.gain, L.gainMin, L.gainMax) * 10) / 10,
    q: Math.round(clamp(f.q, L.qMin, L.qMax) * 100) / 100,
  }
}

/** The 10 graphic bands as peaking filters (the bands that do something), for "Advanced" to start from. */
export function bandsToFilters(freqs: readonly number[], gains: readonly number[], q: number): Biquad[] {
  return freqs.flatMap((fc, i) => (gains[i] ? [{ kind: 'peak' as const, fc, gain: gains[i], q }] : []))
}

/** A new filter for "Add": a peak in the widest gap between the existing ones (log frequency). */
export function nextFilter(filters: readonly Biquad[]): Biquad {
  const xs = [Math.log(PEQ_LIMITS.fMin), ...filters.map((f) => Math.log(f.fc)).sort((a, b) => a - b), Math.log(PEQ_LIMITS.fMax)]
  let at = 1000
  let gap = -1
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) {
      gap = xs[i] - xs[i - 1]
      at = Math.exp((xs[i] + xs[i - 1]) / 2)
    }
  }
  return tidyFilter({ kind: 'peak', fc: at, gain: 0, q: 1 })
}

/** The filters as an EQ app gets them: a preamp that keeps the biggest boost under 0 dB. */
export function peqAsParametric(filters: Biquad[], fs = 48000): ParametricEq {
  const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))
  const db = chainDb(filters, grid, fs)
  const peak = Math.max(0, ...db)
  return { filters, preampDb: -Math.round(peak * 10) / 10, errorDb: 0 }
}

/** Valid saved filters, or null (anything malformed drops the whole list rather than half of it). */
export function parseFilters(v: unknown): Biquad[] | null {
  if (!Array.isArray(v) || v.length > PEQ_MAX_FILTERS) return null
  const ok = v.every(
    (f) =>
      !!f && typeof f === 'object' && ['peak', 'lowshelf', 'highshelf'].includes(f.kind) &&
      [f.fc, f.gain, f.q].every((x) => typeof x === 'number' && Number.isFinite(x)) && f.fc > 0 && f.q > 0,
  )
  return ok ? (v as Biquad[]).map(tidyFilter) : null
}

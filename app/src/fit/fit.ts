/**
 * Personal fit corrections for the user's own IEM, from the fit check in Settings.
 * - balanceDb: channel balance (+ = right louder), applied to everything the app plays.
 * - seal: a weak seal loses bass, so the IEM gives less bass than its graph shows;
 *   the reference curve gets a low shelf so candidates are simulated with that taken into account.
 * - earGainDb: your outer-ear ("ear gain") correction for over-ear headphones heard through IEMs or
 *   earbuds. A headphone's sound passes your pinna and concha; an IEM skips them. Headphone data is
 *   laid onto the in-ear target with the average difference (build_headphone_data.py); real ears
 *   vary most around 3 kHz, so this nudges that region. Same for every headphone, so A/B stays fair.
 */
import { addBiquadDb } from '../eq/biquad'

export type Seal = 'good' | 'faint' | 'none'

export interface FitSettings {
  iemId: string | null
  balanceDb: number
  seal: Seal
  testedAt: string | null
  /** Your ears, not the IEM: kept when you switch IEMs. */
  earGainDb?: number
}

export const DEFAULT_FIT: FitSettings = { iemId: null, balanceDb: 0, seal: 'good', testedAt: null }
export const SEAL_DB: Record<Seal, number> = { good: 0, faint: -4, none: -8 }
const SHELF_HZ = 120

/** Reference FR with the seal correction applied (gentle first-order low shelf). */
export function applyFit(grid: ArrayLike<number>, fr: Float64Array, fit: FitSettings): Float64Array {
  const db = SEAL_DB[fit.seal]
  if (!db) return fr
  return fr.map((v, i) => v + db / (1 + (grid[i] / SHELF_HZ) ** 2))
}

const KEY = 'fit-v1'

export function loadFit(): FitSettings {
  try {
    return { ...DEFAULT_FIT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_FIT
  }
}

export function saveFit(f: FitSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(f)) } catch { /* ignore */ }
}

/** The fit only applies to the IEM it was measured with (balance and ear gain are about you, so they stay). */
export function fitFor(fit: FitSettings, iemId: string | null): FitSettings {
  return iemId && fit.iemId === iemId ? fit : { ...DEFAULT_FIT, balanceDb: fit.balanceDb, earGainDb: fit.earGainDb }
}

export const EAR_GAIN_HZ = 3000
export const EAR_GAIN_Q = 1

/** The ear-gain correction as a curve (dB on `grid`): a broad bell at 3 kHz. */
export function earGainCurve(grid: ArrayLike<number>, db: number): Float64Array {
  return addBiquadDb({ kind: 'peak', fc: EAR_GAIN_HZ, gain: db, q: EAR_GAIN_Q }, grid, new Float64Array(grid.length))
}

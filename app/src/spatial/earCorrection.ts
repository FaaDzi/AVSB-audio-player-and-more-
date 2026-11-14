import type { Biquad } from '../eq/biquad'
import { chainDb } from '../eq/biquad'
import { fitParametric } from '../eq/parametric'

/**
 * The virtual speakers' tone correction (public/data/hrir/ear_correction.json, scripts/build_ear_correction.py):
 * the app plays Harman-tuned sound, which already has the outer ear's resonance in it, and the HRIRs add the
 * outer ear again. This turns the Harman tuning into the diffuse-field one HRIRs are made for, so the ear is
 * counted once: less boom and shout, and the speakers sit further out in front. Automatic; nothing to set.
 */
export interface EarCorrection {
  freqs: number[]
  db: number[]
}

/** A few gentle filters for the curve (low Q: it's a broad tilt, not a fix of narrow peaks). */
export function earCorrectionFilters(c: EarCorrection): Biquad[] {
  return fitParametric(c.freqs, c.db, { maxFilters: 5, qMin: 0.4, qMax: 2, maxGainDb: 8, fMin: 20, fMax: 12000 }).filters
}

/** |H(f)|² of the filters, for the stage's level match. */
export function powerOf(filters: Biquad[], sampleRate: number): (hz: number) => number {
  return (hz) => 10 ** (chainDb(filters, [hz], sampleRate)[0] / 10)
}

let loading: Promise<Biquad[] | null> | null = null

/** The fitted filters, fetched once; null when the file is missing (the stage then plays uncorrected). */
export function loadEarCorrection(): Promise<Biquad[] | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/hrir/ear_correction.json`)
    .then((r) => (r.ok ? (r.json() as Promise<EarCorrection>) : null))
    .then((c) => (c ? earCorrectionFilters(c) : null))
    .catch(() => null)
  return loading
}

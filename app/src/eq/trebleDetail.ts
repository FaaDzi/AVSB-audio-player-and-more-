import type { Band } from '../audio/data'
import { SINGLE_MEASUREMENT_DB } from '../audio/accuracy'

/**
 * How much treble detail a simulation keeps (plan §52.4). The gallery smooths the correction above
 * 6 kHz and holds back half of it above 10 kHz, because rigs, insertion depth and units disagree
 * there. That also smooths away the very peaks that make, say, an HE600 sound brighter than an
 * HD600. When both devices are the same kind (headphone → headphone, IEM → IEM) and the
 * measurements of each agree in the treble, those peaks are real enough to keep.
 */
export type TrebleDetail = 'full' | 'held'

/** Treble spread (dB, robust, refs.json) at or under which a model's measurements count as agreeing. */
export const TREBLE_AGREE_DB = 2.5
const TREBLE_BANDS: Band[] = ['lowerTreble', 'air']

/** The Settings switch: 'auto' (default) decides per pair; 'held' / 'measured' force it. */
export type AirMode = 'auto' | 'held' | 'measured'

const isHeadphone = (id: string) => id.startsWith('hp-')

/** A model with no spread data was measured once: it counts with the typical unit-to-unit spread, as accuracy.ts does. */
function agrees(spread: Partial<Record<Band, number>> | null | undefined): boolean {
  return TREBLE_BANDS.every((b) => (spread?.[b] ?? SINGLE_MEASUREMENT_DB) <= TREBLE_AGREE_DB)
}

/**
 * 'full' when simulating one model on another of the same kind and neither's measurements disagree
 * in the treble; 'held' otherwise (targets, mixed kinds, speakers, noisy data).
 */
export function trebleDetail(
  mode: AirMode,
  deviceId: string | null,
  aimId: string | null,
  deviceSpread: Partial<Record<Band, number>> | null | undefined,
  aimSpread: Partial<Record<Band, number>> | null | undefined,
): TrebleDetail {
  if (mode === 'held') return 'held'
  if (mode === 'measured') return 'full'
  if (!deviceId || !aimId) return 'held'
  if (isHeadphone(deviceId) !== isHeadphone(aimId)) return 'held'
  return agrees(deviceSpread) && agrees(aimSpread) ? 'full' : 'held'
}

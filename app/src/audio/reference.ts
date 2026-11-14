import type { Catalog } from '../data/catalog'
import { applyFit, fitFor, type FitSettings } from '../fit/fit'
import type { Preferences } from '../prefs/types'
import { baselineFr, decodeAllFr, frDb, type Band, type IemData } from './data'

/**
 * Averaged measurement of a model several reviewers measured (scripts/refs.py): the median of
 * their calibrated curves, and how much they disagree. One unit on one rig can be off by a few dB;
 * the median evens that out for the device every simulation is built on.
 */
export interface DeviceRef {
  /** Median FR, tenths of a dB on the shared grid (packed in the file). */
  fr: ArrayLike<number>
  /** Number of measurements behind it. */
  n: number
  /** Typical disagreement with the median, 100 Hz–10 kHz (dB). */
  rmsDb: number
  /** Robust spread per band (dB). */
  spread: Record<Band, number>
}
export type RefData = Record<string, DeviceRef>

export async function loadRefs(): Promise<RefData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/refs.json`)
  if (!res.ok) return {}
  const raw = (await res.json()) as RefData
  decodeAllFr(Object.values(raw))
  return raw
}

/**
 * The FR of the device you listen on, which every simulation is built against: the averaged
 * measurement when there is one, else its single graph, then your fit (seal); with no device (or
 * speakers) the typical curve. `all` must hold every catalog (IEMs and headphones), so the device
 * is found whatever kind of bracket is running; `baseData` (the IEM catalog) gives the typical curve.
 */
export function deviceReference(p: {
  all: Catalog
  baseData: IemData
  refs: RefData
  prefs: Pick<Preferences, 'mode' | 'currentId' | 'listeningOn' | 'unlistedGear'>
  fit: FitSettings
}): Float64Array {
  const current = p.prefs.currentId ? p.all.byId.get(p.prefs.currentId) ?? null : null
  if (p.prefs.mode !== 'iem' || !current) return baselineFr(p.baseData, p.prefs)
  const avg = p.refs[current.id]
  return applyFit(p.all.data.grid, frDb(p.all.data, avg ? avg.fr : current.fr), fitFor(p.fit, current.id))
}

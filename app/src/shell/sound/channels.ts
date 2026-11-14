// Channel correction per device (plan §78 E): swap L/R, one L/R level offset, and (E5) per-band left/right offsets.
// It belongs to the device, not the EQ, so it applies whether the EQ is on or off, and it keeps Direct to DAC:
// the native player swaps samples and sets a per-channel gain without changing a single sample value.
import { useSyncExternalStore } from 'react'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { getGear } from './gear'
import { isSoundbarDevice } from './gearProfiles'
import { CHANNEL_BANDS_HZ } from '../../audio/galleryPlayer'

/** The six bands of the balance steps (Hz). */
export const BALANCE_BANDS = CHANNEL_BANDS_HZ

export interface Channels {
  swap: boolean
  /** + makes the right side louder (dB). */
  balanceDb: number
  /** Per-band L/R offsets from the balance steps (dB, + = right louder), BALANCE_BANDS order; empty = none. */
  bands: number[]
  /** Use the per-band offsets as separate left/right curves (E5) instead of their single average. */
  perBand: boolean
}

export const NO_CHANGE: Channels = { swap: false, balanceDb: 0, bands: [], perBand: false }

type Store = Record<string, Partial<Channels>>
let cache: { raw: unknown; value: Store } | null = null

function store(): Store {
  const raw = getSetting('channels')
  if (cache && cache.raw === raw) return cache.value
  let value: Store = {}
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) as Store } catch { /* damaged: none */ }
  }
  cache = { raw, value }
  return value
}

const keyOf = (deviceId: string | null) => deviceId ?? ''

export function getChannels(deviceId: string | null = getGear().active): Channels {
  if (isSoundbarDevice(deviceId)) return NO_CHANGE // one box: nothing to swap or balance
  return { ...NO_CHANGE, ...store()[keyOf(deviceId)] }
}

export function setChannels(patch: Partial<Channels>, deviceId: string | null = getGear().active) {
  const next = { ...getChannels(deviceId), ...patch }
  setSetting('channels', JSON.stringify({ ...store(), [keyOf(deviceId)]: next }))
}

const snapshot = () => JSON.stringify(getChannels())
export function useChannels(): Channels {
  const raw = useSyncExternalStore(subscribeSettings, snapshot)
  return JSON.parse(raw) as Channels
}

/** The per-band offsets turned into separate left/right curves (half each way), for the engine's split filters. */
export function bandCurves(c: Channels): { left: number[]; right: number[] } | null {
  if (!c.perBand || c.bands.length !== BALANCE_BANDS.length) return null
  // the overall offset already moves both sides; the curves carry only what differs per band
  const rest = c.bands.map((b) => b - c.balanceDb)
  if (rest.every((d) => Math.abs(d) < 0.25)) return null
  return { left: rest.map((d) => -d / 2), right: rest.map((d) => d / 2) }
}

/** Averages two runs (earpieces re-seated in between), band by band; the overall offset is their median. */
export function combineRuns(a: number[], b: number[]): { bands: number[]; balanceDb: number } {
  const bands = a.map((x, i) => Math.round(((x + (b[i] ?? x)) / 2) * 2) / 2)
  const sorted = [...bands].sort((x, y) => x - y)
  const mid = sorted.length / 2
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2
  return { bands, balanceDb: Math.round(median * 2) / 2 }
}

/** How far two runs disagree at most (dB): a big spread means the fit moved, not the device. */
export const runSpread = (a: number[], b: number[]) => Math.max(0, ...a.map((x, i) => Math.abs(x - (b[i] ?? x))))

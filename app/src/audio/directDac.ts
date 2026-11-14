// Direct to DAC (plan §77): with a USB DAC plugged into the phone and nothing in the app changing the sound, songs
// play through a native player (android/.../DirectDacPlugin.kt) that opens the DAC at the song's own rate and bit
// depth. The web player resamples everything to 48 kHz, so it only takes over again when an effect is on.
import { registerPlugin } from '@capacitor/core'
import { useSyncExternalStore } from 'react'

export interface DirectInfo {
  path: string
  rate: number
  bits: number
  channels: number
  mime: string
  duration: number
  /** What the DAC was opened at; 0 when the DAC doesn't take the song's rate and Android converts it. */
  dacRate: number
  dacBits: number
}

export interface DirectState {
  position: number
  duration: number
  playing: boolean
}

interface DirectDacPlugin {
  support(): Promise<{ available: boolean; name: string; rates: number[] }>
  play(o: { path: string; startAt?: number; gain: number; autostart: boolean; balanceDb: number; swap: boolean }): Promise<DirectInfo>
  queueNext(o: { path: string; gain: number }): Promise<void>
  clearNext(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(o: { seconds: number }): Promise<void>
  setGain(o: { gain: number }): Promise<void>
  /** The device's L/R correction (§78 E): a per-channel gain and a sample swap, both keep the song bit-for-bit. */
  setChannels(o: { balanceDb: number; swap: boolean }): Promise<void>
  stop(): Promise<void>
  addListener(e: 'state', cb: (s: DirectState) => void): Promise<{ remove: () => Promise<void> }>
  addListener(e: 'advance', cb: (i: DirectInfo) => void): Promise<{ remove: () => Promise<void> }>
  addListener(e: 'unplugged', cb: (s: { position: number }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(e: 'error', cb: (s: { message: string }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(e: 'nearEnd' | 'ended', cb: () => void): Promise<{ remove: () => Promise<void> }>
}
export const DirectDac = registerPlugin<DirectDacPlugin>('DirectDac')

/** What keeps a song off the direct path, short enough for the quality chip; null = it can go direct. */
export type DirectBlocker = 'Direct off' | 'EQ on' | 'L/R bands on' | 'Sound on' | 'Spatial on' | 'AutoMix on' | 'Measuring'

export interface ChainState {
  /** The setting "Direct to DAC when nothing changes the sound". */
  setting: boolean
  eqOn: boolean
  /** Separate left/right band curves from the balance steps (§78 E5); the plain L/R offset and swap stay direct. */
  earCurves?: boolean
  /** A Sound aim (simulation) playing, not bypassed. */
  soundOn: boolean
  spatialMode: string
  automix: boolean
  normalize: boolean
  /** The song's level is known (levelling needs it; the web player measures it on the first play). */
  levelKnown: boolean
}

/** EQ, simulation, spatial and crossfades reshape the sound; volume and levelling are plain gains, so they stay. */
export function directBlocker(c: ChainState): DirectBlocker | null {
  if (!c.setting) return 'Direct off'
  if (c.eqOn) return 'EQ on'
  if (c.earCurves) return 'L/R bands on'
  if (c.soundOn) return 'Sound on'
  if (c.spatialMode !== 'off') return 'Spatial on'
  if (c.automix) return 'AutoMix on'
  if (c.normalize && !c.levelKnown) return 'Measuring'
  return null
}

/** For the quality chip: playing direct (and at what), or why not while a DAC is connected. */
export interface DirectView {
  info: DirectInfo | null
  blocker: DirectBlocker | null
  dac: boolean
}
let view: DirectView = { info: null, blocker: null, dac: false }
const listeners = new Set<() => void>()
export function setDirectView(patch: Partial<DirectView>) {
  const next = { ...view, ...patch }
  if (next.info === view.info && next.blocker === view.blocker && next.dac === view.dac) return
  view = next
  listeners.forEach((l) => l())
}
export const getDirectView = () => view
export const useDirectView = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => view)

/** The chip's words for a direct song: the rate the DAC really runs at. */
export function directQuality(i: DirectInfo): string[] {
  const kHz = (hz: number) => `${(hz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`
  const bits = i.dacBits || i.bits
  // dacRate 0: the DAC doesn't take this rate, so Android converts it on the way
  return ['Direct to DAC', bits ? `${bits}-bit` : '', i.dacRate ? kHz(i.dacRate) : `${kHz(i.rate)} converted`].filter(Boolean)
}

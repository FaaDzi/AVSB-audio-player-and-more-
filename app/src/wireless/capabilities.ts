// §117: universal wireless control. What each kind of pair can do, built from its driver (the protocol we speak to it)
// and its name. The page draws every pair from this one model: options a pair lacks (connection mode) are left out,
// capabilities it lacks (noise control, game mode) are shown greyed with the reason.

export type Driver = 'samsung' | 'sony' | 'sony-v2' | 'tanchjim-revo' | 'gaia' | 'soundcore-d1301' | 'none'
export type Why = 'open-ear' | 'buttons' | 'none' | 'unknown' | 'auto'

export interface NoiseCaps {
  anc: boolean
  /** Ambient levels the pair takes, or null for none. */
  ambient: { min: number; max: number } | null
  voice: boolean
}
export interface Gesture { ear: 'L' | 'R' | 'Any'; taps: string; does: string }
export interface Caps {
  noise: NoiseCaps | null
  noiseWhy?: Why
  game: boolean
  gameWhy?: Why
  /** Standard / LDAC / two devices, as the earbuds' own setting (hidden when absent). */
  connection: boolean
  gestures: Gesture[] | null
}

export interface Battery { left?: number; right?: number; case?: number; single?: number }
export interface Noise { mode: 0 | 1 | 2; level?: number; voice?: boolean }
export interface WirelessState {
  /** False when the pair says no bud is in an ear (Galaxy Buds won't switch noise control then). */
  worn?: boolean
  /** Sony: 0 prioritize sound quality (LDAC allowed), 1 stable connection. */
  quality?: number
  /** Soundcore Sleep A30: 0 Bluetooth mode, 1 Local mode (its own sleep sounds). */
  listening?: number
  battery?: Battery
  noise?: Noise
  game?: number
  connection?: number
  info?: { model?: string; firmware?: string; chip?: string; features?: number[] }
}

/** Galaxy Buds ambient tops: Buds2 reports 2 (Galaxy Wearable's own status), Buds Pro 3, Buds+ 4. */
export const samsungAmbientMax = (name: string) =>
  /buds ?pro/i.test(name) && !/buds ?2 ?pro/i.test(name) ? 3 : /buds ?\+|buds plus/i.test(name) ? 4 : 2

/** Button gestures from the maker's manual, for pairs that are controlled only from their own buttons. */
const GESTURES: [RegExp, Gesture[]][] = [
  [/az09 ?pro/i, [
    { ear: 'R', taps: '×3', does: 'Game mode on / off' },
    { ear: 'L', taps: '×3', does: 'Full power on / off' },
    { ear: 'Any', taps: '×1', does: 'Play / pause · answer' },
    { ear: 'L', taps: '×2', does: 'Previous' },
    { ear: 'R', taps: '×2', does: 'Next' },
    { ear: 'Any', taps: 'Hold 2 s', does: 'Assistant · reject call' },
  ]],
]
export const gesturesFor = (name: string) => GESTURES.find(([re]) => re.test(name))?.[1] ?? null

export function capsFor(driver: Driver, name: string): Caps {
  switch (driver) {
    case 'samsung':
      // game mode isn't a setting on Galaxy Buds: the phone sends it while a game is in front (GalaxyBudsClient notes);
      // the Buds2 never acknowledge it from an app (tested 2026-11-27, worn and in the case)
      return { noise: { anc: true, ambient: { min: 0, max: samsungAmbientMax(name) }, voice: false }, game: false, gameWhy: 'auto', connection: false, gestures: null }
    case 'sony':
    case 'sony-v2':
      return { noise: { anc: true, ambient: { min: 1, max: 20 }, voice: true }, game: false, gameWhy: 'none', connection: false, gestures: null }
    case 'soundcore-d1301':
      // Sleep A30: noise cancelling on or off, no ambient levels, no game mode
      return { noise: { anc: true, ambient: null, voice: false }, game: false, gameWhy: 'none', connection: false, gestures: null }
    case 'tanchjim-revo':
      return { noise: null, noiseWhy: 'open-ear', game: true, connection: true, gestures: null }
    case 'gaia':
      return { noise: null, noiseWhy: 'buttons', game: false, gameWhy: 'buttons', connection: false, gestures: gesturesFor(name) }
    default:
      return { noise: null, noiseWhy: 'unknown', game: false, gameWhy: 'unknown', connection: false, gestures: gesturesFor(name) }
  }
}

/** The noise slider's stops, strongest cancelling first, then Off, then ambient low → high. */
export function noiseStops(n: NoiseCaps): Noise[] {
  const stops: Noise[] = []
  if (n.anc) stops.push({ mode: 1 })
  stops.push({ mode: 0 })
  // §119: every real setting is a node on the one slider (Buds2 ambient 1-3, Sony 1-20)
  if (n.ambient) for (let l = n.ambient.min; l <= n.ambient.max; l++) stops.push({ mode: 2, level: l })
  return stops
}

/**
 * §120: where each stop sits on the slider, 0…1, evenly spaced. Noise cancelling · Off · Ambient 1 are the three
 * reference nodes that always exist: a side the pair lacks keeps a grey placeholder node (so the A30's Off sits in
 * the middle, not at the end). Extra tiers just add nodes on their side (Sony: cancelling, Off, then 20 ambient).
 */
export function stopPositions(stops: Noise[]): number[] {
  const lead = stops.some((s) => s.mode === 1) ? 0 : 1
  const tail = stops.some((s) => s.mode === 2) ? 0 : 1
  const n = stops.length + lead + tail
  return stops.map((_, i) => (i + lead) / (n - 1))
}
/** Where the grey placeholder nodes go (a missing cancelling or ambient side). */
export function placeholderPositions(stops: Noise[]): number[] {
  const lead = stops.some((s) => s.mode === 1) ? 0 : 1
  const tail = stops.some((s) => s.mode === 2) ? 0 : 1
  const n = stops.length + lead + tail
  return [...(lead ? [0] : []), ...(tail ? [1] : [])].filter(() => n > 1)
}

/** The stop nearest a slider position. */
export const nearestStop = (positions: number[], p: number) =>
  positions.reduce((best, q, i) => (Math.abs(q - p) < Math.abs(positions[best] - p) ? i : best), 0)

/** Where a state sits on the stops (nearest ambient level when the exact one isn't there). */
export function stopIndex(stops: Noise[], s: Noise | undefined): number {
  if (!s) return stops.findIndex((x) => x.mode === 0)
  const same = stops.map((x, i) => [x, i] as const).filter(([x]) => x.mode === s.mode)
  if (!same.length) return stops.findIndex((x) => x.mode === 0)
  if (s.mode !== 2 || s.level === undefined) return same[0][1]
  return same.reduce((a, b) => (Math.abs((b[0].level ?? 0) - s.level!) < Math.abs((a[0].level ?? 0) - s.level!) ? b : a))[1]
}

/** §118: the earbud part of a listening preset on this pair: only what it supports. */
export function earbudsPlan(want: { noise?: 'anc' | 'ambient-mid' | 'off'; game?: 0 | 1 }, caps: Caps): { noise?: Noise; game?: number } {
  const n = caps.noise
  let noise: Noise | undefined
  if (n && want.noise === 'anc' && n.anc) noise = { mode: 1 }
  else if (n && want.noise === 'ambient-mid' && n.ambient) noise = { mode: 2, level: Math.round((n.ambient.min + n.ambient.max) / 2), voice: false }
  else if (n && want.noise === 'off') noise = { mode: 0 }
  return { noise, game: caps.game && want.game !== undefined ? want.game : undefined }
}

/** Ambient levels are shown counting from 1, whatever the pair's own numbering starts at. */
export const noiseLabel = (s: Noise, ambientMin = 0) => (s.mode === 1 ? 'Noise cancelling' : s.mode === 0 ? 'Off' : s.level !== undefined ? `Ambient ${s.level - ambientMin + 1}` : 'Ambient')

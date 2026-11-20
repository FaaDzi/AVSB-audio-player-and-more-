import { useSyncExternalStore } from 'react'
import { chainDb, type Biquad } from '../eq/biquad'
import { fitParametric, PARAMETRIC_20 } from '../eq/parametric'
import { PEQ_MAX_FILTERS, tidyFilter } from '../eq/peq'
import { getSetting, setSetting, subscribeSettings } from './settings/store'

export const BANDS: Record<number, number[]> = {
  5: [60, 230, 910, 3600, 14000],
  10: [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  15: [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000],
  31: [20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000],
}

/** Bandwidth that suits the spacing of each band count, so neighbouring bands blend without gaps. */
const BAND_Q: Record<number, number> = { 5: 0.7, 10: 1.41, 15: 2.1, 31: 4.3 }

export interface ShaperBand {
  gain: number
  freq: number
}

export interface ShaperParams {
  bassGain: number
  bassFreq: number
  midGain: number
  midFreq: number
  trebleGain: number
  trebleFreq: number
}

export interface PolarParams {
  x: number
  y: number
  blind: boolean
}

export const DEFAULT_SHAPER: ShaperParams = {
  bassGain: 0,
  bassFreq: 80,
  midGain: 0,
  midFreq: 1000,
  trebleGain: 0,
  trebleFreq: 10000,
}

export const DEFAULT_POLAR: PolarParams = {
  x: 0,
  y: 0,
  blind: false,
}

export const DEFAULT_PEQ_FILTERS: Biquad[] = [
  { kind: 'lowshelf', fc: 60, gain: 0, q: 0.71 },
  { kind: 'peak', fc: 250, gain: 0, q: 1.41 },
  { kind: 'peak', fc: 1000, gain: 0, q: 1.41 },
  { kind: 'peak', fc: 4000, gain: 0, q: 1.41 },
  { kind: 'highshelf', fc: 10000, gain: 0, q: 0.71 },
]

export interface EqState {
  on: boolean
  mode: 'basic' | 'advanced' | 'advanced+'
  subMode?: 'shaper' | 'polar'
  shaper?: ShaperParams
  polar?: PolarParams
  preset: string
  count: number
  gains: number[]
  /** Advanced+ mode's parametric filters. */
  filters: Biquad[]
  preamp: number
  bass: number
  treble: number
  balance: number
  headroom: boolean
  limiter: boolean
  compressor: boolean
  threshold: number
  ratio: number
  attack: number
  release: number
}

export const EQ_DEFAULT: EqState = {
  on: false,
  mode: 'basic',
  subMode: 'shaper',
  shaper: DEFAULT_SHAPER,
  polar: DEFAULT_POLAR,
  preset: 'Flat',
  count: 10,
  gains: BANDS[10].map(() => 0),
  filters: DEFAULT_PEQ_FILTERS,
  preamp: 0,
  bass: 0,
  treble: 0,
  balance: 0,
  headroom: true,
  limiter: true,
  compressor: false,
  threshold: -18,
  ratio: 3,
  attack: 10,
  release: 150,
}

/** The filters the current mode plays. Bass and treble are shelves at 200 Hz and 4 kHz: my choice, not read from Mornye. */
export function eqFilters(s: EqState): Biquad[] {
  let main: Biquad[] = []
  if (s.mode === 'basic') {
    if (s.subMode === 'polar') {
      const p = s.polar ?? DEFAULT_POLAR
      // y: bright (+y) vs warm (-y)
      // x: mid/vocal (+x) vs fun/v-shaped (-x)
      main = [
        ...(p.y !== 0
          ? [
              p.y > 0
                ? { kind: 'highshelf' as const, fc: 8000, gain: +(p.y * 6).toFixed(1), q: 0.71 }
                : { kind: 'lowshelf' as const, fc: 100, gain: +(-p.y * 6).toFixed(1), q: 0.71 },
            ]
          : []),
        ...(p.x > 0
          ? [{ kind: 'peak' as const, fc: 1500, gain: +(p.x * 5).toFixed(1), q: 1.2 }]
          : p.x < 0
          ? [
              { kind: 'lowshelf' as const, fc: 120, gain: +(Math.abs(p.x) * 4).toFixed(1), q: 0.71 },
              { kind: 'peak' as const, fc: 1000, gain: +(-Math.abs(p.x) * 3).toFixed(1), q: 1.41 },
              { kind: 'highshelf' as const, fc: 8000, gain: +(Math.abs(p.x) * 4).toFixed(1), q: 0.71 },
            ]
          : []),
      ]
    } else {
      const sh = s.shaper ?? DEFAULT_SHAPER
      main = [
        ...(sh.bassGain !== 0 ? [{ kind: 'lowshelf' as const, fc: sh.bassFreq, gain: sh.bassGain, q: 0.71 }] : []),
        ...(sh.midGain !== 0 ? [{ kind: 'peak' as const, fc: sh.midFreq, gain: sh.midGain, q: 1.41 }] : []),
        ...(sh.trebleGain !== 0 ? [{ kind: 'highshelf' as const, fc: sh.trebleFreq, gain: sh.trebleGain, q: 0.71 }] : []),
      ]
    }
  } else if (s.mode === 'advanced+') {
    main = (s.filters && s.filters.length > 0) ? s.filters : DEFAULT_PEQ_FILTERS
  } else {
    // Advanced mode: ISO Graphic bands
    main = BANDS[s.count]?.flatMap((fc, i) => (s.gains[i] ? [{ kind: 'peak' as const, fc, gain: s.gains[i], q: BAND_Q[s.count] }] : [])) ?? []
  }

  const tone: Biquad[] = [
    ...(s.bass ? [{ kind: 'lowshelf' as const, fc: 200, gain: s.bass, q: 0.71 }] : []),
    ...(s.treble ? [{ kind: 'highshelf' as const, fc: 4000, gain: s.treble, q: 0.71 }] : []),
  ]
  return [...main, ...tone]
}

/** Balance of -100 to 100 % as the channel difference the player takes. Full is 24 dB, close enough to one side only. */
export const balanceDb = (percent: number) => (percent / 100) * 24

function parse(text: unknown): EqState {
  if (typeof text !== 'string' || !text) return EQ_DEFAULT
  try {
    return { ...EQ_DEFAULT, ...(JSON.parse(text) as Partial<EqState>) }
  } catch {
    return EQ_DEFAULT
  }
}

let lastText: unknown
let lastState = EQ_DEFAULT

export function getEq(): EqState {
  const text = getSetting('eqstate')
  if (text !== lastText) {
    lastText = text
    lastState = parse(text)
  }
  return lastState
}

export function setEq(patch: Partial<EqState>) {
  setSetting('eqstate', JSON.stringify({ ...getEq(), ...patch }))
}

export const useEq = () => useSyncExternalStore(subscribeSettings, getEq)

/** A saved preset carries the sound. Headroom, limiter, compressor and balance stay as they are, as in Mornye. */
export interface SavedPreset {
  name: string
  mode: EqState['mode']
  count: number
  gains: number[]
  filters: Biquad[]
  preamp: number
  bass: number
  treble: number
  /** Basic mode's sound (§85 A): without these a Basic preset saved nothing of what it played. */
  subMode?: EqState['subMode']
  shaper?: ShaperParams
  polar?: PolarParams
  /** What it was made for (a catalog id), so the Database can show the device with this EQ on it (§85). */
  device?: string
}

export const presetFrom = (eq: EqState, name: string, device?: string | null): SavedPreset =>
  ({ name, mode: eq.mode, count: eq.count, gains: eq.gains, filters: eq.filters, preamp: eq.preamp, bass: eq.bass, treble: eq.treble, subMode: eq.subMode, shaper: eq.shaper, polar: eq.polar, ...(device ? { device } : {}) })

/** A preset as the EQ fields it sets (everything it saved; the rest of the EQ stays as it is). */
export const presetFields = (p: SavedPreset): Partial<EqState> =>
  ({ preset: p.name, mode: p.mode, count: p.count, gains: p.gains, filters: p.filters, preamp: p.preamp, bass: p.bass, treble: p.treble, ...(p.mode === 'basic' && p.shaper ? { subMode: p.subMode ?? 'shaper', shaper: p.shaper, polar: p.polar ?? DEFAULT_POLAR } : {}) })

/** The filters a preset plays, whatever mode it was made in. */
export const presetFilters = (p: SavedPreset): Biquad[] => eqFilters({ ...EQ_DEFAULT, ...presetFields(p), on: true })

const MAX_PRESET_BYTES = 64 * 1024
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Reads a preset file. Throws with a message fit to show if it isn't a usable one. */
const APO_KIND: Record<string, Biquad['kind']> = { PK: 'peak', PEQ: 'peak', LS: 'lowshelf', LSC: 'lowshelf', LSQ: 'lowshelf', HS: 'highshelf', HSC: 'highshelf', HSQ: 'highshelf', LP: 'lowpass', LPQ: 'lowpass', HP: 'highpass', HPQ: 'highpass' }

/**
 * An Equalizer APO / AutoEq / squig.link text file as an Advanced+ preset (plan §84 A); null when it has no filters.
 * Comments and lines we don't use (Device:, Channel:, Include:, …) are skipped; filters that are OFF or of a kind
 * we don't play (notch, band-pass, …) are left out; a GraphicEQ line is fitted with parametric filters.
 */
function readApoText(text: string, fileName: string): SavedPreset | null {
  let preamp = 0
  let name = fileName.replace(/\.[^.]+$/, '').replace(/_APO$/, '').trim()
  let filters: Biquad[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const title = /^#.*Equalizer APO configuration\s*-\s*(.+)$/i.exec(line)
    if (title) name = title[1].trim()
    const pre = /^Preamp:\s*([+-]?[\d.]+)\s*dB/i.exec(line)
    if (pre) preamp = Number(pre[1])
    const f = /^Filter\s*\d*:\s*ON\s+([A-Z]+)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+([+-]?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/i.exec(line)
    const kind = f && APO_KIND[f[1].toUpperCase()]
    // a low- or high-pass has no Gain in the file (§96)
    const pass = kind === 'lowpass' || kind === 'highpass'
    if (f && kind && (f[3] !== undefined || pass)) filters.push({ kind, fc: Number(f[2]), gain: pass ? 0 : Number(f[3]), q: f[4] ? Number(f[4]) : 0.71 })
    const graphic = /^GraphicEQ:\s*(.+)$/i.exec(line)
    if (graphic) {
      const pts = graphic[1].split(';').map((p) => p.trim().split(/\s+/).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite) && p[0] > 0)
      if (pts.length > 1) {
        const grid = Array.from({ length: 121 }, (_, i) => 20 * 1000 ** (i / 120))
        // straight lines between the points on a log-frequency axis, flat past the ends
        const curve = grid.map((hz) => {
          const j = pts.findIndex((p) => p[0] >= hz)
          if (j <= 0) return (j === 0 ? pts[0] : pts[pts.length - 1])[1]
          const [a, b] = [pts[j - 1], pts[j]]
          return a[1] + ((b[1] - a[1]) * Math.log(hz / a[0])) / Math.log(b[0] / a[0])
        })
        filters = fitParametric(grid, curve, PARAMETRIC_20).filters
      }
    }
  }
  filters = filters.filter((f) => [f.fc, f.gain, f.q].every(isNumber) && f.fc > 0 && f.q > 0).slice(0, PEQ_MAX_FILTERS).map(tidyFilter)
  if (!filters.length || !isNumber(preamp)) return null
  return { name: name || 'Imported EQ', mode: 'advanced+', count: 10, gains: BANDS[10].map(() => 0), filters, preamp: Math.max(-24, Math.min(12, preamp)), bass: 0, treble: 0 }
}

/** A preset from a file: our own JSON, or Equalizer APO text (`fileName` names it when the text doesn't). */
export function readPreset(text: string, fileName = ''): SavedPreset {
  const bad = new Error('That file is not an equalizer preset')
  if (text.length > MAX_PRESET_BYTES) throw bad
  let p: Partial<SavedPreset>
  try {
    p = JSON.parse(text) as Partial<SavedPreset>
  } catch {
    const apo = readApoText(text, fileName)
    if (apo) return apo
    throw bad
  }
  const filtersOk = Array.isArray(p.filters) && p.filters.every((f) => f && typeof f.kind === 'string' && isNumber(f.fc) && isNumber(f.gain) && isNumber(f.q))
  const gainsOk = Array.isArray(p.gains) && p.gains.every(isNumber) && p.gains.length === BANDS[p.count ?? 0]?.length
  if (typeof p.name !== 'string' || !p.name.trim() || (p.mode !== 'basic' && p.mode !== 'advanced' && p.mode !== 'advanced+') || !filtersOk || !gainsOk || ![p.preamp, p.bass, p.treble].every(isNumber) || (p.device !== undefined && typeof p.device !== 'string')) throw bad
  return p as SavedPreset
}

export function getPresets(): SavedPreset[] {
  const text = getSetting('eqpresets')
  if (typeof text !== 'string' || !text) return []
  try {
    return JSON.parse(text) as SavedPreset[]
  } catch {
    return []
  }
}

export const setPresets = (presets: SavedPreset[]) => setSetting('eqpresets', JSON.stringify(presets))

/** Adds a preset, replacing any with the same name. */
export const withPreset = (presets: SavedPreset[], preset: SavedPreset) => [...presets.filter((p) => p.name !== preset.name), preset]

const CARRY_HZ = Array.from({ length: 31 }, (_, i) => 20 * 1000 ** (i / 30))
const clampGain = (v: number) => Math.max(-12, Math.min(12, Math.round(v * 10) / 10))

/** The x of a 3×3 system a·x = b (Gaussian elimination); null when the three columns say the same thing. */
function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 3; c++) {
    const p = m.slice(c).reduce((best, row) => (Math.abs(row[c]) > Math.abs(best[c]) ? row : best))
    if (Math.abs(p[c]) < 1e-9) return null
    m[m.indexOf(p)] = m[c]
    m[c] = p
    for (let r = 0; r < 3; r++) if (r !== c) { const k = m[r][c] / p[c]; m[r] = m[r].map((v, j) => v - k * p[j]) }
  }
  return m.map((row, i) => row[3] / row[i])
}

/**
 * The sound of the mode being left, carried into `next` (plan §76 F, every direction since §81 E). Null when there's
 * nothing to carry: the mode being left is flat, or `next` already sounds the same (so going back and forth without
 * editing never wears a setting down).
 * - Advanced+ takes the filters as they are.
 * - Advanced fits its band gains: reading the curve at each band centre overshoots where neighbouring bands overlap, so
 *   a few passes nudge each gain until the bands together match the curve at the centres.
 * - Basic fits the shaper's three gains (least squares, its frequencies kept). Three knobs can't draw every curve, so
 *   this one is the closest Basic sound, not a copy.
 */
export function carryOver(s: EqState, next: EqState['mode']): Partial<EqState> | null {
  const curve = (mode: EqState['mode'], more?: Partial<EqState>) => eqFilters({ ...s, ...more, mode, bass: 0, treble: 0 })
  const filters = curve(s.mode).filter((f) => f.gain !== 0)
  if (!filters.length || next === s.mode) return null
  const target = chainDb(filters, CARRY_HZ)
  const there = chainDb(curve(next), CARRY_HZ)
  if (target.every((db, i) => Math.abs(db - there[i]) < 0.5)) return null

  if (next === 'advanced+') return { filters }
  if (next === 'advanced') {
    const hz = BANDS[s.count] ?? BANDS[10]
    const q = BAND_Q[s.count] ?? BAND_Q[10]
    const want = chainDb(filters, hz)
    let gains = Array.from(want, clampGain)
    for (let pass = 0; pass < 8; pass++) {
      const got = chainDb(hz.map((fc, i) => ({ kind: 'peak' as const, fc, gain: gains[i], q })), hz)
      gains = gains.map((g, i) => clampGain(g + want[i] - got[i]))
    }
    return { gains }
  }
  const sh = s.shaper ?? DEFAULT_SHAPER
  const withGains = (g: number[]): ShaperParams => ({ ...sh, bassGain: g[0], midGain: g[1], trebleGain: g[2] })
  // what 1 dB on each knob does; near enough to a straight line in dB for a couple of passes to settle
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((g) => chainDb(curve('basic', { subMode: 'shaper', shaper: withGains(g) }), CARRY_HZ))
  const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((sum, v, i) => sum + v * b[i], 0)
  const normal = basis.map((a) => basis.map((b) => dot(a, b)))
  let gains = [0, 0, 0]
  for (let pass = 0; pass < 3; pass++) {
    const got = chainDb(curve('basic', { subMode: 'shaper', shaper: withGains(gains) }), CARRY_HZ)
    const step = solve3(normal, basis.map((b) => dot(b, target.map((db, i) => db - got[i]))))
    if (!step) break
    gains = gains.map((g, i) => clampGain(g + step[i]))
  }
  return { subMode: 'shaper', shaper: withGains(gains) }
}

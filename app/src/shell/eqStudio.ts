// The EQ tab's working parts (plan §84 B–E): the curves its graph draws, AutoEQ to a target with the listener's
// preferences, and the by-ear nudge that fixes what a generic AutoEQ can't know (your ears, your unit).
import type { Biquad } from '../eq/biquad'
import { chainDb } from '../eq/biquad'
import { tasteCurve } from '../eq/curves'
import { fitParametric, PARAMETRIC_DEFAULTS, type ParametricOptions } from '../eq/parametric'
import { smoothLog } from '../audio/filter'
import { PEQ_LIMITS, PEQ_MAX_FILTERS, tidyFilter } from '../eq/peq'
import { addBiquadDb } from '../eq/biquad'
import { SOUND_DEFAULT, soundCurve, type Aim, type SoundEnv } from './sound/soundCurve'

/** Hangout.Audio's four target preferences (dB; tilt in dB per octave around 1 kHz). */
export interface EqPrefs {
  tilt: number
  bass: number
  earGain: number
  treble: number
}
export const NO_PREFS: EqPrefs = { tilt: 0, bass: 0, earGain: 0, treble: 0 }
export const PREF_EAR_GAIN_HZ = 2750

/** How the IEM sits: the ear canal's resonance moves up as the tip goes deeper (about 0.4 kHz per mm). */
export type FitDepth = 'shallow' | 'normal' | 'deep'
/** Where a 711 coupler puts that resonance, and where it lands for a shallow or deep fit (Hz). */
export const CANAL_PEAK_HZ: Record<FitDepth, number> = { shallow: 6800, normal: 8000, deep: 9400 }
const CANAL_PEAK_DB = 4
const CANAL_PEAK_Q = 4

/** What a shallow or deep fit does to the device as measured: the canal peak leaves 8 kHz and shows up elsewhere. */
export function depthCurve(grid: ArrayLike<number>, depth: FitDepth): Float64Array {
  const out = new Float64Array(grid.length)
  if (depth === 'normal') return out
  addBiquadDb({ kind: 'peak', fc: CANAL_PEAK_HZ.normal, gain: -CANAL_PEAK_DB, q: CANAL_PEAK_Q }, grid, out)
  addBiquadDb({ kind: 'peak', fc: CANAL_PEAK_HZ[depth], gain: CANAL_PEAK_DB, q: CANAL_PEAK_Q }, grid, out)
  return out
}

/** The preferences as a curve laid over the target. */
export function prefCurve(grid: ArrayLike<number>, p: EqPrefs): Float64Array {
  const out = tasteCurve(grid, { bass: p.bass, treble: p.treble, tilt: p.tilt })
  if (p.earGain) addBiquadDb({ kind: 'peak', fc: PREF_EAR_GAIN_HZ, gain: p.earGain, q: 1 }, grid, out)
  return out
}

const add = (a: ArrayLike<number>, b: ArrayLike<number> | null | undefined) => Float64Array.from(a, (v, i) => v + (b?.[i] ?? 0))

/** Mean of a curve over 300 Hz–3 kHz: the level every line on the graph is drawn against. */
export function midLevel(grid: ArrayLike<number>, curve: ArrayLike<number>): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 300 && grid[i] <= 3000) { sum += curve[i]; n++ }
  return n ? sum / n : 0
}

/** How far `a` is from `b` in shape (dB rms, 20 Hz–10 kHz, levels matched). */
export function missDb(grid: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d: number[] = []
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 20 && grid[i] <= 10000) d.push(a[i] - b[i])
  const mean = d.reduce((s, v) => s + v, 0) / (d.length || 1)
  return Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (d.length || 1))
}

export interface EqScene {
  grid: ArrayLike<number>
  /** Your device as measured (and as it sits in your ear), or null when it isn't in the catalog. */
  device: Float64Array | null
  /** What it's aimed at, preferences and HRTF included; null with no target chosen. */
  target: Float64Array | null
  /** The correction AutoEQ fits (target − device, limited the way the Sound engine limits it). */
  want: Float64Array | null
}

export interface SceneOptions {
  aim: Aim
  prefs: EqPrefs
  /** Best fit (gentle, stays inside what the measurements agree on) or the full correction. */
  gentle: boolean
  depth: FitDepth
  /** Added to the target: the chosen HRTF's diffuse field against the generic one (dB on the grid), or null. */
  hrtf: ArrayLike<number> | null
}

/** Device, target and wanted correction on the catalog's grid. */
export function eqScene(env: SoundEnv, deviceId: string | null, o: SceneOptions): EqScene {
  const grid = env.catalog.data.grid
  const known = Boolean(deviceId && env.catalog.byId.has(deviceId))
  if (!known) return { grid, device: null, target: null, want: null }
  const r = soundCurve(env, { ...SOUND_DEFAULT, deviceId, aim: o.aim, strength: 100, fit: o.gentle ? 'best' : 'full' })
  const depth = depthCurve(grid, o.depth)
  const device = add(r.reference, depth)
  if (!r.aim || !r.curve) return { grid, device, target: null, want: null }
  const extra = add(prefCurve(grid, o.prefs), o.hrtf)
  // the device moved by `depth`, so the correction moves the other way
  const want = Float64Array.from(r.curve, (v, i) => v + extra[i] - depth[i])
  return { grid, device, target: add(r.aim, extra), want }
}

export interface AutoEqResult {
  filters: Biquad[]
  preamp: number
  /** Distance from the target before and after (dB rms). */
  beforeDb: number
  afterDb: number
}

/**
 * §91 E2, after PEQdB: Standard smooths the wanted correction (more for in-ears, whose treble measures least
 * alike from rig to rig) and leaves everything above 7.5 kHz to one high shelf; Precise follows the curve with peaks
 * up to 16 kHz. Both let the shelves move anywhere and fine-tune all the filters together.
 */
export type AutoEqMode = 'standard' | 'precise'
export function autoEqOptions(mode: AutoEqMode, maxFilters: number): ParametricOptions {
  return mode === 'standard'
    ? { ...PARAMETRIC_DEFAULTS, maxFilters, fMax: 7500, shelfFMax: 16000, weightTo: 12000, passes: 80 }
    : { ...PARAMETRIC_DEFAULTS, maxFilters, fMax: 16000, shelfFMax: 16000, weightTo: 16000, passes: 80 }
}
export function autoEqWant(grid: ArrayLike<number>, want: ArrayLike<number>, mode: AutoEqMode, inEar: boolean): ArrayLike<number> {
  if (mode !== 'standard') return want
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  return smoothLog(Float64Array.from(want), ppo, inEar ? 1 / 3 : 1 / 6)
}

/** AutoEQ: the wanted correction as a handful of filters (peaks plus shelves), ready for Advanced+. */
export function autoEq(scene: EqScene, maxFilters = 10, mode: AutoEqMode = 'standard', inEar = true): AutoEqResult | null {
  if (!scene.device || !scene.target || !scene.want) return null
  const fitted = fitParametric(scene.grid, autoEqWant(scene.grid, scene.want, mode, inEar), autoEqOptions(mode, maxFilters))
  const filters = fitted.filters.map(tidyFilter)
  const after = add(scene.device, chainDb(filters, scene.grid))
  return {
    filters,
    preamp: Math.round(fitted.preampDb * 10) / 10,
    beforeDb: missDb(scene.grid, scene.device, scene.target),
    afterDb: missDb(scene.grid, after, scene.target),
  }
}

/** A sixth of an octave either side: the same spot, as far as an ear sweeping a tone can tell. */
const SAME_SPOT_OCT = 1 / 6
export const TUNE_STEP_DB = 1.5
export const TUNE_Q = 4

/**
 * "Too loud here" / "too quiet here" (The Headphone Show's tone-sweep method): nudges the narrow filter already at
 * that spot, or adds one. A filter nudged back to nothing is removed. Null when there's no room for another filter.
 */
export function tuneAt(filters: readonly Biquad[], hz: number, stepDb: number): Biquad[] | null {
  const at = filters.findIndex((f) => f.kind === 'peak' && f.q >= 2 && Math.abs(Math.log2(f.fc / hz)) <= SAME_SPOT_OCT)
  if (at >= 0) {
    const gain = Math.round((filters[at].gain + stepDb) * 10) / 10
    if (Math.abs(gain) < 0.05) return filters.filter((_, i) => i !== at)
    return filters.map((f, i) => (i === at ? tidyFilter({ ...f, gain: Math.max(PEQ_LIMITS.gainMin, Math.min(PEQ_LIMITS.gainMax, gain)) }) : f))
  }
  if (filters.length >= PEQ_MAX_FILTERS) return null
  return [...filters, tidyFilter({ kind: 'peak', fc: Math.round(hz), gain: stepDb, q: TUNE_Q })]
}

/** A curve's value at any frequency (straight lines between grid points on a log axis). */
export function curveAt(grid: ArrayLike<number>, curve: ArrayLike<number>, hz: number): number {
  if (hz <= grid[0]) return curve[0]
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] >= hz) return curve[i - 1] + ((curve[i] - curve[i - 1]) * Math.log(hz / grid[i - 1])) / Math.log(grid[i] / grid[i - 1])
  }
  return curve[grid.length - 1]
}

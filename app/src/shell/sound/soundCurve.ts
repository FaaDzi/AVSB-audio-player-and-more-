// Sound (§68): what the EQ does to sound like a target or another device on yours, as one pure function shared by
// the EQ page, the player and the tournament. Same formula as the old gallery (GalleryView fullSim/best/eqCurve):
//   correction = aim − your device, limited and smoothed; treble kept in full detail when both are the same kind and
//   their measurements agree (eq/trebleDetail.ts: the HD 600 → HE600 lesson); optional Best fit; then Strength %.
// All curves are in the frame the data stores them in (headphones in-ear style; over-ear targets moved into it by
// galleryTargets), so the subtraction is direct whatever the kinds.
import { frDb, type Band, type Iem } from '../../audio/data'
import { IEM_OPTIONS, correctionCurve, type CorrectionOptions } from '../../audio/filter'
import { deviceReference, type RefData } from '../../audio/reference'
import type { BackSpace } from '../../audio/backSpace'
import { kindOfIem, type Catalog } from '../../data/catalog'
import { bestFit, worstSpread, type BestFit } from '../../eq/bestFit'
import { tameTreble } from '../../eq/curves'
import { trebleDetail, type AirMode, type TrebleDetail } from '../../eq/trebleDetail'
import { earGainCurve, type FitSettings } from '../../fit/fit'
import { atStrength, galleryTargets, type GalleryTarget, type TargetKind } from '../../gallery/gallery'

export type Aim = { kind: 'off' } | { kind: 'target'; name: string } | { kind: 'device'; id: string }

export interface SoundState {
  /** What you listen on (a catalog id), or null for none set. */
  deviceId: string | null
  aim: Aim
  /** 0–100: how much of the correction plays. */
  strength: number
  fit: 'full' | 'best'
  phase: 'minimum' | 'linear'
  /** Add the open-back space (§67) when the aim is an open-back headphone heard on in-ears. */
  space: boolean
}

export const SOUND_DEFAULT: SoundState = { deviceId: null, aim: { kind: 'off' }, strength: 100, fit: 'full', phase: 'minimum', space: true }

/** The target family a device belongs to: over-ear targets for headphones, in-ear targets for IEMs and TWS. */
export function familyOf(catalog: Catalog, deviceId: string | null): TargetKind {
  const d = deviceId ? catalog.byId.get(deviceId) : undefined
  const kind = d ? kindOfIem(d) : 'iems'
  return kind === 'headphones' ? 'headphone' : kind === 'speakers' || kind === 'soundbar' ? 'room' : 'iem'
}

/** In-room slopes (dB per octave, through 1 kHz) offered for speakers and soundbars (§78 B). */
export const ROOM_SLOPES = [0, -0.6, -0.8, -1] as const

/**
 * The Harman/Toole in-room curve (Olive et al. 2013): what a well-measuring speaker does in a normal room, falling
 * about 0.6–1 dB per octave from bass to treble. Dirac's default is about −0.6. Same grid as the catalog.
 */
export const roomTargetName = (slope: number) => (slope === 0 ? 'In-room flat' : `In-room ${slope.toFixed(1).replace('-', '−')} dB/oct`)

export function roomTargets(grid: ArrayLike<number>): GalleryTarget[] {
  return ROOM_SLOPES.map((slope) => ({
    name: roomTargetName(slope),
    note: slope === 0 ? 'Flat in the room: bright on most speakers' : slope === -0.6 ? "About Dirac's default" : slope === -0.8 ? 'The Harman in-room curve' : 'Warm, the steepest of the Harman range',
    values: Array.from(grid, (f) => slope * Math.log2(f / 1000)),
    kind: 'room' as const,
  }))
}

/** Targets offered for your device: only its own family (an over-ear target on an IEM is wrong by several dB up top). */
export function targetsFor(catalog: Catalog, deviceId: string | null): GalleryTarget[] {
  const family = familyOf(catalog, deviceId)
  if (family === 'room') return roomTargets(catalog.data.grid)
  return galleryTargets(catalog).filter((t) => t.kind === family)
}

/**
 * Speakers (§78 B): EQ fixes the tonal faults, not the room below ~300 Hz, and bass boost on a small woofer adds
 * distortion. Below 200 Hz a correction may boost +3 dB at most, opening to the usual limit by 315 Hz.
 */
export function roomLimit(grid: ArrayLike<number>, curve: Float64Array, maxBoostDb: number, bassBoostDb = 3): Float64Array {
  return curve.map((v, i) => {
    const f = grid[i]
    const t = Math.min(1, Math.max(0, Math.log(f / 200) / Math.log(315 / 200)))
    return Math.min(v, bassBoostDb + t * (maxBoostDb - bassBoostDb))
  })
}

/** Latency a linear-phase FIR adds: half its length. */
export const linearLatencyMs = (sampleRate: number, taps = 4096) => (taps / 2 / sampleRate) * 1000

export interface SoundEnv {
  catalog: Catalog
  refs: RefData
  fit: FitSettings
  airMode: AirMode
}

export interface SoundResult {
  /** dB on the data grid to add (null: nothing to do). */
  curve: Float64Array | null
  /** The full correction before Best fit and Strength (for the graph). */
  full: Float64Array | null
  best: BestFit | null
  treble: TrebleDetail
  /** 'open' when the open-back space should play. */
  space: BackSpace | null
  /** Your device as the simulation hears it, and what it aims for (for the graph). */
  reference: Float64Array
  aim: Float64Array | null
}

/** A model's curve: the median of its measurements when several exist (refs.json), else its own graph. */
function measured(env: SoundEnv, iem: Iem): Float64Array {
  const r = env.refs[iem.id]
  return frDb(env.catalog.data, r && r.n > 1 ? r.fr : iem.fr)
}

/** The aim device's curve as heard on yours: an over-ear heard on in-ears gets your ear gain (as the tournament does). */
function aimCurve(env: SoundEnv, aim: Iem, deviceId: string | null): Float64Array {
  const db = measured(env, aim)
  const deviceIsHp = familyOf(env.catalog, deviceId) === 'headphone'
  if (!env.fit.earGainDb || deviceIsHp || kindOfIem(aim) !== 'headphones') return db
  const bump = earGainCurve(env.catalog.data.grid, env.fit.earGainDb)
  return db.map((v, i) => v + bump[i])
}

export function soundCurve(env: SoundEnv, s: SoundState): SoundResult {
  const { catalog } = env
  const grid = catalog.data.grid
  const family = familyOf(catalog, s.deviceId)
  const deviceHp = family === 'headphone'
  const room = family === 'room'
  const roomDevice = room && s.deviceId ? catalog.byId.get(s.deviceId) : undefined
  // a speaker's curve is the room's: no ear fit, no averaged in-ear measurements
  const reference = roomDevice ? frDb(catalog.data, roomDevice.fr) : deviceReference({
    all: catalog,
    baseData: catalog.data,
    refs: env.refs,
    prefs: { mode: 'iem', currentId: s.deviceId, listeningOn: deviceHp ? 'headphones' : 'iems', unlistedGear: false },
    fit: env.fit,
  })
  const none: SoundResult = { curve: null, full: null, best: null, treble: 'held', space: null, reference, aim: null }
  if (s.aim.kind === 'off') return none

  let aim: Float64Array | null = null
  let aimIem: Iem | undefined
  if (s.aim.kind === 'target') {
    const name = s.aim.name
    const targetList = targetsFor(catalog, s.deviceId)
    const nameLow = name.toLowerCase().trim()
    const target =
      targetList.find((t) => t.name === name) ??
      targetList.find((t) => t.name.toLowerCase() === nameLow) ??
      targetList.find((t) => t.name.toLowerCase().includes(nameLow) || nameLow.includes(t.name.toLowerCase()))
    aim = Float64Array.from(target?.values ?? [])
    if (!aim.length) return none
  } else {
    aimIem = catalog.byId.get(s.aim.id)
    if (!aimIem) return none
    // ear-drum and room frames differ by several dB: a speaker aims only at speakers, an in-ear only at ear gear (§80 E)
    if (room !== (familyOf(catalog, aimIem.id) === 'room')) return none
    if (room) {
      aim = frDb(catalog.data, aimIem.fr)
      aimIem = undefined // no treble-spread or open-back rules for room curves
    } else aim = aimCurve(env, aimIem, s.deviceId)
  }

  const spreadOf = (id: string | null | undefined): Partial<Record<Band, number>> | null => (id ? env.refs[id]?.spread ?? null : null)
  const treble = trebleDetail(env.airMode, s.deviceId, aimIem?.id ?? null, spreadOf(s.deviceId), spreadOf(aimIem?.id))
  // gallery boosts stop at +10 dB (AutoEq-like)
  const options: CorrectionOptions = { ...IEM_OPTIONS, maxBoostDb: 10, holdAir: treble === 'held' }
  const corr = correctionCurve(grid, aim, reference, options)
  // full detail keeps the treble at the curve's own 1/12-octave resolution; held smooths it to an octave above 6 kHz
  const tamed = treble === 'held' ? tameTreble(grid, corr) : tameTreble(grid, corr, 6000, 10000, 1 / 12)
  // a soundbar's small drivers get no bass boost at all, unless it comes with a sub (§80 D)
  const bassBoost = roomDevice && kindOfIem(roomDevice) === 'soundbar' && !/\bsub/i.test(roomDevice.name) ? 0 : 3
  const full = room ? roomLimit(grid, tamed, options.maxBoostDb ?? 10, bassBoost) : tamed
  const best = s.fit === 'best' ? bestFit(grid, full, catalog.data.bands, worstSpread(spreadOf(s.deviceId), spreadOf(aimIem?.id))) : null
  const curve = atStrength(best?.curve ?? full, s.strength)

  const open = aimIem && kindOfIem(aimIem) === 'headphones' && (aimIem.back === 'open' || aimIem.back === 'semi-open')
  const space: BackSpace | null = s.space && open && !deviceHp ? 'open' : null
  return { curve, full, best, treble, space, reference, aim }
}

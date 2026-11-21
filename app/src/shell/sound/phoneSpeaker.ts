// The phone's own speaker as a device of its own (plan §86 G). With nothing plugged in or connected, the phone
// plays from its speaker, and an EQ made for an earphone (a +11 dB bass shelf, a −9 dB treble cut) has no business
// there. So the active device switches to the phone speaker by itself, which starts flat and keeps its own EQ, and
// switches back when the earphones do. Three kinds, because they sound different: both speakers, top only, bottom only.
import { AudioRoute, onPhoneSpeaker } from '../../audio/speakerGuard'
import { isAndroid } from '../../platform'
import { interpLog, smoothLog } from '../../audio/filter'
import { getSetting, setSetting } from '../settings/store'
import { getGear, setActive } from './gear'

export type SpeakerKind = 'both' | 'top' | 'bottom'
export const SPEAKER_KINDS: [SpeakerKind, string][] = [['both', 'Top and bottom'], ['top', 'Top only'], ['bottom', 'Bottom only']]
const NAMES: Record<SpeakerKind, string> = { both: 'Phone speakers', top: 'Phone speaker (top)', bottom: 'Phone speaker (bottom)' }
const PREFIX = 'phone-speaker-'

export const phoneSpeakerId = (kind: SpeakerKind) => `${PREFIX}${kind}`
export const isPhoneSpeaker = (id?: string | null): boolean => Boolean(id?.startsWith(PREFIX))
/** A device's name for the screen: the catalog's, or ours for the phone speaker (which isn't in any catalog). */
export const gearName = (id: string | null | undefined, catalogName?: string): string =>
  catalogName ?? (isPhoneSpeaker(id) ? NAMES[id!.slice(PREFIX.length) as SpeakerKind] ?? 'Phone speaker' : id ?? '')

export const getSpeakerKind = (): SpeakerKind => (SPEAKER_KINDS.some(([k]) => k === getSetting('phonespeaker')) ? (getSetting('phonespeaker') as SpeakerKind) : 'both')

/** Your choice of speaker kind; the active device follows when the speaker is what's playing. */
export function setSpeakerKind(kind: SpeakerKind) {
  setSetting('phonespeaker', kind)
  if (isPhoneSpeaker(getGear().active)) setActive(phoneSpeakerId(kind))
}

/** Where the active device goes for a speaker state: null = leave it. Split out so it can be tested. */
export function gearForRoute(speaker: boolean, active: string | null, before: string | null, kind: SpeakerKind): { active: string | null; before: string | null } | null {
  if (speaker && !isPhoneSpeaker(active)) return { active: phoneSpeakerId(kind), before: active }
  if (!speaker && isPhoneSpeaker(active)) return { active: before, before: null }
  return null
}

function follow(speaker: boolean) {
  const before = typeof getSetting('gear.beforespeaker') === 'string' && getSetting('gear.beforespeaker') ? String(getSetting('gear.beforespeaker')) : null
  const next = gearForRoute(speaker, getGear().active, before, getSpeakerKind())
  if (!next) return
  setSetting('gear.beforespeaker', next.before ?? '')
  setActive(next.active)
}

let started = false
/** Called once at start (Android only does anything: elsewhere the speaker state never turns on). */
export function followPhoneSpeaker() {
  if (started || !isAndroid()) return
  started = true
  // the first time, guess the kind from what the phone says about its speaker (one channel = one speaker); a phone
  // can't tell us more than that, so the choice stays yours on the Equalizer page
  if (getSetting('phonespeaker') === undefined) {
    void AudioRoute.status().then((r) => { if (getSetting('phonespeaker') === undefined && r.stereo === false) setSetting('phonespeaker', 'bottom') }, () => {})
  }
  onPhoneSpeaker(follow)
  // the state at start too: the app may have been closed on the speaker and opened with earphones in
  void AudioRoute.status().then((r) => follow(!!r.speaker), () => {})
}

/**
 * §97: a typical phone (or tablet) speaker's response, dB against 1 kHz, drawn as the device line instead of a flat
 * one. 80 Hz-16 kHz: medians of Notebookcheck's pink-noise readings (8 phones incl. Xiaomi 14 and Galaxy S21 FE;
 * 3 Galaxy tablets); below 80 Hz and at 20 kHz extended by slope. reports/research-2026-11-20/phone_speaker_response.md
 */
const SPEAKER_HZ = [20, 40, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1600, 2000, 2500, 3150, 4000, 5000, 8000, 10000, 12500, 16000, 20000]
const PHONE_DB = [-60, -52, -42, -36, -32, -23, -22, -19, -17, -15, -9, -8, -4, 0, 0, 3, 4, 6, 6, 3.5, 0, 0, -9, -14, -20]
const TABLET_DB = [-52, -46, -39, -33, -28, -14, -14, -11, -8, -8, -3, -3.5, -2, 0, 2, 1, -4, 1.5, 2, 0.5, -1.5, -4, -13, -20, -27]
export function typicalSpeakerDb(grid: ArrayLike<number>, tablet = false): Float64Array {
  const raw = interpLog(SPEAKER_HZ, tablet ? TABLET_DB : PHONE_DB, grid)
  // single room readings jump ±2-4 dB band to band: a third-octave smooth shows the shape, not the noise
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
  return smoothLog(raw, ppo, 1 / 3)
}

/** §106 F: measured phone and tablet speakers (scripts/build_phone_speakers.py), and which phone this is. */
interface SpeakerRow { id: string; name: string; models: string[]; tablet: boolean; fr: number[] }
let rows: SpeakerRow[] = []
let rowGrid: number[] = []
let ownModel = ''
let loadingRows: Promise<void> | null = null
export function loadPhoneSpeakers(): Promise<void> {
  loadingRows ??= Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/phone_speakers.json`).then((r) => r.json()).then((d: { grid: number[]; speakers: SpeakerRow[] }) => {
      rows = d.speakers ?? []
      rowGrid = d.grid ?? []
    }),
    isAndroid() ? AudioRoute.status().then((r) => { ownModel = r.model ?? '' }) : Promise.resolve(),
  ]).then(() => {}, () => {})
  return loadingRows
}

const KIND_IDS = new Set(SPEAKER_KINDS.map(([k]) => phoneSpeakerId(k)))
/** This phone's (or tablet's) own measured speakers, when Notebookcheck measured its model. */
export const ownSpeakerRow = (): SpeakerRow | undefined =>
  ownModel ? rows.find((r) => r.models.some((m) => ownModel.toUpperCase().startsWith(m.toUpperCase()))) : undefined

/**
 * The curve drawn for a phone speaker: a measured model's own; for the three kinds (both / top / bottom), this phone's
 * own when its model was measured, else the typical phone or tablet. Top-only and bottom-only use the same curve until
 * they're measured (§106 F3).
 */
export function phoneSpeakerDb(id: string, grid: ArrayLike<number>, tablet: boolean): Float64Array {
  const row = KIND_IDS.has(id) ? ownSpeakerRow() : rows.find((r) => r.id === id)
  if (!row || rowGrid.length !== row.fr.length) return typicalSpeakerDb(grid, tablet)
  return interpLog(rowGrid, row.fr, grid)
}

/** The graph's name for that curve ("Xiaomi 14 speakers", or "Typical phone speaker"). */
export function phoneSpeakerLabel(id: string, tablet: boolean): string {
  const row = KIND_IDS.has(id) ? ownSpeakerRow() : rows.find((r) => r.id === id)
  return row && rowGrid.length === row.fr.length ? row.name : tablet ? 'Typical tablet speaker' : 'Typical phone speaker'
}

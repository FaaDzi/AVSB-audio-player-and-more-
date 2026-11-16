// The phone's own speaker as a device of its own (plan §86 G). With nothing plugged in or connected, the phone
// plays from its speaker, and an EQ made for an earphone (a +11 dB bass shelf, a −9 dB treble cut) has no business
// there. So the active device switches to the phone speaker by itself, which starts flat and keeps its own EQ, and
// switches back when the earphones do. Three kinds, because they sound different: both speakers, top only, bottom only.
import { AudioRoute, onPhoneSpeaker } from '../../audio/speakerGuard'
import { isAndroid } from '../../platform'
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

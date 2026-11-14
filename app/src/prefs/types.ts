import type { Band } from '../audio/data'

export type Volume = 'low' | 'mid' | 'high'
export type Rel = 'less' | 'ok' | 'more' // relative to the current IEM: wants less / same / more
export type FlavourId = 'bass' | 'warm' | 'neutral' | 'bright' | 'vshape'
export type HeadphoneType = 'any' | 'open' | 'closed' | 'on-ear'
export type ListeningDevice = 'iems' | 'headphones' | 'earbuds' | 'speakers'

export interface Preferences {
  mode: 'iem' | 'speakers'
  /** What faces off in the bracket (Sheet 1): wired IEMs, TWS or headphones. Unset = not asked yet. */
  compare?: 'iems' | 'tws' | 'headphones'
  /** Headphone brackets only: which kind of headphone (open includes semi-open). Untagged ones drop out. */
  hpType?: HeadphoneType
  /** What you listen on (Sheet 2): from the device you pick, or the Speakers / earbuds answers. */
  listeningOn?: ListeningDevice
  /** Catalog id of the user's current IEM, if known. */
  currentId: string | null
  /** Every IEM the user owns ("My IEMs"); `currentId` is the one they're wearing now. */
  ownedIds?: string[]
  /** "Cannot find mine": no `currentId`, so the reference is a typical curve for `listeningOn`. */
  unlistedGear?: boolean
  /** Multi-select answers on Sheet 3 ("How do you feel about it?"). */
  feelings?: string[]
  volume: Volume
  budget: [number, number]
  /** How the current IEM feels, per area (from the Abyss test or quick questions). */
  current: { bass: Rel; vocals: Rel; treble: Rel; sibilant: boolean }
  /** Extra preference on top of that, −2..+2 per area. */
  sliders: { bass: number; mids: number; treble: number; air: number }
  /** Chosen flavour card on Sheet 6. */
  flavour?: FlavourId
  /** 0 = don't care, 1 = nice to have, 2 = important (IEM mode only). */
  separation: 0 | 1 | 2
  /** Favourite song genres (manifest genres). */
  genres: string[]
  size: 4 | 8 | 16
  /** Single elimination with Best of 1 (GDD Section 10 Quick Mode). */
  quickMode?: boolean
  autoPick: boolean
  /** Game-picked fields stay hidden ("Mystery Contender") until each IEM has played a match. */
  mystery?: boolean
  /** Tournament only: every IEM stays a Mystery Contender until the results, and the seeds are shuffled. */
  hideUntilResults?: boolean
  blind: boolean
  includeCurrent: boolean
  includeNotRec: boolean
  includeDiscontinued: boolean
  includeUnpriced: boolean
  /** Prototype and pre-production engineering samples (disabled by default). */
  includePrototypes: boolean
  /** Modder prototypes and DIY hardware modifications (disabled by default). */
  includeModded: boolean
  /** Private custom in-ear monitors molded to individual ears (disabled by default). */
  includeCiems: boolean
}

export const DEFAULT_PREFS: Preferences = {
  mode: 'iem',
  listeningOn: 'iems',
  currentId: null,
  feelings: [],
  volume: 'mid',
  budget: [0, 500],
  current: { bass: 'ok', vocals: 'ok', treble: 'ok', sibilant: false },
  sliders: { bass: 0, mids: 0, treble: 0, air: 0 },
  flavour: 'neutral',
  separation: 1,
  genres: [],
  size: 8,
  quickMode: false,
  autoPick: true,
  mystery: true,
  blind: true,
  includeCurrent: true,
  includeNotRec: false,
  includeDiscontinued: false,
  includeUnpriced: false,
  includePrototypes: false,
  includeModded: false,
  includeCiems: false,
}

export type Profile = Record<Band, number>

/** Your collection, current IEM first, no repeats. */
export function ownedOf(p: Pick<Preferences, 'currentId' | 'ownedIds'>): string[] {
  return [...new Set([p.currentId, ...(p.ownedIds ?? [])].filter((id): id is string => !!id))]
}

/** Switch to `id` (or to no IEM); a new IEM joins your collection. */
export function withCurrent<P extends Preferences>(p: P, id: string | null): P {
  return { ...p, currentId: id, ownedIds: ownedOf({ currentId: id, ownedIds: ownedOf(p) }) }
}

/** Add an IEM to your collection without switching to it. */
export function withOwned<P extends Preferences>(p: P, id: string): P {
  return { ...p, ownedIds: ownedOf({ currentId: null, ownedIds: [...ownedOf(p), id] }) }
}

/** Drop an IEM from your collection; dropping the one you wear switches to the next you own. */
export function withoutOwned<P extends Preferences>(p: P, id: string): P {
  const rest = ownedOf(p).filter((x) => x !== id)
  return { ...p, ownedIds: rest, currentId: p.currentId === id ? rest[0] ?? null : p.currentId }
}

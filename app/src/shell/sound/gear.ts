// My gear (§69): the devices you own (one active: what you're listening on now) and the devices you've starred to hear.
// One place for both: Sound (§68) and the tournament read the active device from here.
import { useSyncExternalStore } from 'react'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { loadPrefs, savePrefs } from '../../tournament/storage'
import { DEFAULT_PREFS, type Preferences } from '../../prefs/types'
import { getSound, setSound } from './soundState'
import { onGearChanged } from './gearProfiles'

export interface OwnedDevice {
  /** Catalog id of the exact configuration (tips, nozzle, mode…). */
  id: string
  /** TWS: whether you use it with noise cancelling on (its measurement may be for one mode). */
  anc?: boolean
}

export interface Gear {
  owned: OwnedDevice[]
  /** The owned device you're listening on now, or null. */
  active: string | null
  /** Devices you want to hear, for the quick switch. */
  starred: string[]
}

const EMPTY: Gear = { owned: [], active: null, starred: [] }
let cache: { raw: unknown; value: Gear } | null = null

export function getGear(): Gear {
  const raw = getSetting('gear')
  if (cache && cache.raw === raw) return cache.value
  let value: Gear = EMPTY
  if (typeof raw === 'string') {
    try {
      value = { ...EMPTY, ...(JSON.parse(raw) as Partial<Gear>) }
    } catch {
      // damaged: start empty
    }
  } else {
    // first time: bring over what Sound or the tournament already knew
    const known = getSound().deviceId ?? loadPrefs().currentId ?? null
    if (known) value = { owned: [{ id: known }], active: known, starred: [] }
  }
  cache = { raw, value }
  return value
}

function save(next: Gear) {
  const prevActive = getGear().active
  setSetting('gear', JSON.stringify(next))
  // the active device is "what you listen on" for Sound and for the tournament
  if (getSound().deviceId !== next.active) setSound({ deviceId: next.active })
  const prefs = { ...DEFAULT_PREFS, ...loadPrefs() } as Preferences
  if (prefs.currentId !== next.active) savePrefs({ ...prefs, currentId: next.active })
  if (prevActive !== next.active) onGearChanged(next.active, prevActive)
}

export const useGear = () => useSyncExternalStore(subscribeSettings, getGear)

/** Add a device you own; the first one added becomes active. */
export function addOwned(id: string) {
  const g = getGear()
  if (g.owned.some((d) => d.id === id)) return setActive(id)
  save({ ...g, owned: [...g.owned, { id }], active: g.active ?? id })
}

export function removeOwned(id: string) {
  const g = getGear()
  const owned = g.owned.filter((d) => d.id !== id)
  save({ ...g, owned, active: g.active === id ? owned[0]?.id ?? null : g.active })
}

export function setActive(id: string | null) {
  const g = getGear()
  const owned = id && !g.owned.some((d) => d.id === id) ? [...g.owned, { id }] : g.owned
  save({ ...g, owned, active: id })
}

export function setAnc(id: string, anc: boolean) {
  const g = getGear()
  save({ ...g, owned: g.owned.map((d) => (d.id === id ? { ...d, anc } : d)) })
}

export function isStarred(id: string) {
  return getGear().starred.includes(id)
}

export function toggleStar(id: string, on = !isStarred(id)) {
  const g = getGear()
  save({ ...g, starred: on ? [...g.starred.filter((s) => s !== id), id] : g.starred.filter((s) => s !== id) })
}

/** Hear a device: star it and make it Sound's aim at full strength. */
export function hearDevice(id: string) {
  toggleStar(id, true)
  setSound({ aim: { kind: 'device', id }, strength: 100, bypass: false })
}

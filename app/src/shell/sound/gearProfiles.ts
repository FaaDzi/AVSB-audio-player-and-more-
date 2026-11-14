// Per-gear audio profile scoping: stores reference targets, gear imitations,
// assigned colors, percentage strengths, and active selections isolated per device.
import { useSyncExternalStore } from 'react'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { getGear } from './gear'
import { setSound } from './soundState'
import { getEq, presetFrom, setEq, type SavedPreset } from '../eqState'
import { ROOM_SLOPES, roomTargetName } from './soundCurve'

export interface GearProfileItem {
  id: string
  kind: 'target' | 'device'
  name: string
  color: string
  strength: number // 0 - 100 %
}

export interface GearDeviceProfile {
  deviceId: string
  activeItemId: string | null // null = raw pure sound
  items: GearProfileItem[]
  activeEqPreset?: string
}

const DEFAULT_COLORS = [
  '#a855f7', // Purple (Harman)
  '#06b6d4', // Cyan (IEF Neutral)
  '#f59e0b', // Amber/Gold (JM-1)
  '#10b981', // Emerald
  '#f43f5e', // Coral/Rose
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f97316', // Orange
]

export function pickColorForId(id: string, index = 0): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash + index) % DEFAULT_COLORS.length
  return DEFAULT_COLORS[idx]
}

export const AVAILABLE_IEM_TARGETS: Omit<GearProfileItem, 'strength' | 'kind'>[] = [
  { id: 'Harman in-ear 2019', name: 'Harman In-Ear 2019', color: '#a855f7' },
  { id: 'JM-1', name: 'JM-1 Harman 2024', color: '#f59e0b' },
  { id: 'JM-1 + tilt', name: 'JM-1 + Tilt', color: '#fbbf24' },
  { id: 'IEF Neutral 2023', name: 'IEF Neutral 2023', color: '#06b6d4' },
  { id: 'IEF 2025', name: 'IEF 2025', color: '#38bdf8' },
  { id: 'IEF Neutral 2020', name: 'IEF Neutral 2020', color: '#67e8f9' },
]

export const AVAILABLE_HP_TARGETS: Omit<GearProfileItem, 'strength' | 'kind'>[] = [
  { id: 'Harman over-ear 2018', name: 'Harman Over-Ear 2018', color: '#ec4899' },
  { id: 'Diffuse field', name: 'Diffuse Field', color: '#3b82f6' },
  { id: 'oratory1990 optimum', name: 'oratory1990 Optimum', color: '#8b5cf6' },
  { id: 'Harman OE 2018 no bass', name: 'Harman OE (No Bass)', color: '#f43f5e' },
  { id: 'Harman over-ear 2015', name: 'Harman Over-Ear 2015', color: '#f97316' },
]

/** Speakers and soundbars (§78 B) take only the in-room targets. */
export const AVAILABLE_ROOM_TARGETS: Omit<GearProfileItem, 'strength' | 'kind'>[] = ROOM_SLOPES.map((s, i) => ({
  id: roomTargetName(s),
  name: roomTargetName(s),
  color: ['#94a3b8', '#22c55e', '#a855f7', '#f59e0b'][i],
}))

export const isSpeakerDevice = (deviceId?: string | null) => Boolean(deviceId?.startsWith('spk-'))

/**
 * Devices that can be "sounded like" on this one (§80 E): speakers and soundbars are measured in the room, so they aim
 * only at each other; in-ears and headphones only at each other (ear-drum vs room differs by several dB).
 */
export const aimKindsFor = (deviceId?: string | null): ReadonlySet<'iems' | 'tws' | 'headphones' | 'speakers' | 'soundbar'> =>
  isSpeakerDevice(deviceId) ? new Set(['speakers', 'soundbar'] as const) : new Set(['iems', 'tws', 'headphones'] as const)
/** A soundbar is one box (§80 D): no separate left and right speaker to balance or swap. */
export const isSoundbarDevice = (deviceId?: string | null) => isSpeakerDevice(deviceId) && /soundbar/i.test(deviceId ?? '')
export const isRoomTarget = (id: string) => id.toLowerCase().startsWith('in-room')

/** The targets a device can take: in-room for speakers, over-ear for headphones, in-ear for the rest. */
export function targetListFor(deviceId: string | null | undefined, headphone = isHeadphoneDevice(deviceId)) {
  return isSpeakerDevice(deviceId) ? AVAILABLE_ROOM_TARGETS : headphone ? AVAILABLE_HP_TARGETS : AVAILABLE_IEM_TARGETS
}

/** Whether a stored target belongs on this device (the quarantine below). */
export function targetFits(deviceId: string | null | undefined, id: string, headphone = isHeadphoneDevice(deviceId)): boolean {
  if (isSpeakerDevice(deviceId)) return isRoomTarget(id)
  if (isRoomTarget(id)) return false
  return headphone ? isHpTarget(id) : isIemTarget(id)
}

export function isHpTarget(id: string): boolean {
  const lower = id.toLowerCase()
  return (
    AVAILABLE_HP_TARGETS.some((t) => t.id.toLowerCase() === lower || t.name.toLowerCase() === lower) ||
    lower.includes('over-ear') ||
    lower.includes('oratory') ||
    lower.includes('diffuse') ||
    lower.includes('oe')
  )
}

export function isIemTarget(id: string): boolean {
  const lower = id.toLowerCase()
  return (
    AVAILABLE_IEM_TARGETS.some((t) => t.id.toLowerCase() === lower || t.name.toLowerCase() === lower) ||
    lower.includes('in-ear') ||
    lower.includes('ief') ||
    lower.includes('jm-1')
  )
}

export function isHeadphoneDevice(deviceId?: string | null): boolean {
  if (!deviceId) return false
  const lower = deviceId.toLowerCase()
  return (
    lower.startsWith('hp-') ||
    lower.includes('headphone') ||
    lower.includes('over-ear') ||
    lower.includes('headset') ||
    lower.includes('wh-1000xm') ||
    lower.includes('wh1000xm') ||
    lower.includes('qc35') ||
    lower.includes('qc45') ||
    lower.includes('quietcomfort') ||
    lower.includes('airpods-max') ||
    lower.includes('hd600') ||
    lower.includes('hd-600') ||
    lower.includes('hd800') ||
    lower.includes('hd-800') ||
    lower.includes('sennheiser-hd') ||
    lower.includes('hifiman') ||
    lower.includes('focal') ||
    lower.includes('sundara') ||
    lower.includes('dt-770') ||
    lower.includes('dt-880') ||
    lower.includes('dt-990') ||
    lower.includes('dt770') ||
    lower.includes('dt880') ||
    lower.includes('dt990') ||
    lower.includes('ath-m50') ||
    lower.includes('k701') ||
    lower.includes('k702') ||
    lower.includes('k712')
  )
}

// Each device's own EQ (§80 D), kept across restarts, so speakers and a soundbar don't share one
const DEVICE_EQ_KEY = 'gear.eq.v1'
let eqsRaw: string | null = null
let eqsParsed: Record<string, SavedPreset> = {}
// cached by the raw text: useSyncExternalStore needs the same object back while nothing changed
function deviceEqs(): Record<string, SavedPreset> {
  const raw = String(getSetting(DEVICE_EQ_KEY) || '{}')
  if (raw === eqsRaw) return eqsParsed
  eqsRaw = raw
  try {
    const parsed = JSON.parse(raw) as unknown
    eqsParsed = parsed && typeof parsed === 'object' ? (parsed as Record<string, SavedPreset>) : {}
  } catch {
    eqsParsed = {}
  }
  return eqsParsed
}

export function getSessionAutosave(deviceId: string | null): SavedPreset | null {
  return deviceEqs()[deviceId ?? '__unlisted__'] ?? null
}

export function setSessionAutosave(deviceId: string | null, preset: SavedPreset | null) {
  const key = deviceId ?? '__unlisted__'
  const map = { ...deviceEqs() }
  if (preset) map[key] = preset
  else delete map[key]
  setSetting(DEVICE_EQ_KEY, JSON.stringify(map))
  notifySubscribers()
}

export function clearSessionAutosave(deviceId: string | null) {
  setSessionAutosave(deviceId, null)
}

// Persistent per-device profile store
type ProfilesMap = Record<string, GearDeviceProfile>

const SETTING_KEY = 'gear.profiles.v1'
let cachedProfiles: ProfilesMap | null = null
let lastRawSetting: string | null = null

function getProfilesMap(): ProfilesMap {
  const raw = getSetting(SETTING_KEY)
  const rawStr = typeof raw === 'string' ? raw : ''
  if (cachedProfiles && rawStr === lastRawSetting) {
    return cachedProfiles
  }
  lastRawSetting = rawStr
  let map: ProfilesMap = {}
  if (rawStr) {
    try {
      map = JSON.parse(rawStr) as ProfilesMap
    } catch {
      map = {}
    }
  }
  cachedProfiles = map
  return cachedProfiles
}

function writeProfiles(map: ProfilesMap) {
  cachedProfiles = map
  const rawStr = JSON.stringify(map)
  lastRawSetting = rawStr
  setSetting(SETTING_KEY, rawStr)
  notifySubscribers()
}

const subscribers = new Set<() => void>()
function notifySubscribers() {
  subscribers.forEach((fn) => fn())
}

export function subscribeGearProfiles(fn: () => void) {
  subscribers.add(fn)
  const unsubSettings = subscribeSettings(() => {
    const raw = getSetting(SETTING_KEY)
    const rawStr = typeof raw === 'string' ? raw : ''
    if (rawStr !== lastRawSetting) {
      cachedProfiles = null
      fn()
    }
  })
  return () => {
    subscribers.delete(fn)
    unsubSettings()
  }
}

/** Returns the profile for a given device id (or the currently active device if omitted). */
export function getGearProfile(targetDeviceId?: string | null): GearDeviceProfile {
  const deviceId = targetDeviceId !== undefined ? targetDeviceId : getGear().active
  const key = deviceId ?? '__unlisted__'
  const map = getProfilesMap()
  if (map[key]) {
    // Sanitize any existing stored profile: strictly quarantine IEM vs Headphone targets & deduplicate
    const profile = map[key]
    const seen = new Set<string>()
    const sanitizedItems = profile.items.filter((item) => {
      if (item.kind === 'target') {
        if (!targetFits(deviceId, item.id)) return false
      }
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

    if (sanitizedItems.length !== profile.items.length) {
      const activeItemId = sanitizedItems.some((i) => i.id === profile.activeItemId) ? profile.activeItemId : null
      const cleaned = { ...profile, items: sanitizedItems, activeItemId }
      map[key] = cleaned
      writeProfiles(map)
      return cleaned
    }
    return profile
  }

  // Initialize brand new device profile: 0 targets selected, displaying "Raw audio with no changes"
  const initial: GearDeviceProfile = {
    deviceId: key,
    activeItemId: null, // default is raw pure sound
    items: [],
  }
  map[key] = initial
  writeProfiles(map)
  return initial
}

export function saveGearProfile(profile: GearDeviceProfile) {
  const map = { ...getProfilesMap(), [profile.deviceId]: profile }
  writeProfiles(map)
}

export const useGearProfile = (deviceId?: string | null) =>
  useSyncExternalStore(subscribeGearProfiles, () => getGearProfile(deviceId))

/** Add a reference target or audio gear to imitate (Device to Test) to the active gear profile. */
export function addProfileItem(item: Omit<GearProfileItem, 'color'> & { color?: string }, deviceId?: string | null) {
  const profile = getGearProfile(deviceId)
  // Strictly quarantine target references: headphones must NEVER receive in-ear targets, and IEMs must never receive headphone targets
  if (item.kind === 'target' && !targetFits(deviceId ?? profile.deviceId, item.id)) return
  // room and ear frames differ by several dB (§78 B), so a speaker aims only at speakers and an in-ear only at ear gear
  if (item.kind === 'device' && isSpeakerDevice(deviceId ?? profile.deviceId) !== isSpeakerDevice(item.id)) return

  const existingIndex = profile.items.findIndex((i) => i.id === item.id)
  const color = item.color || pickColorForId(item.id, profile.items.length)
  const fullItem: GearProfileItem = { ...item, color }

  let updatedItems: GearProfileItem[]
  if (existingIndex >= 0) {
    updatedItems = [...profile.items]
    updatedItems[existingIndex] = fullItem
  } else {
    updatedItems = [...profile.items, fullItem]
  }

  saveGearProfile({ ...profile, items: updatedItems })
}

/** Check if a target ID is selected in the device's profile. */
export function isProfileTargetSelected(targetId: string, deviceId?: string | null): boolean {
  const profile = getGearProfile(deviceId)
  return profile.items.some((i) => i.id === targetId)
}

/** Toggle a reference target on or off in the profile. */
export function toggleProfileTarget(target: { id: string; name: string; color?: string }, deviceId?: string | null) {
  const profile = getGearProfile(deviceId)
  const exists = profile.items.some((i) => i.id === target.id)
  if (exists) {
    removeProfileItem(target.id, deviceId)
  } else {
    addProfileItem({ id: target.id, kind: 'target', name: target.name, color: target.color, strength: 100 }, deviceId)
  }
}

/** Remove an item from the profile. */
export function removeProfileItem(itemId: string, deviceId?: string | null) {
  const profile = getGearProfile(deviceId)
  const updatedItems = profile.items.filter((i) => i.id !== itemId)
  const activeItemId = profile.activeItemId === itemId ? null : profile.activeItemId
  saveGearProfile({ ...profile, items: updatedItems, activeItemId })
  if (profile.activeItemId === itemId) {
    applyProfileItem(null, deviceId)
  }
}

/** Update the strength percentage of an item in the active gear profile. */
export function setProfileItemStrength(itemId: string, strength: number, deviceId?: string | null) {
  const profile = getGearProfile(deviceId)
  const updatedItems = profile.items.map((i) => (i.id === itemId ? { ...i, strength: Math.max(0, Math.min(100, Math.round(strength))) } : i))
  saveGearProfile({ ...profile, items: updatedItems })
  if (profile.activeItemId === itemId) {
    setSound({ strength: Math.max(0, Math.min(100, Math.round(strength))) })
  }
}

/** Apply a profile item as the active Sound aim, or null for Raw/Bypass sound. */
export function applyProfileItem(itemId: string | null, deviceId?: string | null) {
  const profile = getGearProfile(deviceId)
  saveGearProfile({ ...profile, activeItemId: itemId })

  if (!itemId) {
    // Pure raw audio gear sound: no aim, bypass false
    setSound({ aim: { kind: 'off' }, bypass: false })
    return
  }

  const item = profile.items.find((i) => i.id === itemId)
  if (!item) {
    setSound({ aim: { kind: 'off' }, bypass: false })
    return
  }

  if (item.kind === 'target') {
    setSound({
      aim: { kind: 'target', name: item.id },
      strength: item.strength,
      bypass: false,
    })
  } else {
    setSound({
      aim: { kind: 'device', id: item.id },
      strength: item.strength,
      bypass: false,
    })
  }
}

/** Synchronize sound state when switching active gear. */
export function onGearChanged(newDeviceId: string | null, prevDeviceId?: string | null) {
  // the EQ playing now belongs to the device being left; a device with none saved yet keeps it as its start
  if (prevDeviceId !== undefined) {
    const eq = getEq()
    setSessionAutosave(prevDeviceId, presetFrom(eq, eq.preset))
  }
  const profile = getGearProfile(newDeviceId)
  applyProfileItem(profile.activeItemId, newDeviceId)

  // Switch to device's active EQ preset or session autosave
  const autosave = getSessionAutosave(newDeviceId)
  if (autosave) {
    setEq({
      preset: autosave.name,
      mode: autosave.mode,
      count: autosave.count,
      gains: autosave.gains,
      filters: autosave.filters,
      preamp: autosave.preamp,
      bass: autosave.bass,
      treble: autosave.treble,
    })
  } else if (profile.activeEqPreset) {
    setEq({ preset: profile.activeEqPreset })
  }
}

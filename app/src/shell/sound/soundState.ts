// The saved Sound state (§68): what you listen on, what to aim for, strength, fit, phase, open-back space, and a
// bypass for comparing. Kept with the other settings, so it survives restarts and backups.
import { useSyncExternalStore } from 'react'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { SOUND_DEFAULT, type SoundState } from './soundCurve'
import { loadPrefs } from '../../tournament/storage'

export interface SavedSound extends SoundState {
  /** Hear your own device as it is, for comparing (the aim stays chosen). */
  bypass: boolean
}

let cache: { raw: unknown; value: SavedSound } | null = null

export function getSound(): SavedSound {
  const raw = getSetting('sound')
  if (cache && cache.raw === raw) return cache.value
  let value: SavedSound = { ...SOUND_DEFAULT, bypass: false }
  try {
    if (typeof raw === 'string') value = { ...value, ...(JSON.parse(raw) as Partial<SavedSound>) }
  } catch {
    // a damaged value: start from the defaults
  }
  // what you listen on starts from the tournament's answer, so it's set once for both
  if (value.deviceId === null && raw === undefined) value.deviceId = loadPrefs().currentId ?? null
  cache = { raw, value }
  return value
}

export function setSound(patch: Partial<SavedSound>) {
  setSetting('sound', JSON.stringify({ ...getSound(), ...patch }))
}

export const useSound = () => useSyncExternalStore(subscribeSettings, getSound)

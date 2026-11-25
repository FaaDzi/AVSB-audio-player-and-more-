import { useMemo, useSyncExternalStore } from 'react'
import { SEPARATORS } from '../library'
import { DEFAULTS } from './pages'

export type SettingValue = boolean | string | number
export type SettingValues = Record<string, SettingValue>

const KEY = 'shell.settings.v1'

function load(): SettingValues {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return saved && typeof saved === 'object' ? (saved as SettingValues) : {}
  } catch {
    return {}
  }
}

let values = load()
// §79 E: "Automatic duration" + "Mix length" became one slider whose 0 is Auto; a length you had chosen carries over
if (values.mixsecs === undefined && values.autoduration === false) values = { ...values, mixsecs: Number(values.mixlength ?? 5) }
// §95: the seek bar's "Moving with the music" is now called Waves
if (values.seekwave === 'Moving with the music') values = { ...values, seekwave: 'Waves' }
const listeners = new Set<() => void>()

export const getSettings = () => values

export function getSetting(id: string): SettingValue | undefined {
  return values[id] ?? DEFAULTS[id]
}

export function setSetting(id: string, value: SettingValue) {
  values = { ...values, [id]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(values))
  } catch {
    // storage full: the change still applies for this session
  }
  listeners.forEach((l) => l())
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Re-renders the caller when any setting changes. */
export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings)
}

/** The marks that split an artist tag into separate artists, from Metadata separators. */
export const artistSeparators = (): string[] => SEPARATORS.filter((s) => Boolean(getSetting(s.id) ?? s.on)).map((s) => s.mark)

/** §92 A: the Artists tab lists album artists (guests under "Appears on") unless "Every artist on the song" is on. */
export function useArtistsByAlbumArtist(): boolean {
  useSettings()
  return getSetting('artistsall') !== true
}

/** The same, re-rendering the caller when they change. The list keeps its identity while they don't. */
export function useArtistSeparators(): string[] {
  useSettings()
  const key = artistSeparators().join('')
  return useMemo(() => [...key], [key])
}

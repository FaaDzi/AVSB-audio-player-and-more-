import { Capacitor, registerPlugin } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { isAndroid } from '../platform'
import { cleanSongName, type LibrarySong } from './library'

/**
 * The songs on the phone (Android), found like Samsung Music finds them: every audio file in
 * Android's media index, 30 s or longer (MusicLibraryPlugin.java). Grouped by folder; a folder
 * can be hidden. Nothing is copied: a song is read through its content:// URI when it plays.
 */
export interface PhoneSong {
  id: number
  uri: string
  name: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number
  size: number
  /** When it was added to the phone (s since 1970). */
  added: number
  /** Folder relative to its storage, with a trailing slash ("Music/the music/"). */
  folder: string
  /** "external_primary" (internal storage) or the SD card's volume name. */
  volume: string
}

export interface PhoneFolder {
  key: string
  name: string
  /** As Samsung Music shows it: "/Internal storage/Music/the music". */
  path: string
  count: number
  hidden: boolean
}

const MusicLibrary = registerPlugin<{
  allowed(): Promise<{ allowed: boolean }>
  scan(): Promise<{ songs: PhoneSong[] }>
}>('MusicLibrary')

const SCANNED_KEY = 'phone-scanned-v1'
const HIDDEN_KEY = 'phone-hidden-folders-v1'
const MATCHES_KEY = 'phone-in-matches-v1'
export const OWN_MUSIC_MIX_KEY = 'iem-own-music-testing-mix-v1'

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

export type OwnMusicMix = 0 | 0.25 | 0.5 | 0.75 | 1

/** How much of a match's music can come from the phone's own songs (Settings → Songs). */
export const OWN_MUSIC_MIX_OPTIONS: readonly { value: OwnMusicMix; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 0.25, label: 'Little' },
  { value: 0.5, label: 'Half' },
  { value: 0.75, label: 'More' },
  { value: 1, label: 'All' },
]

export function getStoredOwnMusicMix(): OwnMusicMix {
  const stored = read(OWN_MUSIC_MIX_KEY)
  if (stored !== null) {
    const num = Number(stored)
    if (num === 0 || num === 0.25 || num === 0.5 || num === 0.75 || num === 1) {
      return num as OwnMusicMix
    }
  }
  // Migration fallback: check old MATCHES_KEY ('phone-in-matches-v1')
  const oldVal = read(MATCHES_KEY)
  if (oldVal === '1') return 0.5
  return 0
}

export const folderKey = (s: Pick<PhoneSong, 'volume' | 'folder'>) => `${s.volume}:${s.folder}`

/** "/Internal storage/Music/the music" (SD cards: "/SD card/…"). */
export function folderPath(s: Pick<PhoneSong, 'volume' | 'folder'>): string {
  const root = s.volume === 'external_primary' || s.volume === 'external' ? 'Internal storage' : 'SD card'
  // Android 9 and older give the whole path: drop the storage root
  const rel = s.folder.replace(/^\/storage\/emulated\/\d+\//, '').replace(/^\/storage\/[^/]+\//, '').replace(/\/+$/, '')
  return `/${root}${rel ? `/${rel}` : ''}`
}

const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const UNKNOWN = /^<?unknown>?$/i

/** One phone song as a library song: its own tags when it has them, else read from the file name like Samsung Music shows it. */
export function toLibrarySong(s: PhoneSong): LibrarySong {
  const tagged = s.artist && !UNKNOWN.test(s.artist)
  const parsed = cleanSongName(s.name)
  const url = Capacitor.convertFileSrc(s.uri)
  return {
    id: `extra-phone-${s.id}`,
    artist: tagged ? s.artist! : parsed.artist,
    title: tagged && s.title ? s.title : parsed.title,
    ...(parsed.from ? { from: parsed.from } : {}),
    // untagged files get their folder's name as the album: that says nothing
    album: s.album && !UNKNOWN.test(s.album) && s.album !== folderName(folderPath(s)) ? s.album : '',
    year: null,
    category: 'any',
    also: [],
    genre: 'unknown',
    clip: { start: null, end: null },
    phone: { folder: folderKey(s), added: s.added },
    file: {
      name: s.name,
      size: s.size,
      url,
      arrayBuffer: async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`can't read ${s.name} (${res.status})`)
        return res.arrayBuffer()
      },
    },
  }
}

// ---- the store: scan result + hidden folders, shared by App, the gallery and Settings ----

interface State {
  /** null until a scan has run this launch. */
  songs: PhoneSong[] | null
  /** Library songs for every visible folder (rebuilt when the scan or the hidden set changes). */
  visible: LibrarySong[]
  folders: PhoneFolder[]
  hidden: Set<string>
  scanning: boolean
  denied: boolean
  inMatches: boolean
  ownMusicMix: OwnMusicMix
}

let state: State = {
  songs: null,
  visible: [],
  folders: [],
  hidden: new Set<string>(JSON.parse(read(HIDDEN_KEY) ?? '[]') as string[]),
  scanning: false,
  denied: false,
  inMatches: getStoredOwnMusicMix() > 0,
  ownMusicMix: getStoredOwnMusicMix(),
}
const subs = new Set<() => void>()
let built = new Map<number, LibrarySong>()

function rebuild(next: Partial<State>) {
  const s = { ...state, ...next }
  const counts = new Map<string, { path: string; count: number }>()
  for (const p of s.songs ?? []) {
    const k = folderKey(p)
    const c = counts.get(k)
    if (c) c.count++
    else counts.set(k, { path: folderPath(p), count: 1 })
  }
  s.folders = [...counts]
    .map(([key, c]) => ({ key, path: c.path, name: folderName(c.path) || c.path, count: c.count, hidden: s.hidden.has(key) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  // keep the same objects for songs already built: the gallery keys covers and favourites on them
  const keep = new Map<number, LibrarySong>()
  s.visible = (s.songs ?? [])
    .filter((p) => !s.hidden.has(folderKey(p)))
    .map((p) => {
      const song = built.get(p.id) ?? toLibrarySong(p)
      keep.set(p.id, song)
      return song
    })
  built = new Map([...built, ...keep])
  state = s
  subs.forEach((cb) => cb())
}

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function usePhoneLibrary(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/**
 * Scan the phone. `ask`: the user pressed Scan (asks for the permission if needed); otherwise
 * it's the quiet rescan at launch, which only runs if a scan was done before and is still allowed.
 */
export async function scanPhone(ask: boolean): Promise<void> {
  if (!isAndroid() || state.scanning) return
  try {
    if (!ask) {
      if (read(SCANNED_KEY) !== '1') return
      const { allowed } = await MusicLibrary.allowed()
      if (!allowed) return
    }
    rebuild({ scanning: true, denied: false })
    const { songs } = await MusicLibrary.scan()
    write(SCANNED_KEY, '1')
    rebuild({ songs, scanning: false })
  } catch (e) {
    rebuild({ scanning: false, denied: /denied/i.test(String(e)) })
  }
}

export function setFolderHidden(key: string, hidden: boolean) {
  const h = new Set(state.hidden)
  if (hidden) h.add(key)
  else h.delete(key)
  write(HIDDEN_KEY, JSON.stringify([...h]))
  rebuild({ hidden: h })
}

export function getHiddenFolderKeys(): Set<string> {
  return new Set(state.hidden)
}

export function isSongHidden(s: LibrarySong): boolean {
  if (!s.phone?.folder) return false
  return state.hidden.has(s.phone.folder)
}

/** Set the mix ratio of own music in testing: 0 = 0% (No), 0.25 = 25% (Little), 0.5 = 50% (Half), 0.75 = 75% (More), 1 = 100% (All). */
export function setOwnMusicMix(mix: OwnMusicMix) {
  write(OWN_MUSIC_MIX_KEY, String(mix))
  write(MATCHES_KEY, mix > 0 ? '1' : '0')
  rebuild({ ownMusicMix: mix, inMatches: mix > 0 })
}

/** Mix the phone's songs into matches (off by default: a phone holds voice notes and podcasts too). */
export function setPhoneInMatches(on: boolean) {
  setOwnMusicMix(on ? 0.5 : 0)
}

export const isPhoneSong = (s: { id: string }) => s.id.startsWith('extra-phone-')

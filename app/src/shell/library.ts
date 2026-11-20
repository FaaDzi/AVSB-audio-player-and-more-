// Library queries for the new shell: filters, sorts, folder hiding, metadata overlays, and the useLibrary() hook.
import { useContext, useMemo, useSyncExternalStore } from 'react'
import { ShellContext } from './context'

// ---- Shared metadata overlay & cover cache bridge (avoids circular import with metadata.ts)
const DETAILS_PREFIX = 'shell.details.'
const detailsListeners = new Set<() => void>()
let detailsVersionCounter = 0

export function notifyDetailsChanged() {
  detailsVersionCounter++
  detailsListeners.forEach((l) => l())
}

export function subscribeDetailsChanged(l: () => void): () => void {
  detailsListeners.add(l)
  return () => { detailsListeners.delete(l) }
}

export const useDetailsVersion = () =>
  useSyncExternalStore(subscribeDetailsChanged, () => detailsVersionCounter)

const MEMORY_COVER_MAX = 100
const memoryCoverMap = new Map<string, string>()
let lazyCoverLoader: ((id: string) => void) | null = null

export function registerCoverLoader(fn: (id: string) => void) {
  lazyCoverLoader = fn
}

export function setMemoryCover(id: string, dataUrl: string) {
  if (memoryCoverMap.has(id)) memoryCoverMap.delete(id)
  memoryCoverMap.set(id, dataUrl)
  while (memoryCoverMap.size > MEMORY_COVER_MAX) {
    const oldest = memoryCoverMap.keys().next().value
    if (oldest === undefined) break
    memoryCoverMap.delete(oldest)
  }
}

export function deleteMemoryCover(id: string) {
  memoryCoverMap.delete(id)
}

export function cachedSavedCover(id: string): string | undefined {
  const hit = memoryCoverMap.get(id)
  if (hit !== undefined) {
    memoryCoverMap.delete(id)
    memoryCoverMap.set(id, hit)
  }
  return hit
}

interface RawSavedOverlay {
  values?: Record<string, string | number | undefined>
  from?: Record<string, string | undefined>
  title?: string
  artist?: string
  originalTitle?: string
  originalArtist?: string
  confirmedMatch?: boolean
  notFoundOnline?: boolean
  replaceCover?: boolean
}

function readSavedOverlay(id: string): RawSavedOverlay | null {
  try {
    const raw = localStorage.getItem(DETAILS_PREFIX + id)
    return raw ? (JSON.parse(raw) as RawSavedOverlay) : null
  } catch {
    return null
  }
}

let namingTracksSink: ((tracks: Track[]) => void) | null = null
let lastRegisteredTracks: Track[] = []

export function registerNamingSink(fn: (tracks: Track[]) => void) {
  namingTracksSink = fn
  if (lastRegisteredTracks.length) fn(lastRegisteredTracks)
}

export function feedRegisteredNamingSink(tracks: Track[]) {
  lastRegisteredTracks = tracks
  namingTracksSink?.(tracks)
}

export interface Track {
  id: string
  /** The full path, with forward slashes. */
  path: string
  /** The folder the file sits in, full path. */
  folder: string
  /** The library folder it was found under. */
  root?: string
  /** Source of the track ('pc' when streamed from a paired PC). */
  source?: 'pc' | 'local'
  /** False for formats the player can't decode yet (ALAC, AIFF, APE, WavPack, DSD). */
  playable?: boolean
  /** Its library folder is missing, for example a drive that isn't plugged in. */
  offline?: boolean
  /** The PC's copy of this phone song, listed once (council 2026-11-19, mergeTwins). */
  pcTwin?: string
  /** A playlist song only the phone has (§80 A): shown greyed out until the phone sends it. */
  missing?: boolean
  title: string
  artist: string
  albumArtist: string
  album: string
  /** Original file title before online metadata overlay. */
  originalTitle?: string
  /** Original file artist before online metadata overlay. */
  originalArtist?: string
  /** True when online lookup confirmed the track identity. */
  confirmedMatch?: boolean
  track: number
  trackTotal: number
  disc: number
  date: string
  year: number
  genre: string
  category?: string
  speciality?: string
  label: string
  composer?: string
  copyright?: string
  comment?: string
  barcode?: string
  releaseType?: string
  isrc: string
  isrcOk: boolean
  lyrics: boolean
  replayGain: boolean
  downloaded: boolean
  format: string
  lossy: boolean
  bits: number
  rate: number
  sec: number
  size: number
  kbps: number
  added: number
  cover: string
}

export interface Playlist {
  id: string
  name: string
  tracks: string[]
  /** Time of the last edit, for merging the PC's and the phone's copies (§80 A). */
  updated?: number
  /** Songs only the phone has, by their "phone:<id>": title, artist and length to show until the file arrives. */
  missing?: Record<string, { title: string; artist: string; sec: number }>
  /** A cover of your own (a small square JPEG data URL); without one the first song's cover shows. */
  cover?: string
}

export interface LibraryData {
  tracks: Track[]
  playlists: Playlist[]
}

/** True when a track comes from a paired PC stream rather than local storage. */
export const isPcTrack = (t: Pick<Track, 'path'> & { source?: string }): boolean =>
  t.source === 'pc' || t.path.startsWith('pc:')

// ---- Home -> Library integrated search handoff (§71.H2)

let pendingLibrarySearch = ''
const searchListeners = new Set<(q: string) => void>()

export function openLibrarySearch(query: string) {
  pendingLibrarySearch = query
  searchListeners.forEach((l) => l(query))
}

export function takePendingLibrarySearch(): string {
  const q = pendingLibrarySearch
  pendingLibrarySearch = ''
  return q
}

export function onLibrarySearch(listener: (q: string) => void): () => void {
  searchListeners.add(listener)
  return () => { searchListeners.delete(listener) }
}

// ---- Hidden folders (§71.F)

const HIDDEN_FOLDERS_KEY = 'shell.hiddenFolders.v1'
let hiddenFoldersState: string[] | null = null
const hiddenFolderListeners = new Set<() => void>()

export const normFolderPath = (p: string): string =>
  p.replace(/\\/g, '/').replace(/\/+$/, '').trim()

function loadHiddenFolders(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_FOLDERS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map(normFolderPath) : []
  } catch {
    return []
  }
}

function saveHiddenFolders(next: string[]) {
  hiddenFoldersState = next
  try { localStorage.setItem(HIDDEN_FOLDERS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  hiddenFolderListeners.forEach((l) => l())
}

export function getHiddenFolders(): string[] {
  return (hiddenFoldersState ??= loadHiddenFolders())
}

export function hideFolder(path: string): void {
  const cleaned = normFolderPath(path)
  if (!cleaned) return
  const current = getHiddenFolders()
  if (current.some((p) => p.toLowerCase() === cleaned.toLowerCase())) return
  saveHiddenFolders([...current, cleaned])
}

export function unhideFolder(path: string): void {
  const cleaned = normFolderPath(path).toLowerCase()
  const current = getHiddenFolders()
  const next = current.filter((p) => p.toLowerCase() !== cleaned)
  if (next.length !== current.length) saveHiddenFolders(next)
}

export function clearHiddenFolders(): void {
  saveHiddenFolders([])
}

export function isTrackHidden(t: Pick<Track, 'path' | 'folder'>, hidden: readonly string[] = getHiddenFolders()): boolean {
  if (!hidden.length) return false
  const folder = normFolderPath(t.folder || '').toLowerCase()
  const file = normFolderPath(t.path || '').toLowerCase()
  return hidden.some((h) => {
    const target = normFolderPath(h).toLowerCase()
    if (!target) return false
    return (
      folder === target ||
      folder.startsWith(`${target}/`) ||
      file === target ||
      file.startsWith(`${target}/`)
    )
  })
}

export function filterHiddenTracks(tracks: Track[], hidden: readonly string[] = getHiddenFolders()): Track[] {
  if (!hidden.length) return tracks
  return tracks.filter((t) => !isTrackHidden(t, hidden))
}

export const useHiddenFolders = (): string[] =>
  useSyncExternalStore(
    (l) => {
      hiddenFolderListeners.add(l)
      return () => { hiddenFolderListeners.delete(l) }
    },
    getHiddenFolders,
  )

// ---- Deleted tracks (§72.B)

const DELETED_TRACKS_KEY = 'shell.deletedTracks.v1'
let deletedIdsState: Set<string> | null = null
let deletedVersion = 0
const deletedListeners = new Set<() => void>()

function loadDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_TRACKS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function getDeletedTrackIds(): Set<string> {
  return (deletedIdsState ??= loadDeletedIds())
}

export function isTrackDeleted(id: string): boolean {
  return getDeletedTrackIds().has(id)
}

export function markTrackDeleted(id: string): void {
  const set = getDeletedTrackIds()
  if (set.has(id)) return
  set.add(id)
  deletedVersion++
  try { localStorage.setItem(DELETED_TRACKS_KEY, JSON.stringify([...set])) } catch { /* ignore */ }
  deletedListeners.forEach((l) => l())
}

export function unmarkTrackDeleted(id: string): void {
  const set = getDeletedTrackIds()
  if (!set.delete(id)) return
  deletedVersion++
  try { localStorage.setItem(DELETED_TRACKS_KEY, JSON.stringify([...set])) } catch { /* ignore */ }
  deletedListeners.forEach((l) => l())
}

export const useDeletedTracks = (): number =>
  useSyncExternalStore(
    (l) => {
      deletedListeners.add(l)
      return () => { deletedListeners.delete(l) }
    },
    () => deletedVersion,
  )

/** Moves a track to the OS Recycle Bin / Android Trash (or removes a PC track from the phone's cache). */
export async function trashTrackOnHost(track: Track): Promise<{ ok: boolean; where: 'cache' | 'trash' | 'recycle-bin' }> {
  const pcRemote = isPcTrack(track)
  const w = typeof window !== 'undefined' ? (window as unknown as {
    Capacitor?: { getPlatform?: () => string; Plugins?: { ShellHost?: { trashTrack?: (o: { id: string; path: string; cacheOnly?: boolean }) => Promise<{ ok?: boolean }> } } }
  }) : undefined
  const isAndroid = w?.Capacitor?.getPlatform?.() === 'android'
  try {
    if (isAndroid && w?.Capacitor?.Plugins?.ShellHost?.trashTrack) {
      await w.Capacitor.Plugins.ShellHost.trashTrack({ id: track.id, path: track.path, cacheOnly: pcRemote })
    } else {
      await fetch('/shell-host/trash-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: track.id, path: track.path, cacheOnly: pcRemote }),
      }).catch(() => null)
    }
  } catch {
    // Still remove from UI library if host endpoint is unavailable in dev mode
  }
  markTrackDeleted(track.id)
  return { ok: true, where: pcRemote ? 'cache' : isAndroid ? 'trash' : 'recycle-bin' }
}

// ---- Metadata Overlay (§72.A1 & A3)

interface FileBaseline {
  title: string
  artist: string
  album: string
  albumArtist: string
  date: string
  year: number
  genre: string
  category?: string
  speciality?: string
  label: string
  track: number
  trackTotal: number
  disc: number
  composer?: string
  barcode?: string
  releaseType?: string
  isrc: string
  cover: string
}

const baselines = new Map<string, FileBaseline>()

function getBaseline(t: Track): FileBaseline {
  let b = baselines.get(t.id)
  if (!b) {
    b = {
      title: t.originalTitle ?? t.title,
      artist: t.originalArtist ?? t.artist,
      album: t.album,
      albumArtist: t.albumArtist,
      date: t.date,
      year: t.year,
      genre: t.genre,
      label: t.label,
      track: t.track,
      trackTotal: t.trackTotal,
      disc: t.disc,
      composer: t.composer,
      barcode: t.barcode,
      releaseType: t.releaseType,
      isrc: t.isrc,
      cover: t.cover && !t.cover.startsWith('data:') ? t.cover : '',
    }
    baselines.set(t.id, b)
  }
  return b
}

/** Overlays saved online details (title, artist, album, year, genre, cover) onto a Track while preserving originalTitle/originalArtist. */
export function overlayTrack(t: Track): Track {
  const base = getBaseline(t)
  const saved = readSavedOverlay(t.id)
  // the track still carries its saved cover from the last overlay (Object.assign below): reloading it every time the
  // LRU evicts it reloaded the whole library in a loop once more than MEMORY_COVER_MAX songs had saved covers
  const foundCover = cachedSavedCover(t.id) ?? (saved?.from?.cover && t.cover?.startsWith('data:') ? t.cover : undefined)
  const foundWins = Boolean(saved?.replaceCover)
  if (!foundCover && (!base.cover || foundWins) && saved?.from?.cover && lazyCoverLoader) {
    lazyCoverLoader(t.id)
  }
  const extra = saved?.values ?? {}
  const dateStr = base.date || (extra.date ? String(extra.date) : '')
  const yearNum = base.year || (extra.date ? Number.parseInt(String(extra.date), 10) || 0 : 0)

  const overlaid: Track = {
    ...t,
    originalTitle: base.title,
    originalArtist: base.artist,
    title: saved?.title || base.title,
    artist: saved?.artist || base.artist,
    album: base.album || (extra.album ? String(extra.album) : ''),
    albumArtist: base.albumArtist || (extra.albumArtist ? String(extra.albumArtist) : ''),
    date: dateStr,
    year: yearNum > 999 ? yearNum : 0,
    genre: base.genre || (extra.genre ? String(extra.genre) : ''),
    label: base.label || (extra.label ? String(extra.label) : ''),
    track: base.track || (typeof extra.track === 'number' ? extra.track : 0),
    trackTotal: base.trackTotal || (typeof extra.trackTotal === 'number' ? extra.trackTotal : 0),
    disc: base.disc || (typeof extra.disc === 'number' ? extra.disc : 0),
    composer: base.composer || (extra.composer ? String(extra.composer) : undefined),
    barcode: base.barcode || (extra.barcode ? String(extra.barcode) : undefined),
    releaseType: base.releaseType || (extra.releaseType ? String(extra.releaseType) : undefined),
    isrc: base.isrc || (extra.isrc ? String(extra.isrc) : ''),
    cover: (foundWins && foundCover) || base.cover || foundCover || '',
    confirmedMatch: Boolean(saved?.confirmedMatch),
  }
  // Also mutate `t` in place so components reading `useShell().data.tracks` directly see the overlaid metadata
  Object.assign(t, overlaid)
  return overlaid
}

export function overlayTracks(tracks: Track[], hidden: readonly string[] = getHiddenFolders()): Track[] {
  const shown = tracks.filter((t) => !isTrackHidden(t, hidden) && !isTrackDeleted(t.id)).map(overlayTrack)
  return withArtistGenres(withCuratedInfo(withArrivalOrder(shown)))
}

const PC_FIRST_SEEN = 'shell.pcFirstSeen'
/** When this phone first listed the PC's songs (seconds); set the first time it does. 0 without PC songs. */
function pcFirstSeen(tracks: Track[]): number {
  if (!tracks.some(isPcTrack)) return 0
  try {
    let at = Number(localStorage.getItem(PC_FIRST_SEEN))
    if (!at) {
      at = Math.floor(Date.now() / 1000)
      localStorage.setItem(PC_FIRST_SEEN, String(at))
    }
    return at
  } catch {
    return 0
  }
}

/**
 * §91 A: songs sort by when they arrived in this library. The phone's own songs came first; the PC's library arrived
 * when the phone first listed it, in the PC's own order, so its songs sit just after that moment (keeping their order).
 * Anything added later on either side, by its own date, is newest.
 */
export function withArrivalOrder(tracks: Track[], firstSeen = pcFirstSeen(tracks)): Track[] {
  if (!firstSeen) return tracks
  return tracks.map((t) => (isPcTrack(t) && t.added <= firstSeen ? { ...t, added: firstSeen - 1 + t.added / 1e10 } : t))
}

const twinKey = (t: Track) => `${t.title.toLowerCase().replace(/\s+/g, ' ').trim()}\u0000${t.artist.toLowerCase().trim()}`

/**
 * Council 2026-11-19: a song on both the phone and the PC is listed once, as the phone's copy, with `pcTwin` set
 * (playing picks the better copy, engine.ts resolveBestTrack). Matched song by song: title, artist, length within 3 s.
 * Only the browsing lists use it (Library, search, album and artist pages): playlists and playlist sync keep the ids they
 * were saved with.
 */
export function mergeTwins(tracks: Track[]): Track[] {
  const local = new Map<string, Track[]>()
  for (const t of tracks) if (!isPcTrack(t) && t.title && t.artist) local.set(twinKey(t), [...(local.get(twinKey(t)) ?? []), t])
  if (!local.size) return tracks
  const twinOf = new Map<string, Track>()
  const dropped = new Set<string>()
  for (const t of tracks) {
    if (!isPcTrack(t) || !t.title || !t.artist) continue
    const mine = local.get(twinKey(t))?.find((l) => !twinOf.has(l.id) && Math.abs((l.sec || 0) - (t.sec || 0)) <= 3)
    if (!mine) continue
    twinOf.set(mine.id, t)
    dropped.add(t.id)
  }
  if (!dropped.size) return tracks
  return tracks.filter((t) => !dropped.has(t.id)).map((t) => {
    const pc = twinOf.get(t.id)
    return pc ? { ...t, pcTwin: pc.id, cover: t.cover || pc.cover, genre: t.genre || pc.genre } : t
  })
}

/** A song of the curated list (data/songs.json): what it tests ("bass", "busy", "vocals", ...) and its genre. */
export interface CuratedSong { title: string; artist: string; category: string; genre?: string }
let curated = new Map<string, CuratedSong[]>()
const squashName = (s: string) => (s || '').normalize('NFKD').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')
/** The title and, for "Song - Extended Version" or "Song - Artist" rips, the part before the dash. */
const titleKeys = (title: string) => [...new Set([title, title.split(/\s+[-–=]\s+/)[0]].map(squashName).filter(Boolean))]

/** Loads the curated list (Shell.tsx at start-up), then the library re-overlays with its categories. */
export function setCuratedSongs(songs: CuratedSong[]) {
  curated = new Map()
  for (const s of songs) for (const k of titleKeys(s.title)) curated.set(k, [...(curated.get(k) ?? []), s])
  notifyDetailsChanged()
}

/** The curated song this track is, matched by title and, when more than one shares it, by artist. */
export function curatedMatch(t: Pick<Track, 'title' | 'artist'>): CuratedSong | null {
  const artist = squashName(splitArtists(t.artist)[0] ?? '')
  for (const k of titleKeys(t.title)) {
    const found = curated.get(k) ?? []
    if (found.length === 1 && (!artist || squashName(found[0].artist).includes(artist) || artist.includes(squashName(found[0].artist).slice(0, 6)))) return found[0]
    const byArtist = found.find((s) => !artist || squashName(s.artist).includes(artist) || artist.includes(squashName(s.artist).slice(0, 6)))
    if (byArtist) return byArtist
  }
  return null
}

/**
 * Songs of the curated list get its category (what they test: the cover colour) and, if their tags have none, its
 * genre. The library never carried these, and a random genre used to hide it (plan §76 follow-up). 242 of the PC's
 * 635 songs match; none matched the wrong artist when checked.
 */
export function withCuratedInfo(tracks: Track[]): Track[] {
  if (!curated.size) return tracks
  return tracks.map((t) => {
    if (t.category && t.genre) return t
    const song = curatedMatch(t)
    if (!song) return t
    return { ...t, category: t.category || song.category, genre: t.genre || song.genre || '' }
  })
}

/**
 * A song with no genre (in its tags or the online details) takes the genre most of the same artist's songs carry
 * (plan §76 G), so its cover gets a real genre instead of none. Only on these overlaid copies: files and the raw
 * library keep what they had.
 */
export function withArtistGenres(tracks: Track[]): Track[] {
  const votes = new Map<string, Map<string, number>>()
  // "Unknown Artist" isn't an artist: its songs vote for nothing and take nothing from each other
  const artistOf = (t: Track) => {
    const a = splitArtists(t.artist)[0]?.toLowerCase() ?? ''
    return /^unknown(\s+artist)?$/.test(a) ? '' : a
  }
  for (const t of tracks) {
    const artist = artistOf(t)
    if (!t.genre || !artist) continue
    const tally = votes.get(artist) ?? new Map<string, number>()
    tally.set(t.genre, (tally.get(t.genre) ?? 0) + 1)
    votes.set(artist, tally)
  }
  if (!votes.size) return tracks
  const usual = new Map([...votes].map(([artist, tally]) => [artist, [...tally].sort((a, b) => b[1] - a[1])[0][0]]))
  return tracks.map((t) => {
    if (t.genre) return t
    // a rip with no artist ("NAS - The World Is Yours"): either side of the dash may be an artist the library knows
    const genre = usual.get(artistOf(t)) ?? cleanRipTitle(t.title || '').split(/\s+-\s+/).map((part) => usual.get(splitArtists(part)[0]?.toLowerCase() ?? '')).find(Boolean)
    return genre ? { ...t, genre } : t
  })
}

/**
 * Returns the active library with hidden folders filtered out and saved online metadata (title, artist, album, year,
 * genre, cover) overlaid onto every track. Works both as an array (`const tracks = useLibrary()`) and as a destructurable
 * object (`const { tracks, playlists, hiddenFolders } = useLibrary()`).
 */
export function useLibrary(explicitTracks?: Track[]): Track[] & LibraryData & { hiddenFolders: string[] } {
  const shell = useContext(ShellContext)
  const detailsVersion = useDetailsVersion()
  const hiddenFolders = useHiddenFolders()
  const deletedVer = useDeletedTracks()
  const rawTracks = explicitTracks ?? shell?.data.tracks ?? []
  const playlists = shell?.data.playlists ?? []

  const tracks = useMemo(() => {
    void detailsVersion
    void deletedVer
    return overlayTracks(rawTracks, hiddenFolders)
  }, [rawTracks, hiddenFolders, detailsVersion, deletedVer])

  return useMemo(() => {
    const hybrid = [...tracks] as Track[] & LibraryData & { hiddenFolders: string[] }
    hybrid.tracks = tracks
    hybrid.playlists = playlists
    hybrid.hiddenFolders = hiddenFolders
    return hybrid
  }, [tracks, playlists, hiddenFolders])
}

export const SORTS = [
  ['latest', 'Latest'],
  ['oldest', 'Oldest'],
  ['size-desc', 'Size (Largest first)'],
  ['size-asc', 'Size (Smallest first)'],
  ['a-z', 'Title (A-Z)'],
  ['z-a', 'Title (Z-A)'],
  ['artist-asc', 'Artist (A-Z)'],
  ['artist-desc', 'Artist (Z-A)'],
  ['album-asc', 'Album (A-Z)'],
  ['album-desc', 'Album (Z-A)'],
  ['release-newest', 'Release Date (Newest)'],
  ['release-oldest', 'Release Date (Oldest)'],
  ['genre-asc', 'Genre (A-Z)'],
  ['genre-desc', 'Genre (Z-A)'],
] as const
export type SortMode = (typeof SORTS)[number][0]

/** The icon beside a sort in the sort menu. */
export function sortIcon(mode: SortMode): string {
  if (mode === 'a-z' || mode === 'z-a') return 'sort_by_alpha'
  if (mode.startsWith('artist')) return 'person'
  if (mode.startsWith('album')) return 'album'
  if (mode.startsWith('release')) return 'event'
  if (mode.startsWith('genre')) return 'category'
  if (mode.startsWith('size')) return 'storage'
  return 'schedule'
}

export const FORMATS = ['FLAC', 'MP3', 'M4A / MP4', 'AAC', 'ALAC', 'OPUS', 'OGG', 'WAV', 'AIFF', 'APE', 'WavPack', 'DSF', 'DFF', 'MPC', 'EAC3', 'AC3', 'AC4'] as const

export const METADATA_FILTERS = [
  ['complete', 'Complete metadata'],
  ['missing-any', 'Missing any metadata'],
  ['missing-year', 'Missing year'],
  ['missing-genre', 'Missing genre'],
  ['missing-album-artist', 'Missing album artist'],
  ['missing-track', 'Missing track number'],
  ['missing-disc', 'Missing disc number'],
  ['missing-artist', 'Missing artist'],
  ['bad-isrc', 'Incorrect ISRC format'],
  ['missing-isrc', 'Missing ISRC'],
  ['missing-label', 'Missing label'],
  ['missing-lyrics', 'Missing lyrics'],
  ['has-replaygain', 'Has ReplayGain'],
  ['missing-replaygain', 'Missing ReplayGain'],
  ['incomplete-album', 'Incomplete albums'],
  ['unknown-album', 'Album completeness unknown'],
] as const
export type MetadataFilter = (typeof METADATA_FILTERS)[number][0]

export interface Filters {
  source: 'downloaded' | 'local' | null
  quality: 'hires' | 'cd' | 'lossy' | null
  format: string | null
  metadata: MetadataFilter | null
}

export const NO_FILTERS: Filters = { source: null, quality: null, format: null, metadata: null }

export const activeFilterCount = (f: Filters) => [f.source, f.quality, f.format, f.metadata].filter(Boolean).length

// the same fields Mornye counts as complete (library_queue_store.dart)
const missingAny = (t: Track) =>
  !t.year || !t.genre || !t.albumArtist || !t.track || !t.disc || !t.artist || !t.label || (!!t.isrc && !t.isrcOk)

/** Whose album a song is on: its album artist, else the first artist named (so "Kanye West, Dwele" stays on Kanye's Graduation). */
export const albumOwner = (t: Track) => t.albumArtist || splitArtists(t.artist)[0] || t.artist

export function albumKey(t: Track): string {
  if (!t.album) return ''
  return `${albumOwner(t).toLowerCase()}\u0000${t.album.toLowerCase()}`
}

function albumCounts(tracks: Track[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tracks) {
    const k = albumKey(t)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

function matchesMetadata(t: Track, m: MetadataFilter, counts: Map<string, number>): boolean {
  switch (m) {
    case 'complete': return !missingAny(t)
    case 'missing-any': return missingAny(t)
    case 'missing-year': return !t.year
    case 'missing-genre': return !t.genre
    case 'missing-album-artist': return !t.albumArtist
    case 'missing-track': return !t.track
    case 'missing-disc': return !t.disc
    case 'missing-artist': return !t.artist
    case 'bad-isrc': return !!t.isrc && !t.isrcOk
    case 'missing-isrc': return !t.isrc
    case 'missing-label': return !t.label
    case 'missing-lyrics': return !t.lyrics
    case 'has-replaygain': return t.replayGain
    case 'missing-replaygain': return !t.replayGain
    case 'incomplete-album': return t.trackTotal > 0 && (counts.get(albumKey(t)) ?? 0) < t.trackTotal
    case 'unknown-album': return !t.trackTotal
  }
}

const FORMAT_ALIASES: Record<string, string[]> = { 'M4A / MP4': ['M4A', 'MP4'], WavPack: ['WV', 'WAVPACK'] }

export function filterTracks(tracks: Track[], f: Filters, query = ''): Track[] {
  const counts = f.metadata ? albumCounts(tracks) : new Map<string, number>()
  const q = query.trim().toLowerCase()
  const formats = f.format ? FORMAT_ALIASES[f.format] ?? [f.format.toUpperCase()] : null
  return tracks.filter((t) => {
    if (f.source === 'downloaded' && !t.downloaded) return false
    if (f.source === 'local' && t.downloaded) return false
    if (f.quality === 'lossy' && !t.lossy) return false
    if (f.quality === 'hires' && (t.lossy || t.bits <= 16)) return false
    if (f.quality === 'cd' && (t.lossy || t.bits !== 16)) return false
    if (formats && !formats.includes(t.format)) return false
    if (f.metadata && !matchesMetadata(t, f.metadata, counts)) return false
    if (q && !`${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) return false
    return true
  })
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Text sorts put songs with an empty field last, whichever way they run. */
function byText(pick: (t: Track) => string, dir: 1 | -1) {
  return (a: Track, b: Track) => {
    const x = pick(a)
    const y = pick(b)
    if (!x !== !y) return x ? -1 : 1
    return dir * collator.compare(x, y)
  }
}

function byDate(dir: 1 | -1) {
  return (a: Track, b: Track) => {
    if (!a.date !== !b.date) return a.date ? -1 : 1
    return dir * a.date.localeCompare(b.date)
  }
}

export function sortTracks(tracks: Track[], mode: SortMode): Track[] {
  const list = [...tracks]
  const cmp: Record<SortMode, (a: Track, b: Track) => number> = {
    latest: (a, b) => b.added - a.added,
    oldest: (a, b) => a.added - b.added,
    'size-desc': (a, b) => b.size - a.size,
    'size-asc': (a, b) => a.size - b.size,
    'a-z': byText((t) => t.title, 1),
    'z-a': byText((t) => t.title, -1),
    'artist-asc': byText((t) => t.artist, 1),
    'artist-desc': byText((t) => t.artist, -1),
    'album-asc': byText((t) => t.album, 1),
    'album-desc': byText((t) => t.album, -1),
    'release-newest': byDate(-1),
    'release-oldest': byDate(1),
    'genre-asc': byText((t) => t.genre, 1),
    'genre-desc': byText((t) => t.genre, -1),
  }
  return list.sort(cmp[mode])
}

export interface Album {
  key: string
  name: string
  artist: string
  tracks: Track[]
  cover: string
  added: number
}

/**
 * Everything sharing an album name and artist. A one-track album counts as a single, as in Mornye. With `order` (the
 * Library's sort, §91 A) albums come in the order of the already sorted songs (by title becomes by album name);
 * without it, newest first.
 */
export function groupAlbums(tracks: Track[], order?: SortMode): { albums: Album[]; singles: Album[] } {
  const groups = new Map<string, Album>()
  for (const t of tracks) {
    const key = albumKey(t)
    if (!key) continue
    let a = groups.get(key)
    if (!a) {
      a = { key, name: t.album, artist: albumOwner(t), tracks: [], cover: t.cover, added: t.added }
      groups.set(key, a)
    }
    a.tracks.push(t)
    a.cover ||= t.cover
    a.added = Math.max(a.added, t.added)
  }
  const all = [...groups.values()]
  if (!order) all.sort((a, b) => b.added - a.added)
  else if (order === 'a-z' || order === 'z-a') all.sort((a, b) => (order === 'a-z' ? 1 : -1) * collator.compare(a.name, b.name))
  for (const a of all) a.tracks.sort((x, y) => x.disc - y.disc || x.track - y.track)
  return { albums: all.filter((a) => a.tracks.length > 1), singles: all.filter((a) => a.tracks.length === 1) }
}

// Names that contain a comma but are one artist. Mornye keeps "A, B" as a single artist; we don't copy that bug.
const COMMA_NAMES = ['Tyler, The Creator', 'Earth, Wind & Fire', 'Grover Washington, Jr.', 'Crosby, Stills & Nash', 'Emerson, Lake & Palmer', 'Blood, Sweat & Tears']
/** Duos and bands named with "&" or "and": one artist whatever the separators (§92 A). */
const WHOLE_NAMES = ['Simon & Garfunkel', 'Simon and Garfunkel', 'Hall & Oates', 'Daryl Hall & John Oates', 'Earth, Wind & Fire', 'Mumford & Sons', 'Florence + the Machine', 'Marina and the Diamonds', 'Echo & the Bunnymen', 'Sly and the Family Stone']

/**
 * Metadata separators: the marks that split one artist tag into separate artists. Comma, semicolon, and ampersand are on by
 * default. Slash and × are off because they sit inside names (AC/DC, K/DA).
 */
export const SEPARATORS = [
  { id: 'sepcomma', mark: ',', label: 'Comma (,)', on: true },
  { id: 'sepsemi', mark: ';', label: 'Semicolon (;)', on: true },
  { id: 'sepslash', mark: '/', label: 'Slash (/)', on: false },
  { id: 'septimes', mark: '×', label: 'Times sign (×)', on: false },
  { id: 'sepamp', mark: '&', label: 'Ampersand (&)', on: true },
] as const

export const DEFAULT_SEPARATORS: string[] = SEPARATORS.filter((s) => s.on).map((s) => s.mark)

const escaped = (mark: string) => mark.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function splitArtists(text: string, separators: readonly string[] = DEFAULT_SEPARATORS): string[] {
  if (!text) return []
  let rest = text
  const found: string[] = []
  for (const name of [...WHOLE_NAMES, ...(separators.includes(',') ? COMMA_NAMES : [])]) {
    const at = rest.toLowerCase().indexOf(name.toLowerCase())
    if (at < 0) continue
    const real = rest.slice(at, at + name.length)
    if (!found.includes(real)) found.push(real)
    rest = rest.split(real).join('\u0000')
  }
  // & only splits with spaces round it, so R&B and names like "AT&T" stay whole.
  // Also split on collaboration markers: 'feat.', 'ft.', 'vs.' ("and" no longer: it sits inside band names)
  const marks = [
    '\u0000',
    '\\s+(?:feat\\.?|ft\\.?|featuring|vs\\.?)\\s+',
    ...separators.map((m) => (m === '&' ? '\\s+&\\s+' : `\\s*${escaped(m)}\\s*`)),
  ]
  for (const part of rest.split(new RegExp(marks.join('|'), 'i'))) {
    const clean = part.trim()
    if (clean && !found.includes(clean)) found.push(clean)
  }
  return found
}

/**
 * YouTube-rip noise in a title (§72.A4):
 * - Bracketed notes like "(Official Video)", "[Lyrics]", "【MV】"
 * - Label and promo brackets like "[Chillhop Records]", "[Monstercat …]", "[FREE DOWNLOAD]", "(With Download Link!)", "[NCS Release]"
 * - Unbracketed "Official Video", "Official Audio", "Official Music Video", "Lyric Video", "Full ver.", "Full Version", "MV", "M/V", "HD", "4K"
 * - Anything after "►" or "|", and underscores standing in for spaces.
 */
const RIP_BRACKET_NOTE = /\s*[([【「][^)\]】」]*\b(official|video|audio|lyrics?|mv|m\/v|hd|hq|4k|visuali[sz]er|full\s*song|full\s*ver(?:sion)?\.?|explicit|color\s*coded|eng|sub|subs|romaji|music\s*video|topic|records?|recordings?|monstercat|chillhop|ncs|release|free\s*download|download\s*link|with\s*download|album\s*exclusive|out\s*now|premiere|copyright\s*free|no\s*copyright|original\s*song|chorus\s*of\s*\d+|project\s+\w+|seal\s*the\s*deal)\b[^)\]】」]*[)\]】」]/gi

const UNBRACKETED_RIP_SUFFIX = /(?:\s+-\s+|\s+|(?<=[a-z0-9\u3040-\u30ff\u4e00-\u9faf]))(?:official\s+music\s+video|official\s+lyric\s+video|official\s+video|official\s+audio|lyric\s+video|music\s+video|full\s+ver(?:sion)?\.?)(?=\s*$|\s+-\s+|\s*[([【「])/gi

const UNBRACKETED_TOKENS = /(?:\s+-\s+|\s+)\b(?:m\/v|mv|hd|hq|4k)\b(?=\s*$)/gi

/**
 * §93 Batch 2: which recording a title names beyond the song itself: "Remix", "Live", "Acoustic", "Secret Track",
 * "(Beach Picnic Version)"… Two titles with different keys are different recordings (other lyrics, other length), even
 * when the bare titles agree. "Original Mix", "Album/Single/Radio Version" and remasters name the usual recording: no key.
 */
export function versionKey(title: string): string {
  const words = new Set<string>()
  const t = title.toLowerCase()
  for (const w of ['remix', 'live', 'acoustic', 'instrumental', 'demo', 'extended', 'slowed', 'sped up', 'nightcore', 'unplugged', 'karaoke', 'secret track', 'hidden track', 'cover']) {
    if (new RegExp(`\\b${w}\\b`).test(t)) words.add(w)
  }
  for (const m of t.matchAll(/([\p{L}\p{N} ]+?)\s+version\b/gu)) {
    const what = m[1].trim().split(/\s+/).slice(-2).join(' ')
    if (!/^(album|original|single|radio|explicit|clean|main|full|short|long|lp|ep|\d{4}|remastered?|stereo|mono)$/.test(what.split(' ').pop() ?? '')) words.add(`${what} version`)
  }
  return [...words].sort().join('+')
}

export function cleanRipTitle(title: string): string {
  const halfwidth = title.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  const cleaned = halfwidth
    .replace(/^synthesia\s*-\s*/i, '')
    .replace(RIP_BRACKET_NOTE, '')
    .replace(UNBRACKETED_RIP_SUFFIX, '')
    .replace(UNBRACKETED_TOKENS, '')
    .replace(/\s*[►|│].*$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*-\s*|\s*-\s*$/g, '')
    .trim()
  return cleaned || title.trim()
}

export const cleanTitle = cleanRipTitle

const OST_LABEL_RE = /\b(ost|original\s+soundtrack|soundtrack|bgm|mod\s+music|game\s+music|battle\s+theme)\b/i
const GAME_SERIES_RE = /^(initial\s+d|a\s+hat\s+in\s+time|final\s+fantasy\b.*|terraria\b.*|deemo\b.*|cytus\b.*|arcaea\b.*|undertale\b.*|deltarune\b.*|persona\b.*|nier\b.*|xenoblade\b.*|genshin\b.*|honkai\b.*|touhou\b.*|東方\b.*|danganronpa\b.*|danganrompa\b.*)$/i

function stripOstWords(text: string): string {
  return text
    .replace(/\s*[([【「][^)\]】」]*[)\]】」]/g, '')
    .replace(/\b(ost|original\s+soundtrack|soundtrack|bgm|mod\s+music|game\s+music|music)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits a YouTube-style title into ordered candidate readings `{ title, artist, album? }` (§72.A4).
 * Handles "Artist - Title", "Title - Artist", "Game OST - Title" (title with no artist, confirmed by length),
 * and 3-part "Series - Artist - Title" or "Title - Artist - Game" titles.
 */
export function splitYoutubeTitle(rawTitle: string): { title: string; artist: string; album?: string }[] {
  const title = cleanRipTitle(rawTitle)
  const parts = title.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean)
  const seen = new Set<string>()
  const out: { title: string; artist: string; album?: string }[] = []
  const add = (r: { title: string; artist: string; album?: string }) => {
    const t = r.title.trim()
    const a = r.artist.trim()
    if (!t) return
    const key = `${t.toLowerCase()}\u0000${a.toLowerCase()}\u0000${(r.album ?? '').toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ title: t, artist: a, ...(r.album ? { album: r.album.trim() } : {}) })
  }

  if (parts.length === 1) {
    add({ title, artist: '' })
    const bare = title.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim()
    if (bare && bare !== title) add({ title: bare, artist: '' })
    return out
  }

  const firstIsOst = OST_LABEL_RE.test(parts[0]) || GAME_SERIES_RE.test(parts[0])
  const albumHint = firstIsOst ? stripOstWords(parts[0]) : undefined

  if (parts.length >= 3) {
    if (firstIsOst) {
      // e.g. "Initial D - Fastway - Love Countdown" or "Terraria Calamity Mod Music - Servants of The Scourge - Theme of ..."
      add({ title: parts[2], artist: parts[1], album: albumHint })
      add({ title: parts[1], artist: parts[2], album: albumHint })
      add({ title: parts[1], artist: '', album: albumHint })
      add({ title: `${parts[1]} - ${parts[2]}`, artist: '', album: albumHint })
    } else {
      // e.g. "Wish Upon a Shooting Star - SUi - Deemo 2.4" or "Synthesia - John Stump - Death Waltz"
      add({ title: parts[0], artist: parts[1] })
      add({ title: parts[2], artist: parts[1] })
      add({ title: parts[1], artist: parts[0] })
      add({ title: parts[1], artist: '' })
    }
    add({ title, artist: '' })
    return out
  }

  const [a, b] = parts
  if (firstIsOst) {
    // "Game OST - Title": left side is soundtrack/game, not the artist; search as title with no artist (confirmed by length)
    const bareB = b.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim()
    add({ title: b, artist: '', album: albumHint })
    if (bareB && bareB !== b) add({ title: bareB, artist: '', album: albumHint })
    if (albumHint) add({ title: b, artist: albumHint, album: albumHint })
    add({ title: a, artist: b })
    add({ title, artist: '' })
    return out
  }

  // Standard 2-part "A - B": try both Title - Artist and Artist - Title
  add({ title: a, artist: b })
  add({ title: b, artist: a })

  // Handle "chill Badsummer - Still Shining" where a genre word prefixes the artist
  const strippedGenrePrefix = a.replace(/^(?:chill|lofi|lo-fi|nightcore|vocaloid|touhou|eurobeat)\s+/i, '').trim()
  if (strippedGenrePrefix && strippedGenrePrefix !== a) {
    add({ title: b, artist: strippedGenrePrefix })
  }

  // Handle bilingual left side like "ロクデナシただ声一つ Rokudenashi - One Voice"
  const latinMatch = a.match(/([A-Za-z][A-Za-z0-9\s.&'-]{1,})$/)
  if (latinMatch && latinMatch[1].trim() !== a) {
    add({ title: b, artist: latinMatch[1].trim() })
  }

  const bareB = b.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim()
  if (bareB && bareB !== b) {
    add({ title: bareB, artist: a })
    add({ title: bareB, artist: '' })
  }
  add({ title: b, artist: '' })
  add({ title, artist: '' })
  return out
}

/**
 * The ways to read a song whose artist tag is empty, best first. "A - B" is Title - Artist in this library's own
 * naming ("1985 - Freddie Gibbs"), but Artist - Title in most YouTube rips ("NAS - The World Is Yours"): both are tried,
 * and a match needs the title, an artist and the length to agree, so the wrong order simply doesn't match.
 */
export function readingsOf<T extends Pick<Track, 'title' | 'artist'> & { album?: string }>(t: T): T[] {
  const title = cleanRipTitle(t.title)
  if (t.artist) return [{ ...t, title }]
  const splits = splitYoutubeTitle(t.title)
  return splits.map((s) => ({
    ...t,
    title: s.title,
    artist: s.artist,
    ...(s.album && !t.album ? { album: s.album } : {}),
  }))
}

export function withArtistFromTitle<T extends Pick<Track, 'title' | 'artist'>>(t: T): T {
  if (t.artist) return t
  const cleaned = cleanRipTitle(t.title)
  const parts = cleaned.split(' - ')
  if (parts.length > 1 && parts[0].trim() && parts[1].trim()) {
    if (OST_LABEL_RE.test(parts[0]) || GAME_SERIES_RE.test(parts[0])) {
      return { ...t, title: parts[parts.length - 1].trim(), artist: '' }
    }
    return { ...t, title: parts[0].trim(), artist: parts[1].trim() }
  }
  return cleaned !== t.title ? { ...t, title: cleaned } : t
}

export interface Artist {
  name: string
  tracks: Track[]
  cover: string
  /** By album artist: songs where this artist is only a guest (in the song's Artist tag). */
  appearsOn: Track[]
}

/** Whose album it is: the album artist, or the song's artist when there's none (or it's a compilation's "Various Artists"). */
const mainArtist = (t: Track) => (t.albumArtist && !/^various( artists)?$/i.test(t.albumArtist.trim()) ? t.albumArtist : t.artist)

/**
 * The Artists list. By album artist (§92 A, the default), every main artist once and guests under their "Appears on";
 * otherwise everyone named on a song is an artist of their own.
 */
export function groupArtists(tracks: Track[], separators: readonly string[] = DEFAULT_SEPARATORS, byAlbumArtist = false): Artist[] {
  const groups = new Map<string, Artist>()
  for (const t of tracks) {
    for (const name of splitArtists(byAlbumArtist ? mainArtist(t) : t.artist, separators)) {
      const key = name.toLowerCase()
      let a = groups.get(key)
      if (!a) {
        a = { name, tracks: [], cover: t.cover, appearsOn: [] }
        groups.set(key, a)
      }
      a.tracks.push(t)
      a.cover ||= t.cover
    }
  }
  if (byAlbumArtist) {
    for (const t of tracks) {
      const main = new Set(splitArtists(mainArtist(t), separators).map((n) => n.toLowerCase()))
      for (const name of splitArtists(t.artist, separators)) {
        if (!main.has(name.toLowerCase())) groups.get(name.toLowerCase())?.appearsOn.push(t)
      }
    }
  }
  return [...groups.values()].sort((a, b) => collator.compare(a.name, b.name))
}

/** A folder's songs in file-name order, with numbers in a name compared as numbers. */
export const sortByFileName = (tracks: Track[]): Track[] => {
  const name = (t: Track) => t.path.split('/').pop() ?? t.path
  return [...tracks].sort((a, b) => collator.compare(name(a), name(b)))
}

export function groupFolders(tracks: Track[]): { folder: string; tracks: Track[] }[] {
  const groups = new Map<string, Track[]>()
  for (const t of tracks) {
    const list = groups.get(t.folder)
    if (list) list.push(t)
    else groups.set(t.folder, [t])
  }
  return [...groups.entries()].map(([folder, list]) => ({ folder, tracks: list })).sort((a, b) => collator.compare(a.folder, b.folder))
}

/** Windows paths (a drive letter or a network share) are shown with backslashes; phone folders keep their slashes. */
export const folderPath = (folder: string) => (/^([a-z]:|\/\/)/i.test(folder) ? folder.replace(/\//g, '\\') : folder)

export const folderName = (folder: string) => folder.split('/').filter(Boolean).pop() ?? folder

/** Can be played now: a format the player decodes, in a folder that's there. */
export const canPlay = (t: Track) => t.playable !== false && !t.offline

/** Moves one item, leaving the list it was given alone. An index outside the list changes nothing. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

const FOUR_WEEKS = 28 * 24 * 60 * 60

/** Tracks that joined the library in the four weeks up to its newest one. Keeps the banner off a library with nothing recent. */
export function recentTracks(tracks: Track[]): Track[] {
  const newest = tracks.reduce((n, t) => Math.max(n, t.added), 0)
  return tracks.filter((t) => t.added > 0 && t.added > newest - FOUR_WEEKS)
}

export function shuffled<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** The heading an artist falls under in the A-Z list. */
export function initial(name: string): string {
  const c = name.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}

/** "FLAC 24-bit/96kHz", "MP3 320kbps". A value the file didn't report (0, as Android's MediaStore often gives) is left out. */
export function qualityLabel(t: Track): string {
  const words = (...parts: string[]) => parts.filter(Boolean).join(' ')
  if (t.lossy) return words(t.format, t.kbps > 0 ? `${t.kbps}kbps` : '') || 'Lossy'
  const spec = [t.bits > 0 ? `${t.bits}-bit` : '', t.rate > 0 ? `${(t.rate / 1000).toFixed(1).replace(/\.0$/, '')}kHz` : '']
  return words(t.format, spec.filter(Boolean).join('/')) || 'Lossless'
}

/** 24-bit / hi-res lossless, or a Dolby format: these get the light-blue quality pill. */
export const isPremiumQuality = (t: Pick<Track, 'lossy' | 'bits' | 'rate' | 'format'>) =>
  (!t.lossy && (t.bits > 16 || t.rate > 48000)) || /^(E?AC-?[34]|TRUEHD|ATMOS)/i.test(t.format || '')

export function duration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export const trackCount = (n: number) => `${n} ${n === 1 ? 'track' : 'tracks'}`

export const playlistCount = (n: number) => `${n} ${n === 1 ? 'playlist' : 'playlists'}`

export const coverUrl = (id: string) => {
  if (!id) return ''
  if (id.startsWith('data:') || id.startsWith('http://') || id.startsWith('https://') || id.startsWith('blob:') || id.startsWith('/')) {
    return id
  }
  const cached = cachedSavedCover(id)
  if (cached) return cached
  return `/shell-host/cover?id=${id}`
}

/** What fits in the 40px genre circle: short names whole, "hip-hop" as "HH", long single words cut to four letters. */
export function genreBadge(genre: string): string {
  if (genre.length <= 4) return genre
  const words = genre.split(/[-\s/&]+/).filter(Boolean)
  return words.length > 1 ? words.slice(0, 3).map((w) => w[0].toUpperCase()).join('') : genre.slice(0, 4)
}

// ---- playlists (plan Phase 4C). "Favorites" is the heart's own list, so it doesn't light the yellow +.
const isFavoritesList = (p: Playlist) => p.name.toLowerCase() === 'favorites'

/** Names of the user's own playlists holding this song (not Favorites). */
export const playlistNamesForTrack = (playlists: Playlist[], trackId: string): string[] =>
  playlists.filter((p) => !isFavoritesList(p) && p.tracks.includes(trackId)).map((p) => p.name)

/**
 * Playlists to list: one whose songs are all hidden (or gone) is left out, an empty one stays. The saved list keeps
 * every song in order, so unhiding a folder brings it back as it was.
 */
export const visiblePlaylists = (playlists: Playlist[], shown: { has(id: string): boolean }): Playlist[] =>
  playlists.filter((p) => !p.tracks.length || p.tracks.some((id) => shown.has(id) || Boolean(p.missing?.[id])))

/** Ids of the songs in hidden folders: kept in the statistics, left out of every total and list. */
export const hiddenTrackIds = (tracks: Track[], hidden: readonly string[] = getHiddenFolders()): Set<string> =>
  new Set(hidden.length ? tracks.filter((t) => isTrackHidden(t, hidden)).map((t) => t.id) : [])

/** True when the song is in one of the user's own playlists: the + shows yellow. */
export const isPlaylistSaved = (playlists: Playlist[], trackId: string): boolean => playlistNamesForTrack(playlists, trackId).length > 0

/** The library without that playlist. Its songs stay in the library. */
export const deletePlaylist = (data: LibraryData, playlistId: string): LibraryData => ({
  ...data,
  playlists: data.playlists.filter((p) => p.id !== playlistId),
})

/** The library with these songs taken out of one playlist. */
export function removeFromPlaylist(data: LibraryData, playlistId: string, trackIds: string[]): LibraryData {
  const drop = new Set(trackIds)
  return { ...data, playlists: data.playlists.map((p) => (p.id === playlistId ? { ...p, tracks: p.tracks.filter((x) => !drop.has(x)) } : p)) }
}

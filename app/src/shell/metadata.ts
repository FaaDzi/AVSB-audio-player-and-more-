// Look up details: fills a song's empty fields from MusicBrainz, Cover Art Archive and Deezer, when the listener
// asks on the Song page or enables background library naming in Settings -> Metadata. Results stay on this device;
// audio files are never changed.
import { useSyncExternalStore } from 'react'
import {
  cachedSavedCover as getLibraryCachedCover, cleanRipTitle, cleanTitle, DEFAULT_SEPARATORS,
  deleteMemoryCover, notifyDetailsChanged, readingsOf, registerCoverLoader, registerNamingSink, setMemoryCover,
  splitArtists, splitYoutubeTitle, useDetailsVersion, versionKey, type Track,
} from './library'
import { logLine } from './logs'
import { waitMs } from '../platform'
import { getSetting, setSetting } from './settings/store'
import { android, setMetaBannerState } from './localLibrary'

export { cleanRipTitle, cleanTitle, readingsOf, splitYoutubeTitle, useDetailsVersion }

export type ProviderId = 'musicbrainz' | 'coverart' | 'deezer' | 'itunes'
export const PROVIDERS: { id: ProviderId; name: string; sub: string; icon: string }[] = [
  { id: 'musicbrainz', name: 'MusicBrainz', sub: 'Open music database: album, label, track number, composer, ISRC', icon: 'library_music' },
  { id: 'coverart', name: 'Cover Art Archive', sub: 'Covers for MusicBrainz releases, so it needs MusicBrainz on', icon: 'image' },
  { id: 'deezer', name: 'Deezer', sub: 'Public catalogue: genre, label, barcode, cover', icon: 'public' },
  { id: 'itunes', name: 'Apple Music / iTunes', sub: 'Free public search: 3000px high-res covers, genre, album, release year', icon: 'album' },
]

export const FIELDS = ['album', 'albumArtist', 'track', 'trackTotal', 'disc', 'date', 'genre', 'label', 'composer', 'barcode', 'releaseType', 'isrc'] as const
export type Field = (typeof FIELDS)[number]
export type Values = Partial<Record<Field, string | number>>

/** These belong to one edition of an album, so they're only taken from a release with the same album name as ours. */
const RELEASE_FIELDS: Field[] = ['album', 'albumArtist', 'track', 'trackTotal', 'disc', 'date', 'label', 'barcode', 'releaseType']

export interface Candidate {
  provider: ProviderId
  title: string
  artists: string[]
  seconds: number
  /** The release's album name, when it has one. */
  album?: string
  values: Values
  cover?: string
  /** The recording's ISRCs, when the source gives them. */
  isrcs?: string[]
}

export interface Found {
  values: Values
  from: Partial<Record<Field | 'cover', ProviderId>>
  /** A data: URL, kept in IndexedDB rather than with the fields. */
  cover?: string
  at: number
  /** Found clean song title and artist (§72.A1). */
  title?: string
  artist?: string
  /** Original file title and artist before overlaying (§72.A1/A3). */
  originalTitle?: string
  originalArtist?: string
  /** True when the song was matched with strong confidence or accepted by the user. */
  confirmedMatch?: boolean
  /** True when the background namer checked online and found nothing or the user rejected the suggestion (§72.A5). */
  notFoundOnline?: boolean
  /** The found cover shows instead of the file's own, which is under 300 px (§87 Import song art). */
  replaceCover?: boolean
}

export type SavedDetails = Found

export type Match = 'strong' | 'weak' | 'none'

const MAX_LENGTH_DIFFERENCE_S = 10

/** Lower case, no accents, no edition notes, no punctuation: what two spellings of one title share. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/, '')
    .replace(/\b(feat|ft)\.?\s.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Strong: same length (within 10 s), title and an artist (or distinctive title + album/duration for untagged rips). Weak: same length and one of the two. */
export function matchOf(t: Track, c: Candidate): Match {
  if (t.sec > 0 && c.seconds > 0 && Math.abs(t.sec - c.seconds) > MAX_LENGTH_DIFFERENCE_S) return 'none'
  // the same ISRC is the same recording, even when the source spells it in another script (エイリアンエイリアン)
  if (t.isrc && c.isrcs?.some((i) => i.toUpperCase() === t.isrc.toUpperCase())) return 'strong'
  const normT = normalize(t.title)
  // a version named in the title ("(Beach Picnic Version) [Secret Track]") must be the found one's too
  const title = normT !== '' && normT === normalize(c.title) && versionKey(t.title) === versionKey(c.title)
  const ours = new Set([t.artist, ...splitArtists(t.artist, DEFAULT_SEPARATORS)].map(normalize).filter(Boolean))
  const artist = c.artists.some((a) => ours.has(normalize(a)))
  if (title && artist) return 'strong'
  if (title && !ours.size) {
    const albumHintMatches = Boolean(t.album && c.album && (normalize(c.album).includes(normalize(t.album)) || normalize(t.album).includes(normalize(c.album))))
    const closeLength = t.sec > 0 && c.seconds > 0 && Math.abs(t.sec - c.seconds) <= 4
    const distinctiveTitle = normT.length >= 10 || t.title.trim().split(/\s+/).length >= 2
    if (albumHintMatches || (closeLength && distinctiveTitle)) return 'strong'
  }
  return title || artist ? 'weak' : 'none'
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === 0

/** The fields this song has nothing in. */
export function missingFields(t: Track): Field[] {
  return FIELDS.filter((f) => isEmpty(f === 'date' ? t.date || t.year : t[f]))
}

const sameAlbum = (t: Track, c: Candidate) => !t.album || (c.album !== undefined && (normalize(c.album) === normalize(t.album) || normalize(c.album).includes(normalize(t.album)) || normalize(t.album).includes(normalize(c.album))))

/**
 * Fills only what's missing, in provider order: the first provider with a value for a field wins. Edition fields come
 * only from a release with our album name, so a song isn't given a compilation's track number or label.
 */
export function merge(t: Track, candidates: Candidate[], order: ProviderId[]): Found {
  const missing = new Set(missingFields(t))
  const ranked = [...candidates].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider))
  const found: Found = { values: {}, from: {}, at: Date.now() }
  for (const c of ranked) {
    for (const f of FIELDS) {
      const v = c.values[f]
      if (!missing.has(f) || isEmpty(v) || found.values[f] !== undefined) continue
      if (RELEASE_FIELDS.includes(f) && !sameAlbum(t, c)) continue
      found.values[f] = v
      found.from[f] = c.provider
    }
    if (!t.cover && !found.cover && c.cover && sameAlbum(t, c)) {
      found.cover = c.cover
      found.from.cover = c.provider
    }
  }
  return found
}

/** Provider Priority as saved, with any provider added since at the end. */
export function providerOrder(): { order: ProviderId[]; off: Set<ProviderId> } {
  let saved: { enabled?: string[]; disabled?: string[] } = {}
  try { saved = JSON.parse(String(getSetting('metadataproviders') ?? '{}')) } catch { /* default order */ }
  const known = PROVIDERS.map((p) => p.id)
  const enabled = (saved.enabled ?? []).filter((id): id is ProviderId => known.includes(id as ProviderId))
  const off = new Set((saved.disabled ?? []).filter((id): id is ProviderId => known.includes(id as ProviderId)))
  return { order: [...enabled, ...known.filter((id) => !enabled.includes(id) && !off.has(id))], off }
}

// ---- network: everything goes through the host's allow-listed /shell-host/meta route

const via = (url: string) => `/shell-host/meta?url=${encodeURIComponent(url)}`

// MusicBrainz allows one request a second from each caller
let mbQueue: Promise<unknown> = Promise.resolve()
export const MB_GAP_MS = 1100

/** "Slow down" from a site (429, or MusicBrainz's 503): try again later, never "nothing found" (§94 A). */
export const isRateLimited = (e: unknown) => /HTTP (429|503)/.test(String(e))

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(via(url))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

// §94 A: after a second "slow down" in a row, MusicBrainz rests for 30 s; calls in that time fail at once
let mbRestUntil = 0
const MB_REST_MS = 30_000

function mb<T>(path: string): Promise<T | null> {
  const url = `https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`
  const run = mbQueue.then(async () => {
    if (Date.now() < mbRestUntil) throw new Error('HTTP 503 (MusicBrainz resting)')
    try {
      return await getJson<T>(url)
    } catch (e) {
      if (!isRateLimited(e)) throw e
      // one quick retry for a passing 503
      await waitMs(3000)
      try {
        return await getJson<T>(url)
      } catch (again) {
        if (isRateLimited(again)) mbRestUntil = Date.now() + MB_REST_MS
        throw again
      }
    }
  })
  mbQueue = run.catch(() => null).then(() => waitMs(MB_GAP_MS))
  return run
}

async function imageData(url: string): Promise<string | undefined> {
  const response = await fetch(via(url))
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return undefined
  const blob = await response.blob()
  return new Promise((done) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result))
    reader.onerror = () => done(undefined)
    reader.readAsDataURL(blob)
  })
}

interface MbCredit { name: string; artist?: { name: string } }
interface MbRelease {
  id: string
  title: string
  status?: string
  date?: string
  barcode?: string
  'artist-credit'?: MbCredit[]
  'release-group'?: { id: string; 'primary-type'?: string; 'first-release-date'?: string }
  'label-info'?: { label?: { name: string } }[]
  media?: { position: number; 'track-count': number; tracks?: { position: number; recording?: { id: string } }[] }[]
  genres?: { name: string; count: number }[]
}
interface MbRecording {
  id: string
  title: string
  length?: number
  'artist-credit'?: MbCredit[]
  isrcs?: string[]
  releases?: MbRelease[]
  genres?: { name: string; count: number }[]
  relations?: { type: string; work?: { id: string } }[]
}

const credits = (c?: MbCredit[]) => (c ?? []).map((a) => a.artist?.name ?? a.name)
const topGenre = (g?: { name: string; count: number }[]) => {
  const best = [...(g ?? [])].sort((a, b) => b.count - a.count)[0]?.name
  return best ? best.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined
}
const joined = (c?: MbCredit[]) => (c ?? []).map((a) => a.name).join(', ')

/** The release to read edition fields from: ours by album name, else the earliest official album. */
function chooseRelease(t: Track, releases: MbRelease[]): MbRelease | undefined {
  const official = releases.filter((r) => !r.status || r.status === 'Official')
  const named = t.album
    ? official.find((r) => normalize(r.title) === normalize(t.album) || normalize(r.title).includes(normalize(t.album)) || normalize(t.album).includes(normalize(r.title)))
    : undefined
  if (named) return named
  return [...official].sort((a, b) => {
    const album = (r: MbRelease) => (r['release-group']?.['primary-type'] === 'Album' ? 0 : 1)
    return album(a) - album(b) || (a.date || '9999').localeCompare(b.date || '9999')
  })[0]
}

async function fromMusicBrainz(t: Track, useCovers: boolean, missing: Set<Field>): Promise<Candidate | null> {
  const quoted = (s: string) => `"${s.replace(/["\\]/g, ' ')}"`
  const firstArtist = (splitArtists(t.artist)[0] ?? t.artist).trim()
  const query = t.isrc
    ? `isrc:${t.isrc}`
    : firstArtist
      ? `recording:${quoted(t.title)} AND artist:${quoted(firstArtist)}`
      : t.album
        ? `recording:${quoted(t.title)} AND release:${quoted(t.album)}`
        : `recording:${quoted(t.title)}`
  const search = await mb<{ recordings?: MbRecording[] }>(`recording?query=${encodeURIComponent(query)}&limit=10`)
  const hit = (search?.recordings ?? [])
    .map((r) => ({ r, c: { provider: 'musicbrainz' as const, title: r.title, artists: credits(r['artist-credit']), seconds: (r.length ?? 0) / 1000, values: {}, isrcs: t.isrc ? [t.isrc] : r.isrcs } }))
    .map((x) => ({ ...x, m: matchOf(t, x.c) }))
    .filter((x) => x.m !== 'none')
    .sort((a, b) => (a.m === b.m ? 0 : a.m === 'strong' ? -1 : 1))[0]
  if (!hit) return null

  const recording = await mb<MbRecording>(`recording/${hit.r.id}?inc=releases+release-groups+genres+isrcs+work-rels`)
  if (!recording) return null
  const values: Values = { isrc: recording.isrcs?.[0], genre: topGenre(recording.genres) }
  const chosen = chooseRelease(t, recording.releases ?? [])
  let cover: string | undefined
  if (chosen) {
    const release = await mb<MbRelease>(`release/${chosen.id}?inc=labels+recordings+release-groups+artist-credits+genres`)
    if (release) {
      const medium = release.media?.find((m) => m.tracks?.some((x) => x.recording?.id === recording.id))
      const place = medium?.tracks?.find((x) => x.recording?.id === recording.id)
      Object.assign(values, {
        album: release.title,
        albumArtist: joined(release['artist-credit']),
        track: place?.position,
        trackTotal: medium?.['track-count'],
        disc: medium?.position,
        date: release['release-group']?.['first-release-date'] || release.date,
        label: release['label-info']?.find((l) => l.label)?.label?.name,
        barcode: release.barcode || undefined,
        releaseType: release['release-group']?.['primary-type'],
        genre: values.genre ?? topGenre(release.genres),
      })
      if (useCovers && !t.cover) {
        cover = await imageData(`https://coverartarchive.org/release/${release.id}/front-500`).catch(() => undefined)
        const group = release['release-group']?.id
        if (!cover && group) cover = await imageData(`https://coverartarchive.org/release-group/${group}/front-500`).catch(() => undefined)
      }
    }
  }
  const work = recording.relations?.find((r) => r.type === 'performance' && r.work)?.work?.id
  if (work && missing.has('composer')) {
    const w = await mb<{ relations?: { type: string; artist?: { name: string } }[] }>(`work/${work}?inc=artist-rels`)
    const writers = (w?.relations ?? []).filter((r) => r.type === 'composer' || r.type === 'writer').map((r) => r.artist?.name).filter(Boolean)
    if (writers.length) values.composer = [...new Set(writers)].join(', ')
  }
  return { ...hit.c, album: chosen?.title, values, cover }
}

interface DzTrack { id: number; title: string; title_short?: string; duration: number; readable?: boolean; isrc?: string; track_position?: number; disk_number?: number; artist: { name: string }; contributors?: { name: string }[]; album: { id: number; title: string } }
interface DzAlbum { title: string; upc?: string; label?: string; release_date?: string; record_type?: string; nb_tracks?: number; cover_big?: string; genres?: { data: { name: string }[] }; artist?: { name: string } }

async function fromDeezer(t: Track, useCovers: boolean): Promise<Candidate | null> {
  const toCandidate = (d: DzTrack): Candidate => ({ provider: 'deezer', title: d.title_short || d.title, artists: [d.artist.name, ...(d.contributors ?? []).map((c) => c.name)], seconds: d.duration, album: d.album.title, values: {}, isrcs: d.isrc ? [d.isrc] : undefined })
  let pickedTrack: DzTrack | null = null
  if (t.isrc) {
    const byIsrc = await getJson<DzTrack & { error?: unknown }>(`https://api.deezer.com/track/isrc:${encodeURIComponent(t.isrc)}`)
    if (byIsrc && !byIsrc.error && matchOf(t, toCandidate(byIsrc)) !== 'none') pickedTrack = byIsrc
  }
  if (!pickedTrack || !sameAlbum(t, toCandidate(pickedTrack))) {
    const firstArtist = (splitArtists(t.artist)[0] ?? t.artist).trim()
    const q = [firstArtist || t.album, t.title].filter(Boolean).join(' ')
    const search = await getJson<{ data?: DzTrack[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`)
    const scored = (search?.data ?? []).map((d) => ({ d, c: toCandidate(d), m: matchOf(t, toCandidate(d)) })).filter((x) => x.m !== 'none')
    const best = scored.find((x) => x.m === 'strong' && sameAlbum(t, x.c)) ?? scored.find((x) => x.m === 'strong') ?? scored[0]
    if (best && (!pickedTrack || sameAlbum(t, best.c))) pickedTrack = best.d
  }
  if (!pickedTrack) return null
  const [full, album] = await Promise.all([
    getJson<DzTrack>(`https://api.deezer.com/track/${pickedTrack.id}`),
    getJson<DzAlbum>(`https://api.deezer.com/album/${pickedTrack.album.id}`),
  ])
  const d = full ?? pickedTrack
  const kinds: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', compile: 'Compilation' }
  const values: Values = {
    isrc: d.isrc,
    track: d.track_position,
    disc: d.disk_number,
    album: album?.title,
    albumArtist: album?.artist?.name,
    trackTotal: album?.nb_tracks,
    date: album?.release_date,
    label: album?.label,
    barcode: album?.upc,
    releaseType: album?.record_type ? kinds[album.record_type] ?? album.record_type : undefined,
    genre: album?.genres?.data[0]?.name,
  }
  const cover = useCovers && !t.cover && album?.cover_big ? await imageData(album.cover_big).catch(() => undefined) : undefined
  return { ...toCandidate(d), values, cover }
}

interface ItunesSong {
  trackName?: string
  artistName?: string
  collectionName?: string
  trackTimeMillis?: number
  artworkUrl100?: string
  releaseDate?: string
  primaryGenreName?: string
  trackNumber?: number
  discNumber?: number
}

async function fromItunes(t: Track, useCovers: boolean): Promise<Candidate | null> {
  const firstArtist = (splitArtists(t.artist)[0] ?? t.artist).trim()
  const q = [firstArtist, t.title].filter(Boolean).join(' ')
  if (!q) return null
  const json = await getJson<{ results?: ItunesSong[] }>(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=5`)
  const results = json?.results
  if (!Array.isArray(results) || !results.length) return null

  const candidates: { r: ItunesSong; c: Candidate; m: 'strong' | 'weak' | 'none' }[] = []
  for (const r of results) {
    if (!r.trackName) continue
    const c: Candidate = {
      provider: 'itunes',
      title: r.trackName,
      artists: r.artistName ? [r.artistName] : [],
      album: r.collectionName,
      seconds: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
      values: {
        album: r.collectionName,
        date: r.releaseDate ? r.releaseDate.slice(0, 10) : undefined,
        genre: r.primaryGenreName,
        track: r.trackNumber,
        disc: r.discNumber,
      },
    }
    const m = matchOf(t, c)
    if (m !== 'none') candidates.push({ r, c, m })
  }
  const best = candidates.find((x) => x.m === 'strong') ?? candidates[0]
  if (!best) return null
  let cover: string | undefined
  if (useCovers && best.r.artworkUrl100 && !t.cover) {
    const artUrl = best.r.artworkUrl100.replace('100x100bb.jpg', '3000x3000bb.jpg')
    cover = await imageData(artUrl).catch(() => undefined)
  }
  return { ...best.c, cover }
}

export interface Lookup {
  /** Saved straight away: every source that gave something agreed on title, artist and length. */
  found: Found | null
  /** From a match that agreed on length and only one of title or artist. Shown for the listener to accept. */
  possible: Found | null
  /** The song as the sources name it, when a strong match said who it is (a rip's file name rarely does). */
  identity?: { title: string; artist: string }
  /** MusicBrainz was resting (it asked us to slow down) and nothing was found without it: ask again on a later run. */
  later?: boolean
}

/**
 * Asks the enabled sources in order. Sends the title, artist, album, length and ISRC; nothing else.
 * MusicBrainz first even when Deezer ranks higher, since Cover Art Archive needs its release.
 */
/** `coversFirst` (Import song art, §94 A): Deezer and iTunes are asked first, and MusicBrainz (one request a second,
 * 3-4 per song) only when neither has a strong match with a cover. */
export async function lookUp(song: Track, coversFirst = false): Promise<Lookup> {
  const originalTitle = song.originalTitle ?? song.title
  const originalArtist = song.originalArtist ?? song.artist
  let fallback: Lookup = { found: null, possible: null }
  for (const reading of readingsOf({ ...song, title: originalTitle, artist: originalArtist })) {
    const r = await lookUpAs({ ...song, ...reading, originalTitle, originalArtist }, coversFirst)
    if (r.found) return r
    if (!fallback.possible && r.possible) fallback = r
    if (r.later) fallback = { ...fallback, later: true }
  }
  return fallback
}

export const lookupTrackDetails = lookUp

async function lookUpAs(t: Track, coversFirst = false): Promise<Lookup> {
  const { order, off } = providerOrder()
  const missing = new Set(missingFields(t))
  const candidates: Candidate[] = []
  const coverArt = !off.has('coverart')
  const quick = coversFirst
    ? await Promise.all([
      off.has('deezer') ? null : fromDeezer(t, true).catch(() => null),
      off.has('itunes') ? null : fromItunes(t, coverArt).catch(() => null),
    ])
    : null
  const coveredQuickly = quick?.some((c) => c?.cover && matchOf(t, c) === 'strong') ?? false
  // §100: while the namer runs, MusicBrainz is its own; song art takes what Deezer and iTunes have and asks again later
  let mbResting = Boolean(coversFirst && !coveredQuickly && namingLoopActive && !off.has('musicbrainz'))
  if (!off.has('musicbrainz') && !coveredQuickly && !mbResting) {
    const c = await fromMusicBrainz(t, coverArt, missing).catch((e) => {
      // song art carries on with Deezer and iTunes; everything else waits and asks again
      if (isRateLimited(e) && coversFirst) { mbResting = true; return null }
      if (isRateLimited(e)) throw e
      logLine('WARN', 'Details', `MusicBrainz: ${e}`)
      return null
    })
    if (c) {
      // its cover counts as Cover Art Archive's, for the priority order
      if (c.cover) candidates.push({ ...c, provider: 'coverart', values: {} })
      candidates.push({ ...c, cover: undefined })
    }
  }
  if (quick) {
    for (const c of quick) if (c) candidates.push(c)
  } else if (!off.has('deezer')) {
    const c = await fromDeezer(t, true).catch((e) => { logLine('WARN', 'Details', `Deezer: ${e}`); return null })
    if (c) candidates.push(c)
  }
  if (!quick && !off.has('itunes')) {
    const c = await fromItunes(t, coverArt).catch((e) => { logLine('WARN', 'Details', `iTunes: ${e}`); return null })
    if (c) candidates.push(c)
  }
  const strong = candidates.filter((c) => matchOf(t, c) === 'strong')
  const weak = candidates.filter((c) => matchOf(t, c) === 'weak')
  const found = strong.length ? merge(t, strong, order) : null
  const filled = { ...t, ...found?.values, cover: t.cover || (found?.cover ? 'found' : '') } as Track
  const possible = weak.length ? merge(filled, weak, order) : null

  const named = strong.find((c) => c.provider !== 'coverart')
  const weakNamed = weak.find((c) => c.provider !== 'coverart')
  const origTitle = t.originalTitle ?? t.title
  const origArtist = t.originalArtist ?? t.artist

  if (found && named) {
    found.title = named.title || t.title
    found.artist = named.artists[0] ?? t.artist
    found.originalTitle = origTitle
    found.originalArtist = origArtist
    found.confirmedMatch = true
  }
  if (possible && weakNamed) {
    possible.title = weakNamed.title || t.title
    possible.artist = weakNamed.artists[0] ?? t.artist
    possible.originalTitle = origTitle
    possible.originalArtist = origArtist
  }

  const some = (f: Found | null) => (f && (Object.keys(f.values).length || f.cover || f.title || f.artist) ? f : null)
  logLine('INFO', 'Details', `"${t.title}": ${Object.keys(found?.values ?? {}).length} fields found, ${Object.keys(possible?.values ?? {}).length} possible`)
  return {
    found: some(found),
    possible: some(possible),
    identity: named ? { title: named.title, artist: named.artists[0] ?? t.artist } : undefined,
    later: mbResting && !some(found),
  }
}

// ---- saved on this PC: fields in localStorage, covers in IndexedDB + memory cache

const KEY = 'shell.details.'
const COVERS_DB = 'shell-details'
const changed = () => notifyDetailsChanged()

const pendingCoverLoads = new Set<string>()
const missingCoverLoads = new Set<string>()

function requestLazyCover(id: string) {
  if (pendingCoverLoads.has(id) || missingCoverLoads.has(id) || typeof indexedDB === 'undefined') return
  pendingCoverLoads.add(id)
  void savedCover(id)
    .then((res) => {
      if (res) changed()
      else missingCoverLoads.add(id)
    })
    .finally(() => {
      pendingCoverLoads.delete(id)
    })
}

registerCoverLoader(requestLazyCover)

export function cachedSavedCover(id: string): string | undefined {
  const hit = getLibraryCachedCover(id)
  if (!hit) requestLazyCover(id)
  return hit
}

export function savedDetails(id: string): Found | null {
  try {
    const raw = localStorage.getItem(KEY + id)
    return raw ? (JSON.parse(raw) as Found) : null
  } catch {
    return null
  }
}

export const getSavedDetails = savedDetails

function coversDb(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const open = indexedDB.open(COVERS_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('covers')
    open.onerror = () => fail(open.error)
    open.onsuccess = () => done(open.result)
  })
}

export async function savedCover(id: string): Promise<string | undefined> {
  const cached = getLibraryCachedCover(id)
  if (cached) return cached
  try {
    const db = await coversDb()
    try {
      const result = await new Promise<string | undefined>((done) => {
        const get = db.transaction('covers').objectStore('covers').get(id)
        get.onsuccess = () => done(get.result as string | undefined)
        get.onerror = () => done(undefined)
      })
      if (result) setMemoryCover(id, result)
      return result
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

/** Every saved cover, for the backup file. */
export async function exportSavedCovers(): Promise<Record<string, string>> {
  const db = await coversDb()
  try {
    return await new Promise((done, fail) => {
      const out: Record<string, string> = {}
      const req = db.transaction('covers').objectStore('covers').openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return done(out)
        if (typeof c.value === 'string') out[String(c.key)] = c.value
        c.continue()
      }
      req.onerror = () => fail(req.error)
    })
  } finally {
    db.close()
  }
}

/** Puts a backup's covers back (only images: a non-image value from a hand-edited file is skipped). */
export async function importSavedCovers(covers: Record<string, string>) {
  const db = await coversDb()
  try {
    await new Promise<void>((done, fail) => {
      const tx = db.transaction('covers', 'readwrite')
      for (const [id, data] of Object.entries(covers)) if (typeof data === 'string' && data.startsWith('data:image/')) tx.objectStore('covers').put(data, id)
      tx.oncomplete = () => done()
      tx.onerror = () => fail(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Adds to what was saved before; a field already saved is kept, while newly confirmed title/artist update the song. */
export async function saveDetails(id: string, found: Found) {
  const before = savedDetails(id)
  const { cover, ...rest } = found
  const next: Found = {
    values: { ...rest.values, ...before?.values },
    from: { ...rest.from, ...before?.from },
    at: found.at,
    title: rest.title ?? before?.title,
    artist: rest.artist ?? before?.artist,
    originalTitle: before?.originalTitle ?? rest.originalTitle,
    originalArtist: before?.originalArtist ?? rest.originalArtist,
    confirmedMatch: rest.confirmedMatch ?? before?.confirmedMatch,
    notFoundOnline: rest.notFoundOnline ?? before?.notFoundOnline,
    replaceCover: rest.replaceCover ?? before?.replaceCover,
  }
  // a cover counts as found only once its image is stored: the mark alone (a restored backup) used to block every new one
  if (cover) {
    setMemoryCover(id, cover)
    try {
      const db = await coversDb()
      await new Promise<void>((done, fail) => {
        const tx = db.transaction('covers', 'readwrite')
        tx.objectStore('covers').put(cover, id)
        tx.oncomplete = () => done()
        tx.onerror = () => fail(tx.error)
      })
      db.close()
    } catch { /* ignore in non-IDB environments */ }
    next.from.cover = found.from.cover ?? 'coverart'
  } else if (before?.from.cover) {
    next.from.cover = before.from.cover
  }
  localStorage.setItem(KEY + id, JSON.stringify(next))
  changed()
}

export async function clearDetails(id: string) {
  localStorage.removeItem(KEY + id)
  deleteMemoryCover(id)
  removePossibleMatch(id)
  try {
    const db = await coversDb()
    await new Promise<void>((done) => {
      const tx = db.transaction('covers', 'readwrite')
      tx.objectStore('covers').delete(id)
      tx.oncomplete = () => done()
      tx.onerror = () => done()
    })
    db.close()
  } catch { /* ignore */ }
  changed()
}

/** Restores the file's original title, artist and tags by clearing saved overlay details (§72.A1/A3). */
export const undoTrackDetails = clearDetails

export const PROVIDER_NAMES: Record<ProviderId, string> = { musicbrainz: 'MusicBrainz', coverart: 'Cover Art Archive', deezer: 'Deezer', itunes: 'Apple Music / iTunes' }

// ---- §72.A5 & A6: Background Library Naming Runner ("Name the YouTube Rips") ----

const POSSIBLE_KEY = 'shell.details.possible.v1'
const namingListeners = new Set<() => void>()

export function notifyNamingChanged() {
  cachedNamingSnapshot = null
  namingListeners.forEach((l) => l())
}

export function subscribeNaming(l: () => void): () => void {
  namingListeners.add(l)
  return () => { namingListeners.delete(l) }
}

export interface PossibleMatchEntry {
  id: string
  originalTitle: string
  originalArtist: string
  suggestedTitle: string
  suggestedArtist: string
  suggestedAlbum?: string
  confidence?: number
  possible: Found
}

export function getPossibleMatches(): PossibleMatchEntry[] {
  try {
    const raw = localStorage.getItem(POSSIBLE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePossibleMatches(list: PossibleMatchEntry[]) {
  try {
    localStorage.setItem(POSSIBLE_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
  notifyNamingChanged()
}

export function upsertPossibleMatch(entry: PossibleMatchEntry) {
  const current = getPossibleMatches().filter((x) => x.id !== entry.id)
  savePossibleMatches([entry, ...current].slice(0, 100))
}

function removePossibleMatch(id: string) {
  const current = getPossibleMatches()
  const next = current.filter((x) => x.id !== id)
  if (next.length !== current.length) savePossibleMatches(next)
}

export async function acceptPossibleMatch(id: string) {
  const entry = getPossibleMatches().find((x) => x.id === id)
  if (!entry) return
  removePossibleMatch(id)
  await saveDetails(id, {
    ...entry.possible,
    title: entry.suggestedTitle,
    artist: entry.suggestedArtist,
    originalTitle: entry.originalTitle,
    originalArtist: entry.originalArtist,
    confirmedMatch: true,
    notFoundOnline: false,
    at: Date.now(),
  })
}

export function rejectPossibleMatch(id: string) {
  const entry = getPossibleMatches().find((x) => x.id === id)
  removePossibleMatch(id)
  const before = savedDetails(id)
  const next: Found = {
    values: before?.values ?? {},
    from: before?.from ?? {},
    at: Date.now(),
    originalTitle: before?.originalTitle ?? entry?.originalTitle,
    originalArtist: before?.originalArtist ?? entry?.originalArtist,
    notFoundOnline: true,
  }
  try {
    localStorage.setItem(KEY + id, JSON.stringify(next))
  } catch { /* ignore */ }
  notifyNamingChanged()
}

/** True when a track looks like an untagged rip, YouTube-style filename, or is missing key metadata (§72.A5). */
export function needsNaming(t: Track): boolean {
  const saved = savedDetails(t.id)
  if (saved?.confirmedMatch || saved?.notFoundOnline) return false
  if (getPossibleMatches().some((p) => p.id === t.id)) return false
  const origArtist = (t.originalArtist ?? t.artist ?? '').trim()
  const origTitle = (t.originalTitle ?? t.title ?? '').trim()
  if (!origArtist || /^unknown(\s+artist)?$/i.test(origArtist)) return true
  if (cleanRipTitle(origTitle) !== origTitle) return true
  if (/\s+[-–—]\s+/.test(origTitle) && !t.album) return true
  if (!t.album || !t.cover || !(t.date || t.year)) return true
  return false
}

export interface NamingStatus {
  enabled: boolean
  running: boolean
  done: number
  total: number
  currentTitle: string
  /** why it is paused, e.g. a site asked to slow down */
  waiting: string
  possible: PossibleMatchEntry[]
}

let namingTracks: Track[] = []
let namingLoopActive = false
/** The background namer is asking MusicBrainz right now: the bulk art job waits its turn (one request a second). */
export const isNamingRunning = () => namingLoopActive
let namingDoneCount = 0
let namingTotalCount = 0
let namingCurrentTitle = ''
let namingWaiting = ''
let cachedNamingSnapshot: NamingStatus | null = null

export function isNamingEnabled(): boolean {
  return Boolean(getSetting('autoname'))
}

export function setNamingEnabled(on: boolean) {
  setSetting('autoname', on)
  cachedNamingSnapshot = null
  notifyNamingChanged()
  if (on) void startNamingRunner()
}

let lastFedIds = ''
export function feedNamingTracks(tracks: Track[]) {
  const ids = tracks.length ? `${tracks.length}:${tracks[0].id}:${tracks[tracks.length - 1].id}` : ''
  if (ids === lastFedIds && namingTracks.length === tracks.length) {
    namingTracks = tracks
    return
  }
  lastFedIds = ids
  namingTracks = tracks
  notifyNamingChanged()
  if (isNamingEnabled() && !namingLoopActive) {
    void startNamingRunner()
  }
}

registerNamingSink(feedNamingTracks)

/** One song through the online lookup: named, offered as a possible match, or marked as not found. */
export async function nameOne(track: Track) {
  try {
    const res = await lookUp(track)
    if (res.found) {
      await saveDetails(track.id, {
        ...res.found,
        title: res.identity?.title ?? res.found.title,
        artist: res.identity?.artist ?? res.found.artist,
        originalTitle: track.originalTitle ?? track.title,
        originalArtist: track.originalArtist ?? track.artist,
        confirmedMatch: true,
      })
    } else if (res.possible) {
      upsertPossibleMatch({
        id: track.id,
        originalTitle: track.originalTitle ?? track.title,
        originalArtist: track.originalArtist ?? track.artist,
        suggestedTitle: res.possible.title || cleanRipTitle(track.originalTitle ?? track.title),
        suggestedArtist: res.possible.artist || (res.possible.values.albumArtist as string | undefined) || track.artist || 'Unknown artist',
        suggestedAlbum: (res.possible.values.album as string | undefined) || track.album || undefined,
        possible: res.possible,
      })
    } else {
      const before = savedDetails(track.id)
      const mark: Found = {
        values: before?.values ?? {},
        from: before?.from ?? {},
        at: Date.now(),
        originalTitle: track.originalTitle ?? track.title,
        originalArtist: track.originalArtist ?? track.artist,
        notFoundOnline: true,
      }
      localStorage.setItem(KEY + track.id, JSON.stringify(mark))
    }
  } catch (e) {
    if (isRateLimited(e)) throw e
    logLine('WARN', 'Details', `Auto-name failed for "${track.title}": ${e}`)
    const before = savedDetails(track.id)
    const mark: Found = {
      values: before?.values ?? {},
      from: before?.from ?? {},
      at: Date.now(),
      originalTitle: track.originalTitle ?? track.title,
      originalArtist: track.originalArtist ?? track.artist,
      notFoundOnline: true,
    }
    try { localStorage.setItem(KEY + track.id, JSON.stringify(mark)) } catch { /* ignore */ }
  }
}

async function startNamingRunner() {
  if (namingLoopActive) return
  namingLoopActive = true
  cachedNamingSnapshot = null
  notifyNamingChanged()
  const initialPending = namingTracks.filter(needsNaming)
  if (!initialPending.length) {
    setSetting('autoname', false)
    namingLoopActive = false
    cachedNamingSnapshot = null
    notifyNamingChanged()
    return
  }
  setMetaBannerState('refreshing')
  void android?.setWakeLock?.({ enabled: true }).catch(() => {})
  try {
    while (isNamingEnabled()) {
      const pending = namingTracks.filter(needsNaming)
      namingTotalCount = namingDoneCount + pending.length
      if (!pending.length) {
        // Automatically deactivate the switch when all missing tracks are done
        setSetting('autoname', false)
        notifyNamingChanged()
        break
      }
      const track = pending[0]
      namingCurrentTitle = track.originalTitle ?? track.title
      cachedNamingSnapshot = null
      notifyNamingChanged()

      try {
        await nameOne(track)
      } catch (e) {
        // MusicBrainz asked to slow down: the same song is tried again in a minute
        logLine('INFO', 'Details', `Song naming: ${String(e)}, waiting a minute`)
        namingWaiting = 'The site asked to slow down: waiting a minute'
        cachedNamingSnapshot = null
        notifyNamingChanged()
        await waitMs(60_000)
        namingWaiting = ''
        continue
      }
      namingDoneCount++
      cachedNamingSnapshot = null
      notifyNamingChanged()
      await waitMs(MB_GAP_MS)
    }
  } finally {
    void android?.setWakeLock?.({ enabled: false }).catch(() => {})
    namingLoopActive = false
    namingCurrentTitle = ''
    cachedNamingSnapshot = null
    notifyNamingChanged()
    if (namingDoneCount > 0) {
      setMetaBannerState('done')
      setTimeout(() => setMetaBannerState(null), 2500)
    } else {
      setMetaBannerState(null)
    }
  }
}

export function resetNamingAndRescan() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(KEY)) {
        try {
          const val = JSON.parse(localStorage.getItem(key) || '{}') as Found
          if (val.notFoundOnline && !val.confirmedMatch) {
            localStorage.removeItem(key)
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  namingDoneCount = 0
  namingTotalCount = 0
  setNamingEnabled(true)
}

export interface MatchedTrackEntry {
  track: Track
  details: SavedDetails
}

export function getMatchedTracks(allTracks: Track[]): MatchedTrackEntry[] {
  const result: MatchedTrackEntry[] = []
  for (const track of allTracks) {
    const details = savedDetails(track.id)
    if (details && (details.confirmedMatch || details.title || details.artist || (details.values && Object.keys(details.values).length > 0))) {
      result.push({ track, details })
    }
  }
  return result
}

function getNamingSnapshot(): NamingStatus {
  if (cachedNamingSnapshot) return cachedNamingSnapshot
  const pending = namingTracks.filter(needsNaming).length
  const total = namingLoopActive ? Math.max(namingTotalCount, namingDoneCount + pending) : namingDoneCount + pending
  cachedNamingSnapshot = {
    enabled: isNamingEnabled(),
    running: namingLoopActive,
    done: namingDoneCount,
    total,
    currentTitle: namingCurrentTitle,
    waiting: namingWaiting,
    possible: getPossibleMatches(),
  }
  return cachedNamingSnapshot
}

export function useNamingStatus(): NamingStatus {
  return useSyncExternalStore(subscribeNaming, getNamingSnapshot)
}

// ---- Online artist avatar/logo lookup via Deezer ----
const artistPhotoCache = new Map<string, string | null>()
/** At most 200 artists remembered this session, oldest dropped first (review item 11). */
function rememberArtistPhoto(name: string, url: string | null) {
  artistPhotoCache.delete(name)
  artistPhotoCache.set(name, url)
  while (artistPhotoCache.size > 200) artistPhotoCache.delete(artistPhotoCache.keys().next().value as string)
}
const artistPhotoListeners = new Set<() => void>()

export function subscribeArtistPhotos(fn: () => void) {
  artistPhotoListeners.add(fn)
  return () => { artistPhotoListeners.delete(fn) }
}

function notifyArtistPhotos() {
  artistPhotoListeners.forEach((fn) => fn())
}

export function getCachedArtistPhoto(artist: string): string | null {
  const norm = artist.trim().toLowerCase()
  if (!norm) return null
  if (artistPhotoCache.has(norm)) return artistPhotoCache.get(norm) ?? null
  try {
    const saved = localStorage.getItem(`artist_avatar_${norm}`)
    if (saved) {
      rememberArtistPhoto(norm, saved)
      return saved
    }
  } catch {}
  return null
}

export async function lookupArtistPhoto(artist: string): Promise<string | null> {
  const norm = artist.trim().toLowerCase()
  if (!norm || norm === 'unknown' || norm === 'unknown artist' || norm === 'various artists') return null
  const cached = getCachedArtistPhoto(artist)
  if (cached) return cached

  try {
    const q = encodeURIComponent(artist.trim())
    const url = via(`https://api.deezer.com/search/artist?q=${q}&limit=1`)
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Array<{ picture_medium?: string; picture_big?: string; picture?: string }> }
    const first = json.data?.[0]
    const photoUrl = first?.picture_medium || first?.picture_big || first?.picture
    if (photoUrl) {
      const proxiedPhoto = via(photoUrl)
      rememberArtistPhoto(norm, proxiedPhoto)
      try {
        localStorage.setItem(`artist_avatar_${norm}`, proxiedPhoto)
      } catch {}
      notifyArtistPhotos()
      return proxiedPhoto
    }
  } catch (e) {
    // Silent fallback
  }
  rememberArtistPhoto(norm, null)
  return null
}

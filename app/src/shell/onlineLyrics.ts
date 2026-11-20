import { cleanRipTitle, versionKey, withArtistFromTitle, type Track } from './library'
import { host } from './host'
import { logLine } from './logs'
import { savedDetails } from './metadata'
import { getSetting } from './settings/store'

/** Lyrics Provider Priority: LRCLIB is the only provider, on unless it was switched off there. */
export function lyricsProviderOn(): boolean {
  try {
    const saved = JSON.parse(String(getSetting('lyricsproviders') ?? '{}')) as { disabled?: string[] }
    return !saved.disabled?.includes('lrclib')
  } catch {
    return true
  }
}

/** With the setting on, a .lrc beside the song keeps what was found. The installed app only; it never replaces one. */
function keepAsLrc(t: Track, text: string) {
  const bridge = host()
  if (!getSetting('savelrc') || !bridge) return
  void bridge.saveLyrics(t.path, text).then((result) => logLine('INFO', 'Lyrics', `.lrc for "${t.title}": ${result}`))
}

/** LRCLIB, the open lyrics database: no key, built for this. Only ever called when the listener asks. */
const API = 'https://lrclib.net/api'
const MAX_LENGTH_DIFFERENCE_S = 10
/** Confirmed online matches or untagged YouTube rips with intros/outros allow up to ±15 s (§72.A2). */
const RIP_LENGTH_TOLERANCE_S = 15

interface LrcLibRecord {
  trackName?: string
  artistName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const savedKey = (id: string) => `shell.lyrics.${id}`

export function savedOnlineLyrics(id: string): string | null {
  try { return localStorage.getItem(savedKey(id)) } catch { return null }
}

/** Saved lyrics picked by rankLyrics (plan §76 C). Lyrics saved earlier get one quiet re-pick when next shown. */
const rankedKey = (id: string) => `shell.lyrics.ranked.${id}`
export const lyricsRanked = (id: string) => { try { return localStorage.getItem(rankedKey(id)) === '1' } catch { return true } }

/** Keeps this version for the song ("Try another version", or the search's own pick). */
export function saveOnlineLyrics(id: string, text: string) {
  try {
    localStorage.setItem(savedKey(id), text)
    localStorage.setItem(rankedKey(id), '1')
  } catch { /* storage full: still shown this session */ }
}

/** A per-song timing nudge in seconds, on top of the global Lyrics timing setting. Positive shows lyrics later. */
const offsetKey = (id: string) => `shell.lyrics.offset.${id}`
export const songLyricsOffset = (id: string) => { try { return Number(localStorage.getItem(offsetKey(id))) || 0 } catch { return 0 } }
export function setSongLyricsOffset(id: string, seconds: number) {
  try {
    if (Math.abs(seconds) < 0.01) localStorage.removeItem(offsetKey(id))
    else localStorage.setItem(offsetKey(id), seconds.toFixed(2))
  } catch { /* not kept */ }
}

/** A word the site blanked out entirely ("****"): nothing left to restore it from. */
const FULLY_MASKED = /(?:^|[^A-Za-z0-9*])[*#]{3,}(?![A-Za-z0-9*])/
const firstStamp = (lrc: string) => {
  const m = /\[(\d{1,3}):(\d{2}(?:\.\d+)?)\]/.exec(lrc)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/**
 * Every usable version, best first (plan §76 B/C). Sites carry several uploads of one song: album and "history
 * edition" cuts of different lengths (Sabaton "82nd All the Way": 211 s, 228 s with a spoken intro), re-timed copies,
 * and censored copies. Order: synced before plain; then the closest length (in 2 s bands, so rounding doesn't decide);
 * then an uncensored copy over one with words blanked out; then the timing most uploads of that length agree on;
 * then the closest length exactly.
 */
export const rankLyrics = (records: LrcLibRecord[], seconds: number, tolerance = MAX_LENGTH_DIFFERENCE_S) => rankAll(records, seconds, tolerance)

function rankAll(records: LrcLibRecord[], seconds: number, tolerance = MAX_LENGTH_DIFFERENCE_S): LrcLibRecord[] {
  const eligible = records.filter((r) => {
    if (r.instrumental) return false
    if (seconds > 0 && r.duration && Math.abs(r.duration - seconds) > tolerance) return false
    return Boolean(r.syncedLyrics || r.plainLyrics)
  })
  const off = (r: LrcLibRecord) => (seconds > 0 && r.duration ? Math.abs(r.duration - seconds) : 0)
  const start = new Map(eligible.map((r) => [r, r.syncedLyrics ? firstStamp(r.syncedLyrics) : NaN]))
  const agree = (r: LrcLibRecord) =>
    eligible.filter((o) => Math.abs(off(o) - off(r)) <= 2 && Math.abs((start.get(o) ?? NaN) - (start.get(r) ?? NaN)) <= 0.3).length
  const key = (r: LrcLibRecord) => [
    r.syncedLyrics ? 0 : 1,
    Math.floor(off(r) / 2),
    FULLY_MASKED.test(r.syncedLyrics ?? r.plainLyrics ?? '') ? 1 : 0,
    -agree(r),
    off(r),
  ]
  const byKey = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  }
  return eligible
    .map((r) => ({ r, k: key(r) }))
    .sort((a, b) => byKey(a.k, b.k))
    .map(({ r }) => r)
}

const textOf = (r: LrcLibRecord | undefined) => r?.syncedLyrics || r?.plainLyrics || null

export function pickLyrics(records: LrcLibRecord[], seconds: number, tolerance = MAX_LENGTH_DIFFERENCE_S): string | null {
  return textOf(rankLyrics(records, seconds, tolerance)[0])
}

/** A title without the edition notes stores add: "(2011 Remaster)", "[Live]", "(feat. X)". */
export const plainTitle = (title: string) =>
  cleanRipTitle(title).replace(/\s*[([][^)\]]*(remaster|version|edit|mix|feat|ft\.|from|live|mono|stereo|explicit)[^)\]]*[)\]]/gi, '').trim() || title

/**
 * Other names a song may be filed under, for the title-only search: without anything in brackets, what's in the
 * brackets ("フォニイ (Phony) [6+α chorus]" gives フォニイ and Phony), and the part before " - " when the artist tag
 * is empty and the title carries it ("THE END OF HATSUNE MIKU - cosMo@Bousou-P").
 */
export function titleGuesses(t: Pick<Track, 'title' | 'artist'>): string[] {
  const { title } = withArtistFromTitle(t)
  const bare = title.replace(/\s*[([（【][^)\]）】]*[)\]）】]/g, '').trim()
  const inside = [...title.matchAll(/[([（【]([^)\]）】]+)[)\]）】]/g)].map((m) => m[1].trim())
    .filter((s) => !/remaster|version|edit|mix|feat|ft\.|live|mono|stereo|explicit|chorus|cover|instrumental|ver\.|\d+\s*\+/i.test(s))
  return [...new Set([bare, ...inside].filter((s) => s.length > 1))]
}

/** A title-only match has little else to confirm it, so the length must agree closely. */
const TITLE_ONLY_TOLERANCE_S = 3

const squash = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const overlaps = (a: string, b: string) => {
  const x = squash(a)
  const y = squash(b)
  return x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x))
}

/** Who sings it: the artist tag, else the part after " - " in a title that carries it. */
const artistHint = (t: Pick<Track, 'title' | 'artist'>) => withArtistFromTitle(t).artist

/** For the title-only search: the record's title must hold ours (or ours hold it), or its artist must agree with ours. */
export function titleAgrees(r: LrcLibRecord, guess: string, t: Pick<Track, 'title' | 'artist'>): boolean {
  if (r.trackName && overlaps(r.trackName, guess)) return true
  const ours = artistHint(t).split(/\s*[,;]\s*/).filter(Boolean)
  const theirs = r.artistName ?? ''
  return Boolean(theirs) && ours.some((a) => overlaps(a, theirs) || sameName(a, theirs))
}

/** "cosMo@Bousou-P", "cosMo＠暴走P" and "cosMo feat. Hatsune Miku" are one producer: compare the name before @ or feat. */
function sameName(a: string, b: string) {
  const name = (s: string) => squash(s.split(/[@＠(（]|\s+(?:feat|ft)\.?\s/i)[0])
  const x = name(a)
  return x.length > 2 && !['the', 'dj', 'mc'].includes(x) && x === name(b)
}

// §100: LRCLIB asked a phone to slow down after about 30 requests in a burst; one request a second, like MusicBrainz
let lrcQueue: Promise<unknown> = Promise.resolve()
const LRC_GAP_MS = 1000

function getJson<T>(url: string): Promise<T | null> {
  const run = lrcQueue.then(async () => {
    const response = await fetch(url)
    // 400: the exact lookup refuses a song with no artist or album; the searches after it still run (§100)
    if (response.status === 404 || response.status === 400) return null
    const after = Number(response.headers.get('retry-after'))
    if (!response.ok) throw new Error(`HTTP ${response.status}${after > 0 ? ` (retry after ${after} s)` : ''}`)
    return response.json() as Promise<T>
  })
  lrcQueue = run.catch(() => null).then(() => new Promise((done) => setTimeout(done, LRC_GAP_MS)))
  return run
}

/**
 * Every distinct version LRCLIB has for this song, best first (rankLyrics). Searches by exact details plus the loose
 * search together (the exact lookup alone returns one upload, often not the best), then looser searches only when those
 * found nothing. Sends the title, artist, album and length to lrclib.net.
 */
export async function searchVersions(song: Track): Promise<string[]> {
  const saved = savedDetails(song.id)
  const overlaid: Track = {
    ...song,
    title: saved?.title || song.title,
    artist: saved?.artist || song.artist,
    album: (saved?.values.album as string | undefined) || song.album,
  }
  const confirmedRip = Boolean(
    saved?.confirmedMatch ||
    song.confirmedMatch ||
    saved?.title ||
    saved?.artist ||
    !song.artist ||
    song.originalArtist === ''
  )
  const mainTol = confirmedRip ? RIP_LENGTH_TOLERANCE_S : MAX_LENGTH_DIFFERENCE_S
  const titleOnlyTol = confirmedRip ? RIP_LENGTH_TOLERANCE_S : TITLE_ONLY_TOLERANCE_S

  const t = withArtistFromTitle(overlaid)
  const seconds = Math.round(t.sec)
  let ranked: LrcLibRecord[] = []
  // another recording's lyrics (the album cut for a "Secret Track" version) are wrong lyrics: the version must agree
  const version = versionKey(song.originalTitle ?? song.title)
  const rankLyrics = (records: LrcLibRecord[], sec: number, tol: number) => rankAll(records.filter((r) => versionKey(r.trackName ?? '') === version), sec, tol)
  const exact = new URLSearchParams({ track_name: t.title, artist_name: t.artist, album_name: t.album, duration: String(seconds) })
  const loose = new URLSearchParams({ track_name: t.title, artist_name: t.artist })
  // one request at a time: LRCLIB answers 429 to several at once (§100)
  const one = await getJson<LrcLibRecord>(`${API}/get?${exact}`)
  const many = await getJson<LrcLibRecord[]>(`${API}/search?${loose}`)
  ranked = rankLyrics([...(one ? [one] : []), ...(many ?? [])], t.sec, mainTol)
  // then without "(2011 Remaster)", "(feat. ...)" and the like, and with the first artist only
  const title = plainTitle(t.title)
  const first = t.artist.split(/\s*[,;]\s*/)[0]
  if (!ranked.length && (title !== t.title || first !== t.artist)) {
    const plain = new URLSearchParams({ track_name: title, artist_name: first })
    ranked = rankLyrics((await getJson<LrcLibRecord[]>(`${API}/search?${plain}`)) ?? [], t.sec, mainTol)
  }
  if (!ranked.length && first) {
    const free = new URLSearchParams({ q: `${first} ${title}` })
    ranked = rankLyrics((await getJson<LrcLibRecord[]>(`${API}/search?${free}`)) ?? [], t.sec, mainTol)
  }
  // remixes, covers and songs known by more than one name: the title alone
  for (const guess of titleGuesses(t)) {
    if (ranked.length) break
    const free = new URLSearchParams({ q: guess })
    const records = ((await getJson<LrcLibRecord[]>(`${API}/search?${free}`)) ?? []).filter((r) => titleAgrees(r, guess, t))
    ranked = rankLyrics(records, t.sec, titleOnlyTol)
  }
  return [...new Set(ranked.map(textOf).filter((x): x is string => Boolean(x)))]
}

/** The best version, saved for this song (and kept as an .lrc beside the file where the host allows). */
export async function searchOnline(song: Track): Promise<string | null> {
  const t = withArtistFromTitle(song)
  const text = (await searchVersions(song))[0] ?? null
  logLine('INFO', 'Lyrics', `LRCLIB ${text ? 'found' : 'has nothing for'} "${t.title}"`)
  if (text) {
    saveOnlineLyrics(t.id, text)
    keepAsLrc(t, text)
  }
  return text
}

import { bridge } from '../fit/system'
import { loadInstalledSongs } from './cloudSongs'

export type Category = 'bass' | 'vocals' | 'treble' | 'acoustic' | 'stage' | 'busy'

export interface SongInfo {
  id: string
  artist: string
  title: string
  album: string
  year: number | null
  category: Category | 'any'
  also: Category[]
  genre: string
  /** Game/community the track is known from (rhythm-game tracks). */
  from?: string
  /** One-line "what to listen for" shown in the gallery. */
  note?: string
  /** Exact file name (without extension) this song is pinned to; beats fuzzy matching. */
  fileName?: string
  /** Speciality was guessed by the analyser (songs/analyze.ts), not chosen by hand. */
  auto?: boolean
  /** Smart volume measurement of the bundled file (scripts/song_loudness.ts): BS.1770 LUFS and linear sample peak. */
  level?: { lufs: number; peak: number }
  /** A song found on the phone (songs/phoneLibrary.ts): its folder and when it was added (s). */
  phone?: { folder: string; added: number }
  clip: { start: number | null; end: number | null }
}

export interface SongManifest {
  categories: Record<Category, string>
  songs: SongInfo[]
}

/** What a song file needs to offer: a browser File, or a file the app reads from disk. */
export interface SongFile {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  /** A URL the file can be streamed from, when there is one (bundled Android songs). */
  url?: string
  /** Cover picture URL, for bundled songs whose tags were stripped (scripts/make_mobile_media.py). */
  cover?: string
}

/** A manifest song (or an extra unlisted file) paired with the file the user provided. */
export interface LibrarySong extends SongInfo {
  file: SongFile
}

export const AUDIO_EXT = /\.(wav|flac|mp3|m4a|aac|ogg|opus|aiff?)$/i

export async function loadManifest(url = `${import.meta.env.BASE_URL}data/songs.json`): Promise<SongManifest> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json()
}

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/** Same rule as scripts/make_checklist.py: title in the file name, plus the artist unless the title is distinctive. */
export function matchesFile(song: Pick<SongInfo, 'artist' | 'title'>, fileName: string): boolean {
  const title = norm(song.title.replace(/\(.*?\)/g, ''))
  const name = norm(stem(fileName))
  return title.length > 0 && name.includes(title) && (name.includes(norm(song.artist)) || title.length >= 8)
}

/**
 * Pair manifest songs with files. Files that match nothing become `any`-category songs,
 * so any music folder works for testing.
 */
export function buildLibrary(manifest: SongManifest, files: SongFile[]): { songs: LibrarySong[]; missing: SongInfo[] } {
  const audio = files.filter((f) => AUDIO_EXT.test(f.name))
  const used = new Set<SongFile>()
  const songs: LibrarySong[] = []
  const missing: SongInfo[] = []
  // pinned songs claim their exact files first, so fuzzy matching can't steal them
  const pinned = new Map<SongInfo, SongFile>()
  for (const s of manifest.songs) {
    const f = s.fileName !== undefined ? audio.find((x) => !used.has(x) && stem(x.name) === s.fileName) : undefined
    if (f) {
      used.add(f)
      pinned.set(s, f)
    }
  }
  for (const s of manifest.songs) {
    const file = pinned.get(s) ?? audio.find((f) => !used.has(f) && matchesFile(s, f.name))
    if (file) {
      used.add(file)
      songs.push({ ...s, file })
    } else missing.push(s)
  }
  for (const f of audio) {
    if (used.has(f)) continue
    const { artist, title, from } = cleanSongName(f.name)
    songs.push({
      id: `extra-${norm(f.name)}`,
      artist,
      title,
      ...(from ? { from } : {}),
      album: '',
      year: null,
      category: 'any',
      also: [],
      genre: 'unknown',
      clip: { start: null, end: null },
      file: f,
    })
  }
  return { songs, missing }
}

const FOLDER_KEY = 'songs-folder-v1'

/** Is a songs folder of your own remembered (the exe), instead of our songs? */
export function hasSongsFolder(): boolean {
  try {
    return !!localStorage.getItem(FOLDER_KEY)
  } catch {
    return false
  }
}

/** The picked folder's path, from one file's absolute path and its path relative to that folder. */
export function pickedFolder(abs: string, rel: string): string | null {
  const depth = rel.split('/').length - 1 // folders between the picked folder and the file
  if (!abs || depth < 1) return null
  const parts = abs.split(/[\\/]/)
  return parts.slice(0, parts.length - depth).join('\\')
}

/**
 * Remember the folder the songs were picked from (its path only, never the audio), so the
 * exe can list and read the files from disk on the next launch. Browser builds can't, and
 * simply ask for the folder again.
 */
export async function savePersistedFiles(files: File[]): Promise<void> {
  const b = bridge()
  const first = files.find((f) => AUDIO_EXT.test(f.name))
  if (!b?.pathOfFile || !first) return
  const abs = b.pathOfFile(first)
  const rel = (first as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
  const folder = pickedFolder(abs, rel)
  if (!folder) return
  try {
    localStorage.setItem(FOLDER_KEY, folder)
  } catch {
    /* storage unavailable: the folder just won't be remembered */
  }
}

/**
 * Installed songs: the 10 permanent built-in songs + any on-demand downloaded songs
 * currently stored in writable storage (Android Filesystem, Desktop userData, or browser IndexedDB).
 */
export async function loadBundledSongs(): Promise<SongFile[] | null> {
  try {
    const installed = await loadInstalledSongs()
    return installed.length > 0 ? installed : null
  } catch {
    return null
  }
}

/**
 * Songs to load at start-up: the bundled copies on Android, else the remembered folder
 * read from disk on demand; null if none or not in the exe.
 */
export async function loadPersistedFiles(): Promise<SongFile[] | null> {
  const b = bridge()
  let folder: string | null = null
  try {
    folder = localStorage.getItem(FOLDER_KEY)
  } catch {
    /* ignore */
  }
  if (folder && b?.listSongs && b?.readSong) {
    const readSong = b.readSong
    try {
      const list = await b.listSongs(folder)
      if (list.length > 0) {
        return list.map((f) => ({
          name: f.name,
          size: f.size,
          arrayBuffer: async () => {
            const u8 = await readSong(f.path)
            return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
          },
        }))
      }
    } catch {
      /* custom folder inaccessible, fall back to bundled songs */
    }
  }

  // Load bundled songs on both Android and Desktop/Web!
  return loadBundledSongs()
}

export async function clearPersistedFiles(): Promise<void> {
  try {
    localStorage.removeItem(FOLDER_KEY)
    // an earlier build kept copies of the audio here; make sure none are left behind
    indexedDB?.deleteDatabase('iem-song-crate-v1')
  } catch {
    /* ignore */
  }
}

// words that mark a bracket (or a trailing tag) as video/upload noise rather than part of the title
const JUNK =
  /lyric|official|video|audio|\bmv\b|\bpv\b|\bhd\b|\bhq\b|\b4k\b|\d{3,4}p\b|remaster|copyright|free (dl|download)|\bsub\b|subbed|romaji|\brom\b|\bjpn\b|\beng\b|\bkan\b|\bhan\b|color coded|visuali[sz]er|explicit|high quality|teks|bonus track|full\b|uncut|album version|歌詞/i

/**
 * Tidy a downloaded file name into artist + title: drops the track number, emoji and
 * upload noise like "(Lyrics)", "[Official Video]" or "【MV】", reads "[from Arcaea]" as the
 * game it's from, and understands "Artist - Title", "Artist「Title」", "【Artist】Title" and
 * "Title / Artist" (the usual Japanese upload order).
 */
export function cleanSongName(fileName: string): { artist: string; title: string; from?: string } {
  let s = stem(fileName)
    .normalize('NFKC')
    .replace(/[⧸／]/g, '/')
    .replace(/[“”＂]/g, '"')
    .replace(/_/g, ' ')
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .replace(/^\s*\d{1,3}\s*[-.]\s*/, '')
  let from: string | undefined
  s = s.replace(/\[\s*from ([^\]]+)\]/i, (_m, g: string) => {
    from = g.trim()
    return ' '
  })
  // brackets: drop noise, keep the rest
  s = s.replace(/\s*[([【]([^)\]】]*)[)\]】]/g, (m, inner: string) => (JUNK.test(inner) ? ' ' : m))
  // trailing noise without brackets ("… Lyrics", "… MV", "| FREE DOWNLOAD")
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/\s*(\||[-–])?\s*("?\b(official )?(music |lyric )?(video|audio)"?|lyrics?( video)?|mv|free download)\s*$/i, '')
  }
  s = s.replace(/\s+/g, ' ').trim()

  let artist = ''
  let title = s
  const lead = /^【([^】]+)】\s*(.+)$/.exec(s)
  const quoted = /^(.+?)\s*[「『](.+?)[」』]/.exec(s)
  const dash = /^(.+?)\s+[-–]\s+(.+)$/.exec(s) ?? /^(.+?)- (.+)$/.exec(s)
  const slash = /^(.+?)\s*\/\s*(.+)$/.exec(s)
  if (lead) [artist, title] = [lead[1], lead[2]]
  else if (dash) [artist, title] = [dash[1], dash[2]]
  else if (quoted) [artist, title] = [quoted[1], quoted[2]]
  else if (slash) [artist, title] = [slash[2], slash[1]]
  const unquote = (t: string) => t.replace(/^\s*"(.+)"\s*$/, '$1').trim()
  return { artist: unquote(artist), title: unquote(title) || s, ...(from ? { from } : {}) }
}

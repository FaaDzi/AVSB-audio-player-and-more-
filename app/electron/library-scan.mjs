// Local Library (plan section 63): the music folders the listener chose, walked and read into one index. Shared by the
// exe (shell-main.cjs) and the dev server (vite.config.ts). Nothing here sends anything anywhere.
//
// Kept in <data>/library: folders.json (the chosen folders), index.json (every file's tags, by full path), covers/
// (one image per distinct embedded cover) and lyrics/ (embedded lyrics, or a .lrc found beside the song).
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'

/** What the player can decode. Chromium has no ALAC, AIFF, APE, WavPack or DSD decoder, so those are listed but greyed. */
export const MIME = {
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac',
  '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm',
}
const LISTED_ONLY = ['.aif', '.aiff', '.ape', '.wv', '.dsf', '.dff', '.mpc', '.wma', '.tta']
const AUDIO = new Set([...Object.keys(MIME), ...LISTED_ONLY])
const LOSSLESS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'WV', 'DSF', 'DFF', 'TTA'])
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git'])
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/
const INDEX_VERSION = 1
const PARALLEL = 8

const md5 = (text) => createHash('md5').update(text).digest('hex')
const slash = (p) => p.replace(/\\/g, '/')
const exists = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const within = (folder, file) => {
  const rel = path.relative(folder, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value))
  fs.renameSync(temp, file)
}

/**
 * Every audio file under a folder; with subfolders off, only the folder itself. Unreadable folders are skipped, and so
 * are `exclude`d ones (subfolders the owner left out in Settings → Local Library; nothing in them is touched).
 */
export async function listAudio(folder, subfolders, exclude = []) {
  const skip = new Set(exclude.map((p) => path.resolve(p).toLowerCase()))
  const found = []
  const visit = async (dir) => {
    let entries
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (subfolders && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()) && !skip.has(full.toLowerCase())) await visit(full)
      } else if (e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase())) {
        found.push(full)
      }
    }
  }
  await visit(folder)
  return found.sort()
}

const firstText = (v) => {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
  for (const x of list) {
    const s = typeof x === 'string' ? x : typeof x === 'number' ? String(x) : x && typeof x === 'object' && 'text' in x ? String(x.text ?? '') : ''
    if (s.trim()) return s.trim()
  }
  return ''
}

function nativeValue(meta, ids) {
  for (const tags of Object.values(meta.native ?? {})) {
    for (const t of tags) if (ids.includes(String(t.id).toLowerCase())) { const v = firstText(t.value); if (v) return v }
  }
  return ''
}

function lyricsOf(meta) {
  for (const l of meta.common.lyrics ?? []) {
    if (typeof l === 'string' && l.trim()) return l
    if (l?.text?.trim()) return l.text
    if (l?.syncText?.length) {
      return l.syncText.map((s) => {
        const ms = typeof s.timestamp === 'number' ? s.timestamp : 0
        const totalSec = ms > 100000 ? ms / 1000 : ms > 0 && ms < 3600 && !Number.isInteger(ms) ? ms : ms / 1000
        const m = Math.floor(totalSec / 60)
        const sec = (totalSec % 60).toFixed(2).padStart(5, '0')
        return `[${String(m).padStart(2, '0')}:${sec}] ${s.text || ''}`
      }).join('\n')
    }
  }
  return nativeValue(meta, ['lyrics', 'unsyncedlyrics', 'uslt', '©lyr'])
}

/** One file's entry, in the shape the page's Track type expects. */
export async function readTrack(file, folder, { id, saveCover, saveLyrics }) {
  let meta = await parseFile(file, { duration: false, skipCovers: false })
  // some Opus files only give their length by reading to the end
  if (!meta.format.duration) meta = await parseFile(file, { duration: true, skipCovers: false })
  const c = meta.common
  const f = meta.format
  const stat = fs.statSync(file)
  const ext = path.extname(file).toLowerCase()
  const codec = String(f.codec ?? '').toUpperCase()
  const format = codec.includes('ALAC') ? 'ALAC' : ext === '.aif' ? 'AIFF' : ext.slice(1).toUpperCase()
  const pic = c.picture?.[0]
  const cover = pic?.data?.length ? md5(Buffer.from(pic.data)).slice(0, 16) : ''
  if (cover) await saveCover(cover, Buffer.from(pic.data), pic.format)
  let words = lyricsOf(meta)
  if (!words) {
    try { words = fs.readFileSync(file.slice(0, -ext.length) + '.lrc', 'utf8') } catch { /* none beside it */ }
  }
  if (words) await saveLyrics(id, words)
  const sec = f.duration ?? 0
  const isrc = firstText(c.isrc)
  const date = c.date ?? (c.year ? String(c.year) : '')
  const year = Number.parseInt(date, 10) || c.year || 0
  const service = nativeValue(meta, ['service'])
  const vendor = nativeValue(meta, ['vendor'])
  return {
    id,
    path: slash(file),
    folder: slash(path.dirname(file)),
    root: slash(folder),
    title: firstText(c.title) || path.basename(file, path.extname(file)),
    artist: firstText(c.artist),
    albumArtist: firstText(c.albumartist),
    album: firstText(c.album),
    track: c.track?.no ?? 0,
    trackTotal: c.track?.of ?? 0,
    disc: c.disk?.no ?? 0,
    date,
    year: year > 999 ? year : 0,
    genre: firstText(c.genre),
    label: firstText(c.label) || nativeValue(meta, ['organization', 'publisher']),
    composer: firstText(c.composer),
    copyright: firstText(c.copyright),
    comment: firstText(c.comment),
    barcode: firstText(c.barcode) || nativeValue(meta, ['upc']),
    releaseType: firstText(c.releasetype),
    isrc,
    isrcOk: Boolean(isrc) && ISRC.test(isrc.replace(/-/g, '').toUpperCase()),
    lyrics: Boolean(words),
    replayGain: c.replaygain_track_gain !== undefined || Boolean(nativeValue(meta, ['r128_track_gain', 'replaygain_track_gain'])),
    downloaded: Boolean(service) || vendor === 'Mornye' || f.tool === 'Mornye',
    format,
    lossy: f.lossless === undefined ? !LOSSLESS.has(format) : !f.lossless,
    playable: Boolean(MIME[ext]) && format !== 'ALAC',
    bits: f.bitsPerSample ?? 0,
    rate: f.sampleRate ?? 48000,
    sec: Math.round(sec * 100) / 100,
    size: stat.size,
    kbps: sec > 0 ? Math.round(((stat.size - (pic?.data?.length ?? 0)) * 8) / sec / 1000) : Math.round((f.bitrate ?? 0) / 1000),
    added: Math.floor(stat.mtimeMs / 1000),
    cover,
  }
}

/** Writes a cover as it came (the dev server); answers the file written. The exe passes one that shrinks it first. */
export async function saveCoverAsIs(base, bytes, mime) {
  const file = `${base}.${/png/.test(mime ?? '') ? 'png' : /webp/.test(mime ?? '') ? 'webp' : 'jpg'}`
  await fs.promises.writeFile(file, bytes)
  return file
}

/**
 * The library for one data folder. `saveCover(id, bytes, mime)` writes a cover (the exe shrinks it first); `log` gets
 * one line per scan.
 */
export function createLibrary({ dataDir, saveCover = saveCoverAsIs, log = () => {} }) {
  const base = path.join(dataDir, 'library')
  const foldersFile = path.join(base, 'folders.json')
  const indexFile = path.join(base, 'index.json')
  const lyricsDir = path.join(base, 'lyrics')
  const coversDir = path.join(base, 'covers')
  fs.mkdirSync(lyricsDir, { recursive: true })
  fs.mkdirSync(coversDir, { recursive: true })
  const coverNames = new Map(fs.readdirSync(coversDir).map((n) => [n.split('.')[0], n]))

  let folders = readJson(foldersFile, [])
  const saved = readJson(indexFile, null)
  let files = saved?.version === INDEX_VERSION ? saved.files : {}
  let scanning = null
  let version = 0
  let running = null

  const saveFolders = () => writeJson(foldersFile, folders)
  const saveIndex = () => writeJson(indexFile, { version: INDEX_VERSION, files })
  const known = (p) => folders.find((f) => path.resolve(f.path) === path.resolve(p))

  /** Under one of the folder's left-out subfolders. */
  const excluded = (f, file) => (f.exclude ?? []).some((x) => within(x, file))

  function folderOf(file) {
    return folders.find((f) => within(f.path, file) && (f.subfolders || path.dirname(file) === path.resolve(f.path)) && !excluded(f, file))
  }

  /** A file the page may play, open or write a .lrc beside: inside a chosen folder, and nothing else. */
  function allowed(wanted) {
    if (typeof wanted !== 'string' || !wanted) return null
    const file = path.resolve(wanted)
    return folderOf(file) ? file : null
  }

  function state() {
    const online = new Map(folders.map((f) => [f.path, exists(f.path)]))
    const tracks = []
    for (const entry of Object.values(files)) {
      const t = entry.track
      const folder = folders.find((f) => slash(f.path) === t.root)
      if (!folder || excluded(folder, t.path)) continue
      tracks.push(online.get(folder.path) ? t : { ...t, offline: true })
    }
    return {
      folders: folders.map((f) => ({ ...f, online: online.get(f.path), count: tracks.filter((t) => t.root === slash(f.path)).length })),
      tracks,
      scanning,
      version,
    }
  }

  function setFolders(next) {
    const clean = []
    for (const f of Array.isArray(next) ? next : []) {
      if (!f || typeof f.path !== 'string' || !path.isAbsolute(f.path)) continue
      const p = path.resolve(f.path)
      if (clean.some((x) => x.path === p)) continue
      // left-out subfolders: only real paths inside this folder
      const exclude = [...new Set((Array.isArray(f.exclude) ? f.exclude : []).filter((x) => typeof x === 'string' && path.isAbsolute(x)).map((x) => path.resolve(x)))]
        .filter((x) => x !== p && within(p, x))
      clean.push({ path: p, subfolders: f.subfolders !== false, exclude, lastScan: known(p)?.lastScan ?? 0 })
    }
    folders = clean
    saveFolders()
    // entries of a removed folder go now, so the page stops listing them before the next scan
    const roots = new Set(folders.map((f) => slash(f.path)))
    for (const [k, entry] of Object.entries(files)) if (!roots.has(entry.track.root)) delete files[k]
    saveIndex()
    version++
  }

  async function scanOnce(full) {
    const started = Date.now()
    const taken = new Set()
    const next = {}
    let read = 0
    let failed = 0
    scanning = { found: 0, read: 0, folder: '' }
    for (const folder of folders) {
      const root = slash(folder.path)
      if (!exists(folder.path)) {
        // offline: keep what was known, so the songs come back as they were
        for (const [k, entry] of Object.entries(files)) if (entry.track.root === root) { next[k] = entry; taken.add(entry.track.id) }
        continue
      }
      scanning.folder = folder.path
      const list = await listAudio(folder.path, folder.subfolders, folder.exclude)
      scanning.found += list.length
      let at = 0
      const work = async () => {
        while (at < list.length) {
          const file = list[at++]
          const key = slash(file)
          const rel = slash(path.relative(folder.path, file))
          // the same id as the old built-in list (a hash of the path inside the folder), so saved data carries over
          let id = md5(rel).slice(0, 12)
          if (taken.has(id)) id = md5(`${root}|${rel}`).slice(0, 12)
          taken.add(id)
          let stat
          try { stat = fs.statSync(file) } catch { continue }
          const old = files[key]
          if (!full && old && old.size === stat.size && old.mtime === stat.mtimeMs && old.track.id === id && old.track.root === root) {
            next[key] = old
          } else {
            try {
              const track = await readTrack(file, folder.path, {
                id,
                saveCover: async (coverId, bytes, mime) => {
                  if (coverNames.has(coverId)) return
                  const name = await saveCover(path.join(coversDir, coverId), bytes, mime)
                  coverNames.set(coverId, path.basename(name))
                },
                saveLyrics: async (trackId, text) => fs.promises.writeFile(path.join(lyricsDir, `${trackId}.txt`), text),
              })
              next[key] = { size: stat.size, mtime: stat.mtimeMs, track }
            } catch (e) {
              failed++
              log(`Couldn't read ${file}: ${e?.message ?? e}`)
            }
          }
          read++
          scanning.read = read
          // the page shows songs as they arrive
          if (read % 50 === 0) { files = { ...files, ...next }; version++ }
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, work))
      folder.lastScan = Date.now()
    }
    files = next
    saveIndex()
    saveFolders()
    scanning = null
    version++
    log(`Scanned ${folders.length} folder(s): ${Object.keys(files).length} songs, ${failed} unreadable, ${((Date.now() - started) / 1000).toFixed(1)} s`)
  }

  /** One scan at a time; asking during a scan waits for it. */
  function scan({ full = false } = {}) {
    if (!running) running = scanOnce(full).finally(() => { running = null })
    return running
  }

  const coverFile = (id) => {
    if (!/^[0-9a-f]{16}$/.test(String(id))) return null
    const name = coverNames.get(id)
    return name ? path.join(coversDir, name) : null
  }
  const lyricsFile = (id) => (/^[0-9a-f]{12}$/.test(String(id)) ? path.join(lyricsDir, `${id}.txt`) : null)

  return { state, setFolders, scan, allowed, coverFile, lyricsFile, folders: () => folders }
}

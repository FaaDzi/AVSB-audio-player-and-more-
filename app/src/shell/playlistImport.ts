// §98: a playlist file from another player (Samsung Music, Poweramp, Musicolet, VLC, Windows Media, an online
// converter's CSV) read into a playlist of this library's songs. Entries are matched by path, then file name, then
// title and artist; the ones that aren't in the library are reported, not dropped silently.
import type { Track } from './library'

export interface Entry {
  path?: string
  title?: string
  artist?: string
  sec?: number
}

const clean = (s: string) => s.replace(/^\uFEFF/, '').trim()
const xmlText = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()

/** "Artist - Title" (the usual #EXTINF and file-name form) split in two; no dash = a title alone. */
function artistTitle(s: string): Pick<Entry, 'title' | 'artist'> {
  const at = s.indexOf(' - ')
  return at > 0 ? { artist: s.slice(0, at).trim(), title: s.slice(at + 3).trim() } : { title: s.trim() }
}

function m3u(text: string): { name?: string; entries: Entry[] } {
  let name: string | undefined
  let info: Entry = {}
  const entries: Entry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw)
    if (!line) continue
    if (/^#PLAYLIST:/i.test(line)) name = line.slice(10).trim()
    else if (/^#EXTINF:/i.test(line)) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i.exec(line)
      info = m ? { sec: Number(m[1]) > 0 ? Number(m[1]) : undefined, ...artistTitle(m[2]) } : {}
    } else if (!line.startsWith('#')) {
      entries.push({ ...info, path: line })
      info = {}
    }
  }
  return { name, entries }
}

function pls(text: string): Entry[] {
  const rows = new Map<number, Entry>()
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(clean(raw))
    if (!m) continue
    const e = rows.get(Number(m[2])) ?? {}
    const key = m[1].toLowerCase()
    if (key === 'file') e.path = m[3].trim()
    else if (key === 'title') Object.assign(e, artistTitle(m[3]))
    else if (Number(m[3]) > 0) e.sec = Number(m[3])
    rows.set(Number(m[2]), e)
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, e]) => e)
}

function xspf(text: string): { name?: string; entries: Entry[] } {
  const tag = (block: string, t: string) => {
    const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i').exec(block)
    return m ? xmlText(m[1]) : undefined
  }
  const head = text.split(/<trackList>/i)[0]
  const entries = [...text.matchAll(/<track>([\s\S]*?)<\/track>/gi)].map(([, b]) => {
    const ms = Number(tag(b, 'duration'))
    return { path: tag(b, 'location'), title: tag(b, 'title'), artist: tag(b, 'creator'), sec: ms > 0 ? ms / 1000 : undefined }
  })
  return { name: tag(head, 'title'), entries }
}

function wpl(text: string): { name?: string; entries: Entry[] } {
  const name = /<title>([\s\S]*?)<\/title>/i.exec(text)?.[1]
  const entries = [...text.matchAll(/<media\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)].map(([, src]) => ({ path: xmlText(src) }))
  return { name: name ? xmlText(name) : undefined, entries }
}

/** One CSV line into cells, with quoted cells ("a, b" and "" for a quote). */
function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  out.push(cur.trim())
  return out
}

function csv(text: string): Entry[] {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean)
  if (!lines.length) return []
  const head = cells(lines[0]).map((h) => h.toLowerCase())
  const col = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)))
  const title = col(/^(track ?name|title|song|name)$/, /title|track name|song/)
  const artist = col(/^artist(s)?( name\(?s?\)?)?$/, /artist/)
  const length = col(/duration|length|time/)
  if (title < 0) return []
  return lines.slice(1).map((l) => {
    const c = cells(l)
    const raw = length >= 0 ? Number(c[length]) : NaN
    // converters give ms (Exportify) or seconds
    const sec = raw > 0 ? (raw > 20000 ? raw / 1000 : raw) : undefined
    return { title: c[title], artist: artist >= 0 ? c[artist]?.split(/[,;]/)[0].trim() : undefined, sec }
  }).filter((e) => e.title)
}

/** Reads a playlist file by its extension (or its contents when the name says nothing). */
export function parsePlaylist(fileName: string, text: string): { name: string; entries: Entry[] } {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? ''
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/^.*[\\/]/, '')
  const body = text.replace(/^\uFEFF/, '')
  let got: { name?: string; entries: Entry[] }
  if (ext === 'pls' || /^\s*\[playlist\]/i.test(body)) got = { entries: pls(body) }
  else if (ext === 'xspf' || /<playlist[^>]*xspf/i.test(body)) got = xspf(body)
  else if (ext === 'wpl' || /<smil>/i.test(body)) got = wpl(body)
  else if (ext === 'csv') got = { entries: csv(body) }
  else got = m3u(body)
  return { name: got.name || base || 'Imported playlist', entries: got.entries }
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
/** A path from any player in one shape: forward slashes, no file:// or %20, lower case. */
const normPath = (p: string) => {
  let s = p.trim().replace(/^file:\/+/i, '/').replace(/\\/g, '/')
  try { s = decodeURIComponent(s) } catch { /* a literal % stays */ }
  return norm(s.replace(/\/+/g, '/'))
}
const baseName = (p: string) => normPath(p).replace(/^.*\//, '')
const stem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '')
/** Where a song sits under its storage root: "music/artist/song.mp3" from either a full path or an Android folder. */
const tail = (folder: string, file: string) => normPath(`${folder}/${file}`).replace(/^.*?\/(?=[^/]+\/[^/]+$)/, '')

/** Each entry's song in `tracks` (null when it isn't there): path, then folder + file name, then file name, then title + artist. */
export function matchEntries(entries: Entry[], tracks: Track[]): (Track | null)[] {
  const byPath = new Map<string, Track>()
  const byTail = new Map<string, Track>()
  const byName = new Map<string, Track[]>()
  const byTitle = new Map<string, Track[]>()
  for (const t of tracks) {
    const file = t.file || (t.path.startsWith('content:') ? '' : baseName(t.path))
    if (t.path && !t.path.startsWith('content:')) byPath.set(normPath(t.path), t)
    if (file) {
      byTail.set(tail(t.folder, file), t)
      byName.set(norm(file), [...(byName.get(norm(file)) ?? []), t])
    }
    for (const title of [t.title, t.originalTitle].filter(Boolean) as string[]) {
      byTitle.set(norm(title), [...(byTitle.get(norm(title)) ?? []), t])
    }
  }
  const pick = (list: Track[] | undefined, e: Entry) => {
    if (!list?.length) return null
    const fits = list.filter((t) => (!e.artist || norm(t.artist).includes(norm(e.artist)) || norm(e.artist).includes(norm(t.artist))) && (!e.sec || Math.abs(t.sec - e.sec) <= 3))
    return fits[0] ?? (list.length === 1 && !e.artist ? list[0] : null)
  }
  return entries.map((e) => {
    if (e.path) {
      const p = normPath(e.path)
      const hit = byPath.get(p) ?? byTail.get(p.replace(/^.*?\/(?=[^/]+\/[^/]+$)/, ''))
      if (hit) return hit
      const named = byName.get(baseName(e.path))
      if (named?.length === 1) return named[0]
      const byFile = pick(named, e)
      if (byFile) return byFile
    }
    // no path match: the entry's own title, or its file name read as "Artist - Title"
    const fromFile = e.path ? artistTitle(stem(baseName(e.path)).replace(/^\d+\s*[-.]\s*/, '')) : {}
    return pick(byTitle.get(norm(e.title ?? '')), e) ?? (fromFile.title ? pick(byTitle.get(norm(fromFile.title)), { ...fromFile, sec: e.sec }) : null)
  })
}

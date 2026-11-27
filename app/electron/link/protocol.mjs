// The phone ↔ PC protocol (plan §70 D1, ALPN "iemdream/1"). One QUIC stream per request:
//   phone → PC: one JSON line, at most REQUEST_MAX bytes
//   PC → phone: one JSON header line, then `bytes` raw bytes when the header says so, then the stream ends
// Requests name songs and covers by library id, never by path, so a phone can't reach any other file.
// Written down for a later Android "Source" app in docs/link-protocol.md.

export const ALPN = 'iemdream/1'
export const REQUEST_MAX = 4096
export const OPS = ['hello', 'library', 'cover', 'song', 'pair', 'ping', 'bench', 'playlists', 'playlists-put', 'upload', 'eq-inbox', 'eq-put']
/** Playlists the phone sends (§80 A): JSON after the request line. */
export const PLAYLISTS_MAX = 2 * 1024 * 1024
/** A song the phone sends (§80 A): its file after the request line. */
export const UPLOAD_MAX = 1024 * 1024 * 1024
/** File types a phone may send. */
export const UPLOAD_EXTS = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma', '.alac', '.aiff', '.aif', '.ape', '.wv', '.dsf']

/** What a phone says about itself (its name, model number, Android version): strings only, and only the ones it sent. */
const about = (req) => Object.fromEntries(['name', 'model', 'os'].filter((k) => typeof req[k] === 'string').map((k) => [k, req[k]]))

/** A file name a phone sent, made safe: no folders, no reserved characters, one of the audio types; null if not usable. */
export function uploadName(name) {
  if (typeof name !== 'string') return null
  const base = name.split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || !UPLOAD_EXTS.includes(base.slice(dot).toLowerCase())) return null
  return base
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

export class BadRequest extends Error {}

/** Parses and checks one request line. Throws BadRequest for anything malformed, oversized or unknown. */
export function parseRequest(bytes) {
  if (bytes.length > REQUEST_MAX) throw new BadRequest('request too large')
  const text = Buffer.from(bytes).toString('utf8')
  const end = text.indexOf('\n')
  if (end < 0) throw new BadRequest('request not finished')
  let req
  try {
    req = JSON.parse(text.slice(0, end))
  } catch {
    throw new BadRequest('not JSON')
  }
  if (!req || typeof req !== 'object' || Array.isArray(req) || !OPS.includes(req.op)) throw new BadRequest('unknown request')
  switch (req.op) {
    case 'hello':
      // §81 F: the phone says who it is with every hello, so a phone paired before this still gets its name
      return { op: 'hello', ...about(req) }
    case 'ping':
      return { op: 'ping' }
    case 'bench': {
      const requested = Number.isInteger(req.bytes) ? req.bytes : 1024 * 1024
      return { op: 'bench', bytes: Math.max(64 * 1024, Math.min(8 * 1024 * 1024, requested)) }
    }
    case 'library':
      return { op: 'library', since: Number.isInteger(req.since) && req.since >= 0 ? req.since : -1 }
    case 'cover':
      if (typeof req.id !== 'string' || !ID.test(req.id)) throw new BadRequest('bad id')
      return { op: 'cover', id: req.id }
    case 'song':
      if (typeof req.id !== 'string' || !ID.test(req.id)) throw new BadRequest('bad id')
      if (req.from !== undefined && (!Number.isInteger(req.from) || req.from < 0)) throw new BadRequest('bad offset')
      return {
        op: 'song',
        id: req.id,
        from: req.from ?? 0,
        ...(req.lowData ? { lowData: true } : {}),
        ...(req.raw ? { raw: true } : {}),
      }
    case 'playlists':
      return { op: 'playlists', since: Number.isInteger(req.since) && req.since >= 0 ? req.since : -1 }
    case 'playlists-put':
      if (!Number.isInteger(req.bytes) || req.bytes <= 0 || req.bytes > PLAYLISTS_MAX) throw new BadRequest('bad size')
      return { op: 'playlists-put', bytes: req.bytes }
    // §114 G: EQs between the PC and a phone (an EQ is a few KB; 256 KB is plenty)
    case 'eq-inbox':
      return { op: 'eq-inbox' }
    case 'eq-put':
      if (!Number.isInteger(req.bytes) || req.bytes <= 0 || req.bytes > 256 * 1024) throw new BadRequest('bad size')
      return { op: 'eq-put', bytes: req.bytes }
    case 'upload': {
      const name = uploadName(req.name)
      if (!name) throw new BadRequest('bad name')
      if (!Number.isInteger(req.bytes) || req.bytes <= 0 || req.bytes > UPLOAD_MAX) throw new BadRequest('bad size')
      return { op: 'upload', name, bytes: req.bytes }
    }
    case 'pair':
      if (typeof req.secret !== 'string' || req.secret.length > 64) throw new BadRequest('bad secret')
      return { op: 'pair', secret: req.secret, name: typeof req.name === 'string' ? req.name : '', ...about(req) }
  }
}

/** One header line. */
export const header = (obj) => Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8')

/** What a phone gets of each song: enough to list, sort and play it, nothing about where it sits on the PC. */
export function wireTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    albumArtist: t.albumArtist,
    album: t.album,
    track: t.track,
    disc: t.disc,
    year: t.year,
    genre: t.genre,
    format: t.format,
    lossy: t.lossy,
    bits: t.bits,
    rate: t.rate,
    sec: t.sec,
    size: t.size,
    kbps: t.kbps,
    added: t.added,
    cover: t.cover || '',
    playable: t.playable !== false,
  }
}

/** Splits incoming bytes at the first newline: the header, and whatever body already came with it. */
export function splitHeader(buf) {
  const at = buf.indexOf(10)
  if (at < 0) return null
  return { head: JSON.parse(Buffer.from(buf.subarray(0, at)).toString('utf8')), rest: buf.subarray(at + 1) }
}

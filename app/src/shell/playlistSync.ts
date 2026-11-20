// Playlists shared between the PC and the phone (plan §80 A). Each side keeps its own copy; edits are stamped with
// their time and deletes are remembered, so merging the two copies keeps the newest edit of each playlist.
// On the wire, songs go by the PC's ids. A song only the phone has travels as "phone:<its id>" with its title, artist
// and length, so the PC can show it as a missing song until the phone sends the file.
import { isPcTrack, type Playlist, type Track } from './library'

export interface MissingSong { title: string; artist: string; sec: number }
export interface SyncState { lists: Playlist[]; deleted: Record<string, number> }

export const PHONE_PREFIX = 'phone:'
const PC_PREFIX = 'pc_'

const sameContent = (a: Playlist, b: Playlist) => a.name === b.name && a.tracks.join('\n') === b.tracks.join('\n') && a.cover === b.cover

/** Stamps new or edited playlists with `now` and remembers the deleted ones, so the other side can tell which is newer. */
export function stamp(prev: Playlist[], next: Playlist[], deleted: Record<string, number>, now = Date.now()): SyncState {
  const before = new Map(prev.map((p) => [p.id, p]))
  const lists = next.map((p) => {
    const was = before.get(p.id)
    return was && sameContent(was, p) ? { ...p, updated: p.updated ?? was.updated ?? 0 } : { ...p, updated: now }
  })
  const kept = new Set(next.map((p) => p.id))
  const gone = { ...deleted }
  for (const p of prev) if (!kept.has(p.id)) gone[p.id] = now
  return { lists, deleted: gone }
}

/** Both copies together: per playlist the newest edit wins (a tie keeps `mine`), and a newer delete removes it. */
export function merge(mine: SyncState, theirs: SyncState): SyncState {
  const deleted = { ...mine.deleted }
  for (const [id, at] of Object.entries(theirs.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at)
  const best = new Map<string, Playlist>()
  const order: string[] = []
  for (const p of [...mine.lists, ...theirs.lists]) {
    const was = best.get(p.id)
    if (!was) order.push(p.id)
    if (!was || (p.updated ?? 0) > (was.updated ?? 0)) best.set(p.id, p)
  }
  const lists = order.map((id) => best.get(id)!).filter((p) => (deleted[p.id] ?? -1) < (p.updated ?? 0))
  return { lists, deleted }
}

const canon = (s: SyncState) =>
  JSON.stringify({
    lists: s.lists.map((p) => [p.id, p.name, p.tracks, p.updated ?? 0, Object.keys(p.missing ?? {}).sort(), p.cover ?? '']),
    deleted: Object.entries(s.deleted).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  })

/** True when merging changed nothing a person would see or the other side would need. */
export const sameState = (a: SyncState, b: SyncState) => canon(a) === canon(b)

/** A playlist's own cover is a small JPEG; anything bigger from the other side is dropped. */
const MAX_COVER = 200_000

/** The other side's copy, checked: only well-formed playlists, sizes capped. Null when it isn't a playlist copy at all. */
export function asState(v: unknown): SyncState | null {
  if (!v || typeof v !== 'object') return null
  const { lists, deleted } = v as Partial<SyncState>
  if (!Array.isArray(lists) || !deleted || typeof deleted !== 'object') return null
  const ok = lists.filter(
    (p): p is Playlist => !!p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks) && p.tracks.every((x) => typeof x === 'string'),
  )
  return {
    lists: ok.map((p) => ({
      id: p.id.slice(0, 100),
      name: p.name.slice(0, 200),
      tracks: p.tracks.slice(0, 20000),
      // §94 C: a stamp from the future (the other device's clock runs ahead) counts as now, so an older edit made
      // there can't beat a newer one made here; a tie keeps this side's copy
      updated: Math.min(Number(p.updated) || 0, Date.now()),
      ...(p.missing && typeof p.missing === 'object' ? { missing: p.missing } : {}),
      ...(typeof p.cover === 'string' && p.cover.startsWith('data:image/') && p.cover.length <= MAX_COVER ? { cover: p.cover } : {}),
    })),
    deleted: Object.fromEntries(Object.entries(deleted).filter(([, at]) => typeof at === 'number').map(([id, at]) => [id, Math.min(at as number, Date.now())])),
  }
}

const key = (title: string, artist: string) => `${title.trim().toLowerCase()}|${artist.trim().toLowerCase()}`

/** Finds the same song in another list: same title and artist, length within 2 s. */
function matcher(tracks: Track[]) {
  const by = new Map<string, Track[]>()
  for (const t of tracks) {
    const k = key(t.title, t.artist)
    by.set(k, [...(by.get(k) ?? []), t])
  }
  return (m: MissingSong) => by.get(key(m.title, m.artist))?.find((t) => Math.abs(t.sec - m.sec) <= 2)
}

/** Phone → wire: its PC songs back to PC ids; its own songs to the PC's copy when the PC has one, else "phone:<id>". */
export function toWire(lists: Playlist[], tracks: Track[]): Playlist[] {
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const onPc = matcher(tracks.filter(isPcTrack))
  return lists.map((p) => {
    const missing: Record<string, MissingSong> = {}
    const ids = p.tracks.map((id) => {
      if (id.startsWith(PC_PREFIX)) return id.slice(PC_PREFIX.length)
      const wire = PHONE_PREFIX + id
      const t = byId.get(id)
      const meta = t ? { title: t.title, artist: t.artist, sec: t.sec } : p.missing?.[wire]
      const pc = meta && onPc(meta)
      if (pc) return pc.id.slice(PC_PREFIX.length)
      if (meta) missing[wire] = meta
      return wire
    })
    return { ...p, tracks: ids, missing }
  })
}

/** Wire → phone: PC ids to "pc_<id>", or to the phone's own copy of that song; "phone:<id>" back to its id. */
export function fromWire(lists: Playlist[], tracks: Track[]): Playlist[] {
  const pcById = new Map(tracks.filter(isPcTrack).map((t) => [t.id, t]))
  const onPhone = matcher(tracks.filter((t) => !isPcTrack(t)))
  return lists.map((p) => {
    const missing: Record<string, MissingSong> = {}
    const ids = p.tracks.map((id) => {
      if (id.startsWith(PHONE_PREFIX)) {
        if (p.missing?.[id]) missing[id] = p.missing[id]
        return id.slice(PHONE_PREFIX.length)
      }
      const pc = pcById.get(PC_PREFIX + id)
      return (pc && onPhone(pc)?.id) || PC_PREFIX + id
    })
    return { ...p, tracks: ids, missing }
  })
}

/** PC: a missing phone song that has since arrived in the library (sent from the phone) takes its real id. */
export function resolveMissing(lists: Playlist[], tracks: Track[]): Playlist[] {
  const find = matcher(tracks)
  let changed = false
  const out = lists.map((p) => {
    if (!p.missing || !p.tracks.some((id) => id.startsWith(PHONE_PREFIX))) return p
    const missing = { ...p.missing }
    let hit = false
    const ids = p.tracks.map((id) => {
      const m = id.startsWith(PHONE_PREFIX) ? missing[id] : undefined
      const t = m && find(m)
      if (!t) return id
      delete missing[id]
      hit = true
      return t.id
    })
    if (!hit) return p
    changed = true
    return { ...p, tracks: ids, missing }
  })
  return changed ? out : lists
}

/** A row for a song the PC doesn't have yet: greyed out, not playable, "(missing song)" after its title. */
export function missingTrack(id: string, m: MissingSong): Track {
  return {
    id, path: '', folder: '', missing: true, playable: false, title: `${m.title} (missing song)`, artist: m.artist, albumArtist: m.artist,
    album: '', track: 0, trackTotal: 0, disc: 0, date: '', year: 0, genre: '', label: '', isrc: '', isrcOk: false, lyrics: false,
    replayGain: false, downloaded: false, format: '', lossy: false, bits: 0, rate: 0, sec: m.sec, size: 0, kbps: 0, added: 0, cover: '',
  } as Track
}

// ---- deletes are remembered per device (setting 'playlists.deleted')
// shortcut: a delete is forgotten after a month, so a device offline longer brings that playlist back; keep them longer if that bites
const MONTH = 30 * 86_400_000
/** Forgets deletes older than a month: by then both sides have long seen them. */
export const pruneDeleted = (d: Record<string, number>, now = Date.now()) =>
  Object.fromEntries(Object.entries(d).filter(([, at]) => now - at < MONTH))

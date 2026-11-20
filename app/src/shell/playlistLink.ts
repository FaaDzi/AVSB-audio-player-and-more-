// Moves playlists from the PC to the phones (plan §80 A, §98). The PC is king: its playlists go to every paired phone,
// one way, and a phone shows them read-only (it can hide them or save a copy). A phone's own playlists and every
// device's Favorites stay on that device; they travel only as a shared .m3u8 file and Import.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getSetting, setSetting, subscribeSettings } from './settings/store'
import { host } from './host'
import { phoneLink } from './linkClient'
import { scan } from './localLibrary'
import { asState, fromWire, pruneDeleted, resolveMissing, sameState, stamp, type SyncState } from './playlistSync'
import { isFavoritesList, isPcPlaylist, type LibraryData, type Playlist, type Track } from './library'

const DELETED_KEY = 'playlists.deleted'

function loadDeleted(): Record<string, number> {
  try {
    const v = JSON.parse(String(getSetting(DELETED_KEY) || '{}')) as unknown
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}
const saveDeleted = (d: Record<string, number>) => setSetting(DELETED_KEY, JSON.stringify(pruneDeleted(d)))

/** PC: what the phones get: every playlist but Favorites (each device keeps its own). */
const forPhones = (s: SyncState) => JSON.stringify({ lists: s.lists.filter((p) => !isFavoritesList(p)), deleted: s.deleted })

/** PC: hands its copy to the link worker. A phone sends nothing back (§98). */
function send(s: SyncState) {
  host()?.link?.pushPlaylists?.(forPhones(s))
}

/**
 * Phone: the PC's playlists (marked as the PC's) followed by this phone's own. A PC playlist the PC no longer has
 * goes; the phone's own and its Favorites are never touched.
 */
export function withPcLists(mine: Playlist[], pc: Playlist[]): Playlist[] {
  const fromPc = pc.filter((p) => !isFavoritesList(p)).map((p) => ({ ...p, origin: 'pc' as const }))
  const pcIds = new Set(fromPc.map((p) => p.id))
  return [...fromPc, ...mine.filter((p) => (isFavoritesList(p) || !isPcPlaylist(p)) && !pcIds.has(p.id))]
}

// ---- §98: the PC's playlists a phone has hidden (setting 'playlists.hidden', ids)
const HIDDEN_KEY = 'playlists.hidden'
export function hiddenPlaylists(): string[] {
  try {
    const v = JSON.parse(String(getSetting(HIDDEN_KEY) || '[]')) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export const setPlaylistHidden = (id: string, hidden: boolean) =>
  setSetting(HIDDEN_KEY, JSON.stringify(hidden ? [...new Set([...hiddenPlaylists(), id])] : hiddenPlaylists().filter((x) => x !== id)))
let hiddenRaw = ''
let hiddenSet = new Set<string>()
/** The hidden ids, re-rendering when they change. */
export function useHiddenPlaylists(): Set<string> {
  return useSyncExternalStore(subscribeSettings, () => {
    const raw = String(getSetting(HIDDEN_KEY) || '')
    if (raw !== hiddenRaw) {
      hiddenRaw = raw
      hiddenSet = new Set(hiddenPlaylists())
    }
    return hiddenSet
  })
}

/** A local edit: new or changed playlists get the time, deletes are remembered, and the other side is told. */
export function localEdit(prev: Playlist[], next: Playlist[], _tracks: Track[]): Playlist[] {
  const before = { lists: prev, deleted: loadDeleted() }
  const s = stamp(prev, next, before.deleted)
  if (sameState(s, before)) return s.lists
  saveDeleted(s.deleted)
  send(s)
  return s.lists
}

/** Keeps the playlists in step with the other side. `save` stores merged playlists without stamping them again. */
export function usePlaylistLink(data: LibraryData | null, save: (lists: Playlist[]) => void) {
  const ref = useRef(data)
  ref.current = data
  const loaded = data !== null
  const mine = (): SyncState => ({ lists: ref.current?.playlists ?? [], deleted: loadDeleted() })

  // PC: hand the playlists to the link, merge what a phone sends, scan in songs a phone sends
  useEffect(() => {
    const link = host()?.link
    if (!loaded || !link?.pushPlaylists) return
    link.pushPlaylists(forPhones(mine()))
    // §98: the PC is king. A phone on an older version may still send its copy: it's not merged, just answered
    // with the PC's own, so that phone comes back in line
    const offLists = link.onPlaylists?.(() => { link.pushPlaylists?.(forPhones(mine())) })
    const offUploads = link.onUploaded?.(() => { void scan().catch(() => {}) })
    return () => { offLists?.(); offUploads?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, save])

  // PC: a missing phone song that has arrived (sent from the phone) takes its real id, and phones hear of it
  const tracks = data?.tracks
  useEffect(() => {
    const d = ref.current
    if (!d || !host()?.link?.pushPlaylists) return
    const lists = resolveMissing(d.playlists, d.tracks)
    if (lists !== d.playlists) save(localEdit(d.playlists, lists, d.tracks))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, save])

  // phone: fetch the PC's playlists whenever the link says something changed; nothing is sent back
  useEffect(() => {
    const link = phoneLink
    if (!loaded || !link?.playlists) return
    let busy = false
    const pull = async () => {
      if (busy) return
      busy = true
      try {
        const r = await link.playlists!()
        const wire = r?.json ? asState(JSON.parse(r.json)) : null
        if (!wire) return
        const was = mine()
        const next = { lists: withPcLists(was.lists, fromWire(wire.lists, ref.current?.tracks ?? [])), deleted: was.deleted }
        if (!sameState(next, was) || next.lists.some((p, i) => p.origin !== was.lists[i]?.origin)) save(next.lists)
      } catch {
        // not connected: the next change tries again
      } finally {
        busy = false
      }
    }
    void pull()
    const sub = link.addListener('changed', () => { void pull() })
    return () => { void sub.then((s) => s.remove()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, save])
}

// Moves playlists between the PC and the phone (plan §80 A); the merging itself is in playlistSync.ts.
// PC: the page hands its copy to the link worker, which phones fetch; a phone's copy comes back through the window.
// Phone: fetches the PC's copy whenever the link reports a change, merges, and sends its merged copy back.
import { useEffect, useRef } from 'react'
import { getSetting, setSetting } from './settings/store'
import { host } from './host'
import { phoneLink } from './linkClient'
import { scan } from './localLibrary'
import { asState, fromWire, merge, pruneDeleted, resolveMissing, sameState, stamp, toWire, type SyncState } from './playlistSync'
import type { LibraryData, Playlist, Track } from './library'

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

/** Sends this side's copy: to the link worker on the PC, to the PC on the phone (quietly, if it's not connected). */
function send(s: SyncState, tracks: Track[]) {
  const pc = host()?.link?.pushPlaylists
  if (pc) return pc(JSON.stringify(s))
  void phoneLink?.putPlaylists?.({ json: JSON.stringify({ lists: toWire(s.lists, tracks), deleted: s.deleted }) }).catch(() => {})
}

/** A local edit: new or changed playlists get the time, deletes are remembered, and the other side is told. */
export function localEdit(prev: Playlist[], next: Playlist[], tracks: Track[]): Playlist[] {
  const before = { lists: prev, deleted: loadDeleted() }
  const s = stamp(prev, next, before.deleted)
  if (sameState(s, before)) return s.lists
  saveDeleted(s.deleted)
  send(s, tracks)
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
    link.pushPlaylists(JSON.stringify(mine()))
    const offLists = link.onPlaylists?.((sent) => {
      const theirs = asState(sent)
      if (!theirs) return
      const was = mine()
      const m = merge(was, theirs)
      const next = { lists: resolveMissing(m.lists, ref.current?.tracks ?? []), deleted: m.deleted }
      saveDeleted(next.deleted)
      if (!sameState(next, was)) save(next.lists)
      link.pushPlaylists?.(JSON.stringify(next))
    })
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

  // phone: fetch the PC's copy whenever the link says something changed, merge, and send the merged copy back
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
        const songs = ref.current?.tracks ?? []
        const was = mine()
        const m = merge(was, { lists: fromWire(wire.lists, songs), deleted: wire.deleted })
        saveDeleted(m.deleted)
        if (!sameState(m, was)) save(m.lists)
        const back = { lists: toWire(m.lists, songs), deleted: m.deleted }
        if (!sameState(back, wire)) await link.putPlaylists?.({ json: JSON.stringify(back) })
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

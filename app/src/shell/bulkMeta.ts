// §87: song art and lyrics for the whole library, in the background, with progress and Stop. Both only fill what's
// missing (art also replaces covers under 300 px), skip songs the PC stream only knows by id, and wait for Wi-Fi on the
// phone. YouTube rips wait until the background namer has looked them up; one it couldn't name is tried once with
// its cleaned-up title.
import { useSyncExternalStore } from 'react'
import { cleanRipTitle, coverUrl, isPcTrack, type Track } from './library'
import { isNamingRunning, lookUp, MB_GAP_MS, nameOne, needsNaming, savedDetails, saveDetails, type Found } from './metadata'
import { savedOnlineLyrics, searchOnline } from './onlineLyrics'
import { logLine } from './logs'

export type BulkKind = 'art' | 'lyrics'
export interface BulkStatus { running: boolean; done: number; total: number; found: number; current: string; waiting: string }

const IDLE: BulkStatus = { running: false, done: 0, total: 0, found: 0, current: '', waiting: '' }
const status: Record<BulkKind, BulkStatus> = { art: IDLE, lyrics: IDLE }
const stopAsked: Record<BulkKind, boolean> = { art: false, lyrics: false }
const listeners = new Set<() => void>()
const set = (k: BulkKind, patch: Partial<BulkStatus>) => {
  status[k] = { ...status[k], ...patch }
  listeners.forEach((l) => l())
}
export const useBulkStatus = (k: BulkKind) =>
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => status[k])
export const stopBulk = (k: BulkKind) => { stopAsked[k] = true }

/** Covers smaller than this (shortest side, px) are replaced when a bigger one is found. */
export const SMALL_COVER = 300
const RECHECK_MS = 30 * 86_400_000
const checkedKey = (k: BulkKind, id: string) => `shell.bulk.${k}.${id}`
const checkedRecently = (k: BulkKind, id: string) => {
  try { return Date.now() - Number(localStorage.getItem(checkedKey(k, id)) ?? 0) < RECHECK_MS } catch { return false }
}
const markChecked = (k: BulkKind, id: string) => { try { localStorage.setItem(checkedKey(k, id), String(Date.now())) } catch { /* full */ } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Android reports the connection type; on mobile data both jobs wait (the PC has no such type and never waits). */
const onMobileData = () => (navigator as Navigator & { connection?: { type?: string } }).connection?.type === 'cellular'

/** A rip the namer hasn't looked at yet: its title isn't trustworthy enough to search with. */
export function waitsForName(t: Track): boolean {
  const saved = savedDetails(t.id)
  if (saved?.confirmedMatch || saved?.notFoundOnline) return false
  const title = t.originalTitle ?? t.title
  return cleanRipTitle(title) !== title || !t.artist || /^unknown(\s+artist)?$/i.test(t.artist)
}

/** The cleaned-up title for a rip the namer couldn't find; the song itself otherwise. */
function searchable(t: Track): Track {
  const title = t.originalTitle ?? t.title
  return savedDetails(t.id)?.notFoundOnline && cleanRipTitle(title) !== title ? { ...t, title: cleanRipTitle(title) } : t
}

export function imageSide(src: string): Promise<number> {
  return new Promise((done) => {
    const img = new Image()
    img.onload = () => done(Math.min(img.naturalWidth, img.naturalHeight))
    img.onerror = () => done(0)
    img.src = src
  })
}

// shortcut: art and lyrics running together can both ask MusicBrainz for a rip in the same second; fine for a few rips, queue them if it trips the limit
async function waitForTurn(k: BulkKind, mbToo: boolean) {
  while (!stopAsked[k] && (onMobileData() || (mbToo && isNamingRunning()))) {
    set(k, { waiting: onMobileData() ? 'Waiting for Wi-Fi' : 'Waiting for the song naming to finish' })
    await sleep(3000)
  }
  if (status[k].waiting) set(k, { waiting: '' })
}

async function run(k: BulkKind, tracks: Track[], step: (t: Track) => Promise<boolean>, mbToo: boolean) {
  if (status[k].running) return
  stopAsked[k] = false
  set(k, { ...IDLE, running: true, total: tracks.length })
  try {
    for (const t of tracks) {
      await waitForTurn(k, mbToo)
      if (stopAsked[k]) break
      set(k, { current: t.title })
      try {
        if (await step(t)) set(k, { found: status[k].found + 1 })
      } catch (e) {
        logLine('WARN', 'Details', `${k === 'art' ? 'Song art' : 'Lyrics'} for "${t.title}": ${String(e)}`)
      }
      markChecked(k, t.id)
      set(k, { done: status[k].done + 1 })
    }
  } finally {
    set(k, { running: false, current: '', waiting: '' })
    logLine('INFO', 'Details', `${k === 'art' ? 'Import song art' : 'Sync lyrics'}: ${status[k].found} found in ${status[k].done} songs`)
  }
}

/** Albums asked once per run: the songs of one album share the answer. */
const albumKey = (t: Track) => (t.album ? `${(t.albumArtist || t.artist).toLowerCase()}|${t.album.toLowerCase()}` : '')

export async function importSongArt(library: Track[]) {
  const albums = new Map<string, Found | null>()
  // each song's own cover is measured as the job reaches it, so progress shows from the first second (measuring
  // the whole library first left the row silent for minutes)
  await run('art', library.filter((t) => !isPcTrack(t) && !checkedRecently('art', t.id)), async (t) => {
    const had = t.cover ? await imageSide(coverUrl(t.cover)) : 0
    if (had >= SMALL_COVER) return false
    // a rip goes through the namer first; that lookup brings a cover (and a genre) with it when the song had none
    if (waitsForName(t) || needsNaming(t)) {
      await nameOne(t)
      await sleep(MB_GAP_MS)
      if (!had && savedDetails(t.id)?.from.cover) return true
    }
    const key = albumKey(t)
    let found = key ? albums.get(key) : undefined
    if (found === undefined) {
      const res = await lookUp({ ...searchable(t), cover: '' })
      await sleep(MB_GAP_MS)
      found = res.found ?? null
      if (key) albums.set(key, found)
    }
    if (!found) return false
    // the genre comes along even without a cover: it gives the song its coloured cover
    const cover = found.cover && (!had || (await imageSide(found.cover)) > had) ? found.cover : undefined
    const before = savedDetails(t.id)
    // a cover mark without its image would hide the song's own cover: only a stored cover is marked
    const { cover: _coverFrom, ...fieldsFrom } = found.from
    await saveDetails(t.id, {
      values: found.values,
      from: cover ? { ...fieldsFrom, cover: found.from.cover ?? 'coverart' } : fieldsFrom,
      at: Date.now(),
      ...(cover ? { cover, replaceCover: had > 0 } : {}),
      ...(before ? {} : { originalTitle: t.originalTitle ?? t.title, originalArtist: t.originalArtist ?? t.artist }),
    })
    return Boolean(cover)
  }, true)
}

export async function syncLyrics(library: Track[]) {
  const wanted = (t: Track) => !isPcTrack(t) && !t.lyrics && !savedOnlineLyrics(t.id) && !checkedRecently('lyrics', t.id)
  const todo = library.filter(wanted)
  // songs with a clear name go first; a rip is named first and searched by the name found (or its cleaned title)
  const rips = todo.filter(waitsForName)
  await run('lyrics', [...todo.filter((t) => !rips.includes(t)), ...rips], async (t) => {
    let song = t
    if (waitsForName(t)) {
      await nameOne(t)
      await sleep(MB_GAP_MS)
      const d = savedDetails(t.id)
      song = d?.confirmedMatch ? { ...t, title: d.title ?? t.title, artist: d.artist ?? t.artist } : searchable(t)
    }
    const text = await searchOnline(searchable(song))
    await sleep(300)
    return Boolean(text)
  }, true)
}

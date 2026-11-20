// §87: song art and lyrics for the whole library, in the background, with progress and Stop. Both only fill what's
// missing (art also replaces covers under 300 px), skip songs the PC stream only knows by id, and wait for Wi-Fi on the
// phone. YouTube rips wait until the background namer has looked them up; one it couldn't name is tried once with
// its cleaned-up title.
import { useSyncExternalStore } from 'react'
import { albumOwner, cleanRipTitle, coverUrl, isPcTrack, type Track } from './library'
import { isNamingRunning, isRateLimited, lookUp, nameOne, needsNaming, savedDetails, saveDetails, type Lookup } from './metadata'
import { savedOnlineLyrics, searchOnline } from './onlineLyrics'
import { logLine } from './logs'
// on mobile data both jobs wait (the PC never does)
import { onMobileData } from './linkClient'
import { allowBulkNotifications, finishBulkProgress, onBulkStop, showBulkProgress, waitMs } from '../platform'

export type BulkKind = 'art' | 'lyrics'
export interface BulkStatus { running: boolean; done: number; total: number; found: number; current: string; waiting: string; note?: string }

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
// §94: Stop ends the job at once; the song being looked up is let go instead of waited for
const stopSignal: Record<BulkKind, () => void> = { art: () => {}, lyrics: () => {} }
export const stopBulk = (k: BulkKind) => { stopAsked[k] = true; stopSignal[k]() }
/** A song taking longer than this is skipped (left unchecked) so one stuck lookup can't hold up the job. */
const SONG_LIMIT_MS = 60_000
export const LYRICS_GAP_MS = 500

/** Covers smaller than this (shortest side, px) are replaced when a bigger one is found. */
export const SMALL_COVER = 300
const RECHECK_MS = 14 * 86_400_000
// lyrics marks moved to a new key: a test run on 2026-11-19 marked songs whose lookups had failed (HTTP 429)
const checkedKey = (k: BulkKind, id: string) => `shell.bulk.${k === 'lyrics' ? 'lyrics2' : k}.${id}`
const checkedRecently = (k: BulkKind, id: string) => {
  try { return Date.now() - Number(localStorage.getItem(checkedKey(k, id)) ?? 0) < RECHECK_MS } catch { return false }
}
const markChecked = (k: BulkKind, id: string) => { try { localStorage.setItem(checkedKey(k, id), String(Date.now())) } catch { /* full */ } }

// §90 B: a native timer on the phone, so a hidden page's throttling doesn't slow the job
const sleep = waitMs


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

// §100: the namer, art and lyrics run side by side; only a rip waits, for the namer to name it first
async function waitForTurn(k: BulkKind, mbToo: boolean, stopped: Promise<unknown>) {
  while (!stopAsked[k] && (onMobileData() || (mbToo && isNamingRunning()))) {
    set(k, { waiting: onMobileData() ? 'Waiting for Wi-Fi' : 'Waiting for the song naming to finish' })
    notify(k)
    await Promise.race([sleep(3000), stopped])
  }
  if (status[k].waiting) set(k, { waiting: '' })
}


const JOB_NAME: Record<BulkKind, string> = { art: 'Importing song art', lyrics: 'Syncing lyrics' }
let stopHooked = false

/** The phone's progress notification (Mihon-style): the count, the song, a bar and Stop. */
function notify(k: BulkKind) {
  const st = status[k]
  // a late update after Stop would bring the finished notification (and its service) back
  if (!st.running || stopAsked[k]) return
  showBulkProgress(JOB_NAME[k], st.waiting || st.current, st.done, st.total)
}

/** `parallel` songs at a time. Lyrics use 1: LRCLIB answers 429 to 3 at a time (measured 2026-11-19). Song art uses 3: its
 * MusicBrainz calls still queue one a second inside `mb()`, the cover sites have no such limit (§94 A). */
async function run(k: BulkKind, tracks: Track[], step: (t: Track) => Promise<boolean | 'later'>, mbToo: boolean, parallel = 1) {
  if (status[k].running) return
  if (!stopHooked) {
    stopHooked = true
    onBulkStop(() => { stopBulk('art'); stopBulk('lyrics') })
  }
  stopAsked[k] = false
  set(k, { ...IDLE, running: true, total: tracks.length })
  if (!tracks.length) {
    // §100: said on the row too, so a job with nothing to do doesn't look like it never ran
    set(k, { running: false, note: 'Every song was checked in the last 2 weeks' })
    logLine('INFO', 'Details', `${k === 'art' ? 'Import song art' : 'Sync lyrics'}: nothing to check (every song was checked in the last 2 weeks)`)
    return
  }
  const stopped = new Promise<'stop'>((done) => { stopSignal[k] = () => done('stop') })
  await allowBulkNotifications()
  notify(k)
  const startedAt = Date.now()
  let next = 0
  const worker = async () => {
    while (next < tracks.length) {
      await waitForTurn(k, mbToo && Boolean(tracks[next]) && waitsForName(tracks[next]), stopped)
      if (stopAsked[k]) return
      const t = tracks[next++]
      if (!t) return
      set(k, { current: t.title })
      notify(k)
      let tries = 0
      for (;;) {
        try {
          const took = Date.now()
          const res = await Promise.race([step(t), stopped, sleep(SONG_LIMIT_MS).then(() => 'slow' as const)])
          if (res === 'stop') return
          if (res === 'slow') {
            logLine('WARN', 'Details', `${k === 'art' ? 'Song art' : 'Lyrics'} for "${t.title}": no answer in ${Math.round((Date.now() - took) / 1000)} s, skipped for now`)
            break
          }
          if (Date.now() - took > 15_000) logLine('INFO', 'Details', `${k === 'art' ? 'Song art' : 'Lyrics'} for "${t.title}" took ${Math.round((Date.now() - took) / 1000)} s`)
          // 'later': nothing found while MusicBrainz was resting; left unchecked so the next run asks it
          if (res === true) set(k, { found: status[k].found + 1 })
          if (res !== 'later') markChecked(k, t.id)
          break
        } catch (e) {
          // a site asking us to slow down (429, MusicBrainz 503): wait and try the same song again; any other failure isn't marked
          // checked, so the next run asks again instead of skipping the song for 2 weeks
          if (isRateLimited(e) && tries++ < 3 && !stopAsked[k]) {
            // the site's own Retry-After when it gives one (LRCLIB does), a minute otherwise
            const after = Number(/retry after (\d+)/.exec(String(e))?.[1] ?? 60)
            const wait = Math.min(300, Math.max(5, after))
            logLine('WARN', 'Details', `${k === 'art' ? 'Song art' : 'Lyrics'} for "${t.title}": ${String(e)}, waiting ${wait} s`)
            set(k, { waiting: `The site asked to slow down: waiting ${wait} s` })
            notify(k)
            await Promise.race([sleep(wait * 1000), stopped])
            set(k, { waiting: '' })
            if (stopAsked[k]) return
            continue
          }
          logLine('WARN', 'Details', `${k === 'art' ? 'Song art' : 'Lyrics'} for "${t.title}": ${String(e)}`)
          break
        }
      }
      set(k, { done: status[k].done + 1 })
    }
  }
  try {
    await Promise.all(Array.from({ length: parallel }, worker))
  } finally {
    const { found, done } = status[k]
    set(k, { running: false, current: '', waiting: '' })
    const what = k === 'art' ? 'covers' : 'lyrics'
    finishBulkProgress(`${stopAsked[k] ? 'Stopped' : 'Done'}: ${found} ${what} found in ${done} songs`)
    logLine('INFO', 'Details', `${k === 'art' ? 'Import song art' : 'Sync lyrics'}: ${found} found in ${done} songs (${Math.round((Date.now() - startedAt) / 1000)} s)`)
  }
}

/** Albums asked once per run: the songs of one album share the answer. */
const albumKey = (t: Track) => (t.album ? `${albumOwner(t).toLowerCase()}|${t.album.toLowerCase()}` : '')

export async function importSongArt(library: Track[]) {
  // the album's lookup itself is shared, so songs of one album running side by side ask once
  const albums = new Map<string, Promise<Lookup>>()
  // each song's own cover is measured as the job reaches it, so progress shows from the first second (measuring
  // the whole library first left the row silent for minutes)
  const todo = library.filter((t) => !isPcTrack(t) && !checkedRecently('art', t.id))
  const rips = new Set(todo.filter(waitsForName))
  await run('art', [...todo.filter((t) => !rips.has(t)), ...rips], async (t) => {
    const had = t.cover ? await imageSide(coverUrl(t.cover)) : 0
    if (had >= SMALL_COVER) return false
    // a rip goes through the namer first; that lookup brings a cover (and a genre) with it when the song had none.
    // While the namer runs it has that song in its own lane, so art only looks for the cover.
    if (waitsForName(t) || (needsNaming(t) && !isNamingRunning())) {
      try {
        await nameOne(t)
      } catch (e) {
        if (isRateLimited(e)) return 'later'
        throw e
      }
      if (!had && savedDetails(t.id)?.from.cover) return true
    }
    const key = albumKey(t)
    let asked = key ? albums.get(key) : undefined
    if (!asked) {
      // a failed lookup (429) is forgotten, so the retry asks again
      asked = lookUp({ ...searchable(t), cover: '' }, true).catch((e) => { albums.delete(key); throw e })
      if (key) albums.set(key, asked)
    }
    const res = await asked
    const found = res.found
    if (!found && res.later) {
      albums.delete(key)
      return 'later'
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
  }, true, 3)
}

export async function syncLyrics(library: Track[]) {
  const wanted = (t: Track) => !isPcTrack(t) && !t.lyrics && !savedOnlineLyrics(t.id) && !checkedRecently('lyrics', t.id)
  const todo = library.filter(wanted)
  // songs with a clear name go first; a rip is named first and searched by the name found (or its cleaned title)
  const rips = new Set(todo.filter(waitsForName))
  await run('lyrics', [...todo.filter((t) => !rips.has(t)), ...rips], async (t) => {
    let song = t
    if (waitsForName(t)) {
      await nameOne(t)
      const d = savedDetails(t.id)
      song = d?.confirmedMatch ? { ...t, title: d.title ?? t.title, artist: d.artist ?? t.artist } : searchable(t)
    }
    try {
      return Boolean(await searchOnline(searchable(song)))
    } finally {
      // §100: LRCLIB answered 429 at 0.3 s between songs, and a failed song used to skip the pause
      await sleep(LYRICS_GAP_MS)
    }
  }, true)
}

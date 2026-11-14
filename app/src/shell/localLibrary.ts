// Local Library on the page side (plan section 63): the chosen folders, scans and their progress. The host (exe or dev
// server) does the reading; see electron/library-scan.mjs.
import { useSyncExternalStore } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { feedRegisteredNamingSink, type Track } from './library'
import { logLine } from './logs'
import { getSetting } from './settings/store'

export interface LibraryFolder {
  path: string
  subfolders: boolean
  /** PC: subfolders left out (full paths). Android keeps these in its hidden list instead. */
  exclude?: string[]
  lastScan: number
  online: boolean
  count: number
}

export interface Scanning {
  found: number
  read: number
  folder: string
}

/** A folder whose songs are left out (Android: top folders taken off the list). Nothing in it is touched. */
export interface HiddenFolder {
  path: string
  count: number
}

interface HostState {
  folders: LibraryFolder[]
  hidden?: HiddenFolder[]
  tracks: Track[]
  scanning: Scanning | null
  version: number
}

export interface LibraryStatus {
  loaded: boolean
  folders: LibraryFolder[]
  hidden: HiddenFolder[]
  scanning: Scanning | null
}

let status: LibraryStatus = { loaded: false, folders: [], hidden: [], scanning: null }
const listeners = new Set<() => void>()
const trackListeners = new Set<(tracks: Track[]) => void>()
let lastVersion = -1
let polling = 0

const set = (next: Partial<LibraryStatus>) => {
  status = { ...status, ...next }
  listeners.forEach((l) => l())
}

export const useLibraryStatus = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => status)
export const libraryStatus = () => status

/** Called with the whole song list whenever it changes, including part-way through a scan. */
export function onTracks(listener: (tracks: Track[]) => void) {
  trackListeners.add(listener)
  return () => { trackListeners.delete(listener) }
}

/**
 * Android (plan §70 A2): MainActivity answers the GET routes, but a WebView can't read POST bodies, so scan and the
 * folder list go through the ShellHost plugin (ShellHostPlugin.java). Scan also asks for Music and audio access.
 */
interface AndroidHost {
  scan: () => Promise<{ started: boolean }>
  setFolders: (o: { folders: Pick<LibraryFolder, 'path' | 'subfolders'>[] }) => Promise<{ folders: LibraryFolder[] }>
  hideFolder: (o: { path: string; hidden: boolean }) => Promise<void>
  setWakeLock?: (o: { enabled: boolean }) => Promise<{ active: boolean }>
}
export const android = Capacitor.getPlatform() === 'android' ? registerPlugin<AndroidHost>('ShellHost') : null

async function fetchState(): Promise<HostState> {
  const response = await fetch('/shell-host/library')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<HostState>
}

/** Reads the list; while a scan runs, keeps reading until it ends. */
export async function refresh(): Promise<Track[]> {
  const state = await fetchState()
  set({ loaded: true, folders: state.folders, hidden: state.hidden ?? [], scanning: state.scanning })
  feedRegisteredNamingSink(state.tracks)
  if (state.version !== lastVersion) {
    lastVersion = state.version
    trackListeners.forEach((l) => l(state.tracks))
  }
  if (state.scanning && !polling) {
    polling = window.setInterval(() => {
      fetchState()
        .then((s) => {
          set({ folders: s.folders, hidden: s.hidden ?? [], scanning: s.scanning })
          feedRegisteredNamingSink(s.tracks)
          if (s.version !== lastVersion) {
            lastVersion = s.version
            trackListeners.forEach((l) => l(s.tracks))
          }
          if (!s.scanning) {
            window.clearInterval(polling)
            polling = 0
            logLine('INFO', 'Library', `Scan finished: ${s.tracks.length} songs in ${s.folders.length} folder(s)`)
          }
        })
        .catch(() => {})
    }, 600)
  }
  return state.tracks
}

export async function scan(full = false) {
  if (android) await android.scan()
  else await fetch(`/shell-host/library/scan${full ? '?full=1' : ''}`, { method: 'POST' })
  logLine('INFO', 'Library', full ? 'Full scan started' : 'Scan started')
  await refresh()
}

export type MetaBannerState = 'refreshing' | 'done' | null

let metaBannerState: MetaBannerState = null
const metaBannerListeners = new Set<(state: MetaBannerState) => void>()

export function getMetaBannerState(): MetaBannerState {
  return metaBannerState
}

export function setMetaBannerState(state: MetaBannerState) {
  metaBannerState = state
  metaBannerListeners.forEach((l) => l(state))
}

export function subscribeMetaBanner(l: (state: MetaBannerState) => void): () => void {
  metaBannerListeners.add(l)
  return () => { metaBannerListeners.delete(l) }
}

export function useMetaBanner(): MetaBannerState {
  return useSyncExternalStore(subscribeMetaBanner, getMetaBannerState)
}

/** Slides down the information banner ("Metadata is being refreshed…") and pulls back when finished (§72). */
export async function triggerMetadataRefresh() {
  setMetaBannerState('refreshing')
  try {
    await scan(false)
    let checks = 0
    while (status.scanning && checks < 30) {
      await new Promise((r) => setTimeout(r, 400))
      checks++
    }
    setMetaBannerState('done')
    setTimeout(() => {
      setMetaBannerState(null)
    }, 1600)
  } catch (e) {
    setMetaBannerState(null)
    throw e
  }
}

/** Replaces the folder list. Songs of a removed folder leave the list straight away. */
export async function setFolders(folders: Pick<LibraryFolder, 'path' | 'subfolders' | 'exclude'>[]) {
  if (android) set({ folders: (await android.setFolders({ folders })).folders })
  else {
    const response = await fetch('/shell-host/library/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(folders) })
    set({ folders: (await response.json()) as LibraryFolder[] })
  }
  await refresh()
}

/** "D:\Music\" and "/Music/" alike → "D:/Music", "Music": for comparing folder paths from either host. */
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export interface Subfolder {
  name: string
  /** As the host wants it: a full path on PC, "Music/the music/" on Android. */
  path: string
  /** Songs in it (and below it) now; 0 for one that's left out. */
  count: number
  kept: boolean
}

/**
 * The folders directly inside a library folder, kept or left out (Settings → Local Library, owner 2026-11-07: "do you
 * still want this subfolder or not"). Built from the songs' folders plus the left-out list, so a left-out one still shows.
 */
export function subfoldersOf(folder: LibraryFolder, tracks: Track[], hidden: HiddenFolder[]): Subfolder[] {
  const root = norm(folder.path)
  const key = root.toLowerCase()
  const counts = new Map<string, number>()
  for (const t of tracks) {
    const f = norm(t.folder)
    if (!f.toLowerCase().startsWith(`${key}/`)) continue
    const name = f.slice(root.length + 1).split('/')[0]
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const left = [...(folder.exclude ?? []), ...hidden.map((h) => h.path)].map(norm).filter((p) => p.toLowerCase().startsWith(`${key}/`))
  const leftNames = new Set(left.map((p) => p.slice(root.length + 1)).filter((n) => !n.includes('/')))
  for (const n of leftNames) if (!counts.has(n)) counts.set(n, 0)
  const pathOf = (name: string) => (android ? `${root}/${name}/` : `${folder.path.replace(/[\\/]+$/, '')}${folder.path.includes('\\') ? '\\' : '/'}${name}`)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, path: pathOf(name), count, kept: !leftNames.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Keeps or leaves out one subfolder. Nothing on disk changes either way. */
export async function keepSubfolder(folder: LibraryFolder, sub: Subfolder, keep: boolean) {
  if (android) {
    await android.hideFolder({ path: sub.path, hidden: !keep })
    await refresh()
    return
  }
  const same = (p: string) => norm(p).toLowerCase() === norm(sub.path).toLowerCase()
  const exclude = keep ? (folder.exclude ?? []).filter((p) => !same(p)) : [...(folder.exclude ?? []).filter((p) => !same(p)), sub.path]
  await setFolders(status.folders.map((f) => (f.path === folder.path ? { ...f, exclude } : f)))
}

/** Android: leaves one folder's songs out (any depth), until Add back in Settings → Local Library. Files are untouched. */
export async function hideFolder(path: string) {
  if (!android) return
  await android.hideFolder({ path, hidden: true })
  await refresh()
}

export async function addFolder(path: string, subfolders: boolean) {
  const known = status.folders.map((f) => ({ path: f.path, subfolders: f.subfolders }))
  if (known.some((f) => f.path.toLowerCase() === path.toLowerCase())) return false
  await setFolders([...known, { path, subfolders }])
  await scan()
  return true
}

const DAY = 24 * 60 * 60 * 1000

/** Auto Scan: Every app open, Daily or Weekly, judged by the oldest folder's last scan. */
export function scanIsDue(folders: LibraryFolder[], now = Date.now(), mode = String(getSetting('autoscan') ?? 'Every app open')): boolean {
  if (!folders.length || mode === 'Off') return false
  if (mode === 'Every app open') return true
  const oldest = Math.min(...folders.map((f) => f.lastScan || 0))
  return now - oldest >= (mode === 'Daily' ? DAY : 7 * DAY)
}

export function lastScanText(at: number, now = Date.now()): string {
  if (!at) return 'Not scanned yet'
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Songs that look like the same recording: same title and artist, lengths within 2 seconds.
 * Excludes matching PC-and-local pairs so remote library streams don't flag local counterparts as duplicates. */
export function duplicateGroups(tracks: Track[]): Track[][] {
  const key = (t: Track) => `${t.title.toLowerCase().replace(/\s+/g, ' ').trim()}\u0000${t.artist.toLowerCase().trim()}`
  const byKey = new Map<string, Track[]>()
  for (const t of tracks) {
    const list = byKey.get(key(t))
    if (list) list.push(t)
    else byKey.set(key(t), [t])
  }
  const isPc = (t: Track) => t.source === 'pc' || (t.path ? t.path.startsWith('pc:') : false)
  const groups: Track[][] = []

  const evaluateGroup = (g: Track[]) => {
    if (g.length < 2) return
    const pcTracks = g.filter(isPc)
    const localTracks = g.filter((t) => !isPc(t))
    // A single PC stream paired with a single local file is a cross-device stream link, not a duplicate
    if (pcTracks.length <= 1 && localTracks.length <= 1) return
    groups.push(g)
  }

  for (const list of byKey.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.sec - b.sec)
    let group = [sorted[0]]
    for (const t of sorted.slice(1)) {
      if (t.sec - group[group.length - 1].sec <= 2) group.push(t)
      else {
        evaluateGroup(group)
        group = [t]
      }
    }
    evaluateGroup(group)
  }
  return groups
}

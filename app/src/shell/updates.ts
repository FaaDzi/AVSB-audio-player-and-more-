// Update check (plan §83 A, B; §97): asks GitHub which releases exist at every start (and on a phone when a page is
// pulled down from its top), and says so when one is newer than this build. "Download" opens that release's file for this platform; nothing is installed behind your back.
// Android installs the APK over the app (same signing key); on Windows it's the zip (your data lives in %APPDATA%).
import { registerPlugin } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { version } from '../../package.json'
import { isAndroid, openExternal } from '../platform'
import { getSetting } from './settings/store'

const RELEASES = 'https://api.github.com/repos/FaaDzi/AVSB-audio-player-and-more-/releases?per_page=20'

export interface Release {
  tag_name: string
  prerelease: boolean
  draft: boolean
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

export interface Update {
  version: string
  /** A pre-release (the Preview channel): its dot is blue, a stable one's red. */
  preview: boolean
  /** The file for this platform, or the release page when it has none. */
  url: string
}

/** "v1.2.0-preview.31" → [1, 2, 0, 31]; a plain release sorts above its previews. Null when it isn't a version. */
export function parseVersion(tag: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[a-z]*\.?(\d+))?$/i.exec(tag.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0), m[4] === undefined ? Infinity : Number(m[4])]
}

export function isNewer(tag: string, than: string): boolean {
  const [a, b] = [parseVersion(tag), parseVersion(than)]
  if (!a || !b) return false
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** The newest release above `current` on this channel (Stable never sees pre-releases), with this platform's file. */
export function pickUpdate(releases: Release[], current: string, preview: boolean, android: boolean): Update | null {
  let best: Release | null = null
  for (const r of releases) {
    if (r.draft || (r.prerelease && !preview) || !isNewer(r.tag_name, best?.tag_name ?? current)) continue
    best = r
  }
  if (!best) return null
  const file = best.assets.find((a) => (android ? /\.apk$/i : /windows.*\.zip$|\.exe$/i).test(a.name))
  return { version: best.tag_name.replace(/^v/i, ''), preview: best.prerelease, url: file?.browser_download_url ?? best.html_url }
}

/** Asks GitHub now. Null when there's nothing newer or GitHub can't be reached. */
export async function checkNow(): Promise<Update | null> {
  try {
    const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) return null
    const found = pickUpdate((await r.json()) as Release[], version, getSetting('channel') === 'Preview', isAndroid())
    setFound(found)
    return found
  } catch {
    return null
  }
}

// §97: the newest release the last check found, for the dot on Settings → App and its Download row
let found: Update | null = null
const watchers = new Set<() => void>()
function setFound(u: Update | null) {
  if (u?.version === found?.version && u?.url === found?.url) return
  found = u
  watchers.forEach((w) => w())
}
export const useFoundUpdate = () => useSyncExternalStore((w) => { watchers.add(w); return () => { watchers.delete(w) } }, () => found)

/** §97: the automatic check, at every start (it used to rest a day, so a new release went unseen), with "Check for Updates" on. */
export async function checkOnStart(): Promise<Update | null> {
  if (getSetting('updates') === false) return null
  return checkNow()
}

export const openUpdate = (u: Update) => openExternal(u.url)

interface Installer {
  installUpdate(o: { url: string }): Promise<void>
  addListener(event: 'updateProgress', f: (p: { done: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>
}
const installer = isAndroid() ? registerPlugin<Installer>('ShellHost') : null

/**
 * §97: Download. On Android the app fetches the APK itself and opens Android's "Update this app?" screen (the browser
 * could hang before the installer); `onShare` gets 0-1 as it arrives. Elsewhere it opens the file as before.
 * Resolves with an error to show, or null when the installer (or the browser) took over.
 */
export async function getUpdate(u: Update, onShare?: (share: number) => void): Promise<string | null> {
  if (!installer || !/\.apk$/i.test(u.url)) {
    openUpdate(u)
    return null
  }
  const sub = await installer.addListener('updateProgress', (p) => onShare?.(p.total > 0 ? p.done / p.total : 0))
  try {
    await installer.installUpdate({ url: u.url })
    return null
  } catch (e) {
    return (e as { message?: string }).message ?? String(e)
  } finally {
    void sub.remove()
  }
}

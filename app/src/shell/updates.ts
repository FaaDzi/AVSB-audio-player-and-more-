// Update check (plan §83 A, B): asks GitHub which releases exist, at most once a day, and says so when one is newer
// than this build. "Download" opens that release's file for this platform; nothing is installed behind your back.
// Android installs the APK over the app (same signing key); on Windows it's the zip (your data lives in %APPDATA%).
import { version } from '../../package.json'
import { isAndroid, openExternal } from '../platform'
import { getSetting, setSetting } from './settings/store'

const RELEASES = 'https://api.github.com/repos/FaaDzi/AVSB-audio-player-and-more-/releases?per_page=20'
const DAY_MS = 24 * 60 * 60 * 1000

export interface Release {
  tag_name: string
  prerelease: boolean
  draft: boolean
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

export interface Update {
  version: string
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
  return { version: best.tag_name.replace(/^v/i, ''), url: file?.browser_download_url ?? best.html_url }
}

/** Asks GitHub now. Null when there's nothing newer or GitHub can't be reached. */
export async function checkNow(): Promise<Update | null> {
  try {
    const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) return null
    const found = pickUpdate((await r.json()) as Release[], version, getSetting('channel') === 'Preview', isAndroid())
    // only "nothing new" rests for a day: a found update is said again on the next start (the toast is short)
    if (!found) setSetting('updates_checked', Date.now())
    return found
  } catch {
    return null
  }
}

/** The automatic check: only with "Check for Updates" on, and not more than once a day. */
export async function checkDaily(): Promise<Update | null> {
  if (getSetting('updates') === false) return null
  if (Date.now() - Number(getSetting('updates_checked') ?? 0) < DAY_MS) return null
  return checkNow()
}

export const openUpdate = (u: Update) => openExternal(u.url)

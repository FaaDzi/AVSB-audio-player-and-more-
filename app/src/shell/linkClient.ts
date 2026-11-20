// The phone's side of the PC link, as the page sees it (plan §70 D2/D3; native part: LinkPlugin.kt).
// The PC's songs arrive in the ordinary library list (ShellHostPlugin merges them), so playing, queues, playlists and
// stats need nothing special: a song from the PC has `source: 'pc'` and a "pc:<id>" path.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { refresh } from './localLibrary'

export interface PhoneLinkStatus {
  paired: boolean
  name: string
  connected: boolean
  /** How the songs travel right now: '' (not connected), 'direct' (same network or hole-punched) or 'relayed'. */
  path: '' | 'direct' | 'relayed'
  /** Active transfer channel on Android: LAN HTTP, direct iroh QUIC, or relayed iroh QUIC. */
  transport?: '' | 'lan-http' | 'iroh-direct' | 'iroh-relayed'
  /** The PC removed this phone, or the pairing expired. */
  refused: boolean
  /** This phone's own name, as it tells the PC (§81 F). */
  deviceName?: string
  songs: number
  error: string | null
  latencyMs?: number | null
  speedMbps?: number | null
  airplaneMode?: boolean
}

/**
 * §93 Batch 6: on mobile data? Android's answer, refreshed every 10 s and when the page comes back; false on the PC.
 * (navigator.connection.type, used before, isn't filled in by the WebView.)
 */
let mobileNow = false
const mobileListeners = new Set<(mobile: boolean) => void>()
export const onMobileData = () => mobileNow
/** Called when the phone moves between Wi-Fi and mobile data. */
export function onNetworkChange(cb: (mobile: boolean) => void) {
  mobileListeners.add(cb)
  return () => { mobileListeners.delete(cb) }
}
function pollNetwork() {
  void phoneLink?.network?.().then(({ mobile }) => {
    if (mobile === mobileNow) return
    mobileNow = mobile
    mobileListeners.forEach((l) => l(mobile))
  }).catch(() => {})
}

interface LinkPlugin {
  status: () => Promise<PhoneLinkStatus>
  pair: (o: { link: string }) => Promise<{ ok: boolean; name?: string; error?: string }>
  scan: () => Promise<{ text: string }>
  refresh: () => Promise<void>
  forget: () => Promise<void>
  /** §81 F: this phone's own name for the PC; '' goes back to Android's device name. */
  setName?: (o: { name: string }) => Promise<void>
  prebuffer?: (o: { id: string; lowData?: boolean }) => Promise<void>
  /** §88 C: the songs kept from the PC on this phone's storage. */
  songCache?: () => Promise<{ bytes: number; songs: number }>
  clearSongCache?: () => Promise<void>
  dropCachedSong?: (o: { id: string; lowData: boolean }) => Promise<void>
  /** §88 B: the phone's own little HTTP server for PC songs (127.0.0.1, secret path). */
  audioBase?: () => Promise<{ base: string }>
  ping?: () => Promise<PhoneLinkStatus>
  testSpeed?: () => Promise<PhoneLinkStatus>
  isAirplaneMode?: () => Promise<{ airplaneMode: boolean }>
  /** True on mobile data (Android's own answer). */
  network?: () => Promise<{ mobile: boolean }>
  /** §80 A: the PC's playlists (JSON of SyncState in PC ids); no json when not connected. */
  playlists?: () => Promise<{ json?: string }>
  putPlaylists?: (o: { json: string }) => Promise<void>
  /** Sends one of the phone's own songs (its content:// path) to the PC's library. */
  upload?: (o: { uri: string; name: string }) => Promise<{ name: string }>
  addListener: (event: 'changed', cb: () => void) => Promise<{ remove: () => Promise<void> }>
}

export const phoneLink = Capacitor.getPlatform() === 'android' ? registerPlugin<LinkPlugin>('Link') : null
if (phoneLink && typeof window !== 'undefined') {
  pollNetwork()
  window.setInterval(pollNetwork, 10_000)
  document.addEventListener('visibilitychange', pollNetwork)
  window.addEventListener('online', pollNetwork)
}

/** What a failed pairing says, in words. */
export function pairError(error = ''): string {
  switch (error) {
    case 'declined': return 'The PC said no'
    case 'wrong': case 'closed': return 'That code has expired or was already used. Open Pair a phone on the PC again'
    case 'full': return 'That PC already has five phones. Remove one there first'
    case 'known': return 'This phone is already paired with that PC'
    case 'timeout': return 'Nobody answered on the PC in time'
    default: return error ? `Couldn't reach the PC (${error})` : "Couldn't reach the PC"
  }
}

/**
 * A pairing link that arrived from outside (opened from a message or a browser). Shell listens to open Settings →
 * Connect to a PC; that page takes the link with takePairLink() and pairs.
 */
let pendingLink: string | null = null
const linkListeners = new Set<(link: string) => void>()
export function onPairLink(listener: (link: string) => void) {
  linkListeners.add(listener)
  if (pendingLink) listener(pendingLink)
  return () => { linkListeners.delete(listener) }
}
export function takePairLink() {
  const l = pendingLink
  pendingLink = null
  return l
}

if (phoneLink) {
  // the PC's songs changed (paired, refreshed, forgotten): the page reads the library again
  void phoneLink.addListener('changed', () => { void refresh().catch(() => {}) })
  const take = (url: string | undefined) => {
    if (!url?.startsWith('iemdream://pair')) return
    pendingLink = url
    linkListeners.forEach((l) => l(url))
  }
  void App.addListener('appUrlOpen', (e) => take(e.url))
  void App.getLaunchUrl().then((u) => take(u?.url)).catch(() => {})
}

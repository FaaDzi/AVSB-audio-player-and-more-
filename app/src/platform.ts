import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { runBack } from './game/backStack'
import { logLine } from './shell/logs'

/** Running as the Android app (Capacitor), not the Windows exe or a browser. */
export const isAndroid = () => Capacitor.getPlatform() === 'android'

/** Something that plays music on a context (the match and gallery players). */
interface MusicSource {
  readonly playing: boolean
}

const registeredAudioContexts = new Map<AudioContext, Set<MusicSource>>()

/**
 * Register an AudioContext so it suspends in the background and resumes on return (saves battery
 * on Android), except while one of its music sources is playing: songs keep going with the
 * screen off, on Home or minimised, like a music player.
 */
export function registerAudioContext(ctx: AudioContext, source?: MusicSource): () => void {
  const sources = registeredAudioContexts.get(ctx) ?? new Set()
  registeredAudioContexts.set(ctx, sources)
  if (source) sources.add(source)
  return () => {
    if (source) sources.delete(source)
    if (!sources.size) registeredAudioContexts.delete(ctx)
  }
}

const musicPlaying = () => [...registeredAudioContexts.values()].some((s) => [...s].some((m) => m.playing))

function handleAppVisibility(isActive: boolean) {
  document.body.classList.toggle('app-backgrounded', !isActive)
  for (const [ctx, sources] of registeredAudioContexts) {
    try {
      if (!isActive && ctx.state === 'running' && ![...sources].some((m) => m.playing)) {
        void ctx.suspend()
      } else if (isActive && ctx.state === 'suspended') {
        void ctx.resume()
      }
    } catch {
      /* AudioContext state transitions may throw if closed or invalid */
    }
  }
}

/**
 * Android: a foreground "media playback" service while music plays (so Android doesn't stop the
 * app with the screen off), holding audio focus. When another app takes focus (YouTube, a call,
 * another player) it fires "focusLost" and the app pauses.
 */
const MediaPlayback = registerPlugin<{
  /** background: false when Android refused the foreground service (review item 10). */
  start(): Promise<{ background?: boolean } | undefined>
  /** §88 B: true while the page's audio element (a streamed PC song) holds audio focus itself. */
  pageFocus?(o: { on: boolean }): Promise<void>
  stop(): Promise<void>
  setNowPlaying(o: {
    title: string
    artist: string
    album?: string
    duration: number
    position: number
    durationMs?: number
    positionMs?: number
    playing: boolean
    loading?: boolean
    cover?: string
    coverBase64?: string
    keepCover?: boolean
  }): Promise<void>
  clearNowPlaying(): Promise<void>
  addListener(event: 'focusLost', cb: () => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'control', cb: (e: MediaControl) => void): Promise<{ remove: () => Promise<void> }>
}>('MediaPlayback')

/** Fired on window when another app takes the audio (or the earphones are unplugged): playing screens pause themselves. */
export const AUDIO_INTERRUPTED = 'app-audio-interrupted'

/** A press on the notification, lock screen, earphone/Bluetooth buttons or media keys. */
export interface MediaControl {
  action: 'play' | 'pause' | 'next' | 'prev' | 'seek'
  /** Seconds, for seek. */
  position?: number
  /** Seconds to fade in over (play only: Bluetooth buds came back after a drop). */
  fadeIn?: number
}
/** Fired on window (CustomEvent<MediaControl>) for those presses; the gallery handles them. */
export const MEDIA_CONTROL = 'app-media-control'
const sendControl = (c: MediaControl) => window.dispatchEvent(new CustomEvent<MediaControl>(MEDIA_CONTROL, { detail: c }))

export interface NowPlaying {
  /** The song's id: what tells a new song from a new lyric line in the artist slot. */
  id?: string
  title: string
  artist: string
  album?: string
  duration: number
  position: number
  playing: boolean
  /** The song is still loading: shown as buffering, with the position held (plan §81 C). */
  loading?: boolean
  /** Cover art (object/data URL or /shell-host/cover), if the song has one. */
  coverUrl: string | null
  /** Shown when the cover can't be loaded (Android): the song's genre cover. */
  fallbackCover?: string | null
}

let lastTrackKey = ''
let lastCoverUrl: string | null | undefined
let lastCoverData: string | undefined
let coverToken = 0
let latestNp: NowPlaying | null = null
let mediaKeysSet = false

function drawToBase64(source: CanvasImageSource, width: number, height: number): string {
  const k = Math.min(1, 256 / Math.max(1, width, height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width * k))
  c.height = Math.max(1, Math.round(height * k))
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
}

function loadViaImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => {
      img.src = ''
      reject(new Error('cover load timeout'))
    }, 5000)
    img.onload = () => {
      window.clearTimeout(timer)
      try {
        resolve(drawToBase64(img, img.naturalWidth || img.width || 256, img.naturalHeight || img.height || 256))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('cover load error'))
    }
    img.src = url
  })
}

/**
 * Small JPEG of a cover, base64, for the notification (a full-size picture is too big to pass across).
 * Supports data: URLs, blob: URLs, and /shell-host/cover URLs with timeout and Image fallback.
 */
async function coverBase64(url: string): Promise<string> {
  if (!url) return ''
  // Large data URLs are scaled via canvas; never return raw unscaled bytes over Binder
  if (url.startsWith('data:')) {
    try {
      return await loadViaImage(url)
    } catch {
      return ''
    }
  }
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob)
      try {
        return drawToBase64(bmp, bmp.width, bmp.height)
      } finally {
        bmp.close?.()
      }
    } finally {
      window.clearTimeout(timer)
    }
  } catch {
    return loadViaImage(url)
  }
}

/**
 * §73.G — Unified System Notification & Lock Screen Sync:
 * Immediately dispatches the new track metadata (title, artist, album, duration, position, playing)
 * to the Android MediaSession / Windows MediaMetadata without blocking on network or cover decoding.
 * When the track changes, stale artwork is cleared immediately (`keepCover: false`) and the new cover
 * is sent in a non-blocking follow-up once decoded if the track is still current.
 */
export function setNowPlaying(np: NowPlaying) {
  latestNp = np
  if (!isAndroid()) {
    const ms = navigator.mediaSession
    if (!ms) return
    if (!mediaKeysSet) {
      mediaKeysSet = true
      ms.setActionHandler('play', () => sendControl({ action: 'play' }))
      ms.setActionHandler('pause', () => sendControl({ action: 'pause' }))
      ms.setActionHandler('nexttrack', () => sendControl({ action: 'next' }))
      ms.setActionHandler('previoustrack', () => sendControl({ action: 'prev' }))
      try {
        ms.setActionHandler('seekto', (d) => {
          if (typeof d.seekTime === 'number') sendControl({ action: 'seek', position: d.seekTime })
        })
      } catch {
        /* seekto optional on some browsers */
      }
    }
    const schemeOk = np.coverUrl ? /^(https?:|data:|blob:)/i.test(np.coverUrl) : false
    const immediateArt = np.coverUrl && (schemeOk || window.location.protocol !== 'app:')
      ? [{ src: np.coverUrl }]
      : []
    ms.metadata = new MediaMetadata({
      title: np.title,
      artist: np.artist,
      album: np.album ?? '',
      artwork: immediateArt,
    })
    ms.playbackState = np.playing && !np.loading ? 'playing' : 'paused'
    if (np.coverUrl && !immediateArt.length) {
      const wantedUrl = np.coverUrl
      const myToken = ++coverToken
      void coverBase64(wantedUrl).then((b64) => {
        if (!b64 || myToken !== coverToken || !latestNp || latestNp.coverUrl !== wantedUrl) return
        ms.metadata = new MediaMetadata({
          title: latestNp.title,
          artist: latestNp.artist,
          album: latestNp.album ?? '',
          artwork: [{ src: `data:image/jpeg;base64,${b64}`, sizes: '256x256', type: 'image/jpeg' }],
        })
      }).catch(() => {})
    }
    return
  }

  // Ensure the foreground service is active whenever a song starts playing
  if (np.playing && !mediaOn) {
    setMediaActive(true)
  }

  const trackKey = `${np.id ?? `${np.title}\0${np.artist}`}\0${np.coverUrl ?? ''}`
  const trackChanged = trackKey !== lastTrackKey
  lastTrackKey = trackKey

  const sameCoverReady = !trackChanged && np.coverUrl === lastCoverUrl && (np.coverUrl === null || Boolean(lastCoverData))
  const durationMs = Math.max(0, Math.round((np.duration || 0) * 1000))
  const positionMs = Math.max(0, Math.round((np.position || 0) * 1000))

  // 1. Immediately publish metadata & playback state; clear stale cover if track or cover changed
  void MediaPlayback.setNowPlaying({
    title: np.title,
    artist: np.artist,
    album: np.album ?? '',
    duration: np.duration,
    position: np.position,
    durationMs,
    positionMs,
    playing: np.playing,
    loading: np.loading,
    cover: sameCoverReady ? lastCoverData : undefined,
    coverBase64: sameCoverReady ? lastCoverData : undefined,
    keepCover: sameCoverReady,
  }).catch(() => {})

  // 2. If cover changed or wasn't decoded yet, resolve it asynchronously and push a follow-up update
  if (!np.coverUrl) {
    lastCoverUrl = null
    lastCoverData = undefined
    coverToken++
    return
  }

  if (!sameCoverReady) {
    const wantedUrl = np.coverUrl
    lastCoverUrl = wantedUrl
    lastCoverData = undefined
    const myToken = ++coverToken
    // a cover that won't load (its file gone) falls back to the genre cover instead of the app icon
    const fallback = np.fallbackCover
    void coverBase64(wantedUrl)
      .catch(() => '')
      .then((b64) => b64 || (fallback && fallback !== wantedUrl ? coverBase64(fallback).catch(() => '') : ''))
      .then((b64) => {
        if (!b64 || myToken !== coverToken || !latestNp || latestNp.coverUrl !== wantedUrl) return
        lastCoverData = b64
        const cur = latestNp
        void MediaPlayback.setNowPlaying({
          title: cur.title,
          artist: cur.artist,
          album: cur.album ?? '',
          duration: cur.duration,
          position: cur.position,
          durationMs: Math.max(0, Math.round((cur.duration || 0) * 1000)),
          positionMs: Math.max(0, Math.round((cur.position || 0) * 1000)),
          playing: cur.playing,
          loading: cur.loading,
          cover: b64,
          coverBase64: b64,
          keepCover: false,
        }).catch(() => {})
      })
      .catch(() => {})
  }
}

/** The gallery closed: take its song off the notification / lock screen. */
export function clearNowPlaying() {
  latestNp = null
  lastTrackKey = ''
  lastCoverUrl = undefined
  lastCoverData = undefined
  coverToken++
  if (!isAndroid()) {
    if (navigator.mediaSession) navigator.mediaSession.metadata = null
    return
  }
  void MediaPlayback.clearNowPlaying().catch(() => {})
}

let mediaOn = false
let noteTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Silence this long before the media service stops. A skip, seek or A/B swap is a moment of
 * silence; stopping the service there made the notification drop to paused (or vanish on One UI)
 * and come back with the next song.
 */
const STOP_AFTER_MS = 3000

/** Players call this on every start/stop: playing starts the service at once, silence stops it after STOP_AFTER_MS. */
export function notePlayback() {
  if (!isAndroid()) return
  clearTimeout(noteTimer)
  const on = musicPlaying()
  noteTimer = setTimeout(
    () => {
      const now = musicPlaying()
      if (now === mediaOn) return
      mediaOn = now
      if (now) startMedia()
      else void MediaPlayback.stop().catch(() => {})
    },
    on ? 0 : STOP_AFTER_MS,
  )
}

const ShellHost = registerPlugin<{
  moveToBackground?: () => Promise<void>
  setSystemAppearance?: (o: { darkIcons: boolean; bgColor: string }) => Promise<void>
}>('ShellHost')

/** Android status/navigation bar icons and the window colour behind the page, to match the theme. */
export function setSystemAppearance(darkIcons: boolean, bgColor: string) {
  if (!isAndroid()) return
  // SystemBars first: it remembers its style and re-applies it later, and it resets the window colour, which ours then sets
  void SystemBars.setStyle({ style: darkIcons ? SystemBarsStyle.Light : SystemBarsStyle.Dark })
    .catch(() => {})
    .then(() => ShellHost.setSystemAppearance?.({ darkIcons, bgColor }))
    .catch(() => {})
}

/** Close the app: the window on Windows, the activity on Android. */
export function quitApp() {
  if (isAndroid()) void App.exitApp()
  else window.close()
}

/** Minimize Android activity to background without stopping audio playback. */
export function moveToBackground() {
  if (!isAndroid()) return
  void ShellHost.moveToBackground?.().catch(() => {})
}

/** Open a web page in the system browser. */
export function openExternal(url: string) {
  if (isAndroid()) void Browser.open({ url })
  else window.open(url, '_blank', 'noopener')
}

/**
 * Hand a generated file (EQ preset, share card) to the user: a download on Windows; on
 * Android the share sheet, so it can go straight to Wavelet, Files, Drive or a chat.
 */
export async function saveFile(name: string, blob: Blob) {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-')
  if (!isAndroid()) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = safe
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    return
  }
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  const { uri } = await Filesystem.writeFile({ path: safe, data, directory: Directory.Cache })
  await Share.share({ title: safe, files: [uri] })
}

/**
 * Android glue, called once at start-up: the back button acts like Esc (and leaves the
 * app from the main menu), and links that would open a new window go to the system browser.
 */
export function setUpAndroid() {
  if (!isAndroid()) return
  document.documentElement.classList.add('platform-android')

  void App.addListener('appStateChange', ({ isActive }) => handleAppVisibility(isActive))
  void MediaPlayback.addListener('focusLost', () => window.dispatchEvent(new Event(AUDIO_INTERRUPTED))).catch(() => {})
  void MediaPlayback.addListener('control', sendControl).catch(() => {})
  document.addEventListener('visibilitychange', () => {
    handleAppVisibility(document.visibilityState === 'visible')
  })
  void App.addListener('backButton', () => {
    if (runBack()) return
    if (document.querySelector('.jackbox-main-menu')) {
      void App.exitApp()
      return
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (a && /^https?:/.test(a.href) && a.target === '_blank') {
        e.preventDefault()
        openExternal(a.href)
      }
    },
    true,
  )
}

/**
 * The new UI's player (plan §70 C3) on the same notification, lock screen and headset buttons as the old app: the
 * service runs while it plays and for a while paused, and presses arrive through `listener`. Returns the unsubscribe.
 */
/** Starts the playback service; says so in the log when Android refused it (then minimising stops the music). */
function startMedia() {
  MediaPlayback.start()
    .then((r) => { if (r?.background === false) logLine('WARN', 'Player', 'Android refused background playback just now: music plays while the app is open') })
    .catch(() => {})
}

let pageFocus = false
/** Window event: a streamed song was paused by Android (another app took the sound); the app pauses like a press. */
export const STREAM_INTERRUPTED = 'avsb-stream-interrupted'
/**
 * §88 B: a PC song plays from an audio element, which takes audio focus itself; the playback service must then leave
 * focus alone (Chrome pauses the element when it loses it). Back on a decoded song, the service takes it again.
 */
export async function setStreamFocus(on: boolean) {
  if (!isAndroid() || on === pageFocus) return
  pageFocus = on
  await MediaPlayback.pageFocus?.({ on }).catch(() => {})
  if (!on && mediaOn) startMedia()
}

export function setMediaActive(on: boolean) {
  if (!isAndroid() || on === mediaOn) return
  mediaOn = on
  if (on) startMedia()
  else void MediaPlayback.stop().catch(() => {})
}
export function onMediaControls(listener: (c: MediaControl) => void): () => void {
  if (!isAndroid()) return () => {}
  const off = [
    MediaPlayback.addListener('control', listener),
    // another app took the sound, or the earphones came out: pause like a press would
    MediaPlayback.addListener('focusLost', () => listener({ action: 'pause' })),
  ]
  const interrupted = () => listener({ action: 'pause' })
  window.addEventListener(STREAM_INTERRUPTED, interrupted)
  off.push(Promise.resolve({ remove: async () => window.removeEventListener(STREAM_INTERRUPTED, interrupted) }))
  return () => off.forEach((p) => void p.then((h) => h.remove()))
}

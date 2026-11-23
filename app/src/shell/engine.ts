import { useSyncExternalStore } from 'react'
import { GalleryPlayer, type StreamSong } from '../audio/galleryPlayer'
import { designFir } from '../audio/filter'
import { knownLevel, songLevel, type SongLevel } from '../audio/songLevel'
import { measureLoudness, setSmartVolumeOn, SMART_TARGET_LUFS, songGainDb } from '../audio/smartVolume'
import { DirectDac, directBlocker, setDirectView, type DirectBlocker } from '../audio/directDac'
import { isAndroid, setStreamFocus, STREAM_INTERRUPTED } from '../platform'
import { loadSpatial, onSpatialChange } from '../spatial/settings'
import { onDeviceChange } from '../fit/system'
import { chainDb } from '../eq/biquad'
import { isPcTrack, type Track } from './library'
import { balanceDb, eqFilters, getEq } from './eqState'
import { bandCurves, getChannels } from './sound/channels'
import { albumLevel } from './level'
import { mixEffectFrom, mixSeconds } from './mix'
import { logLine } from './logs'
import { getSetting, subscribeSettings } from './settings/store'
import { airMode } from '../audio/filter'
import { loadRefs, type RefData } from '../audio/reference'
import { loadFit } from '../fit/fit'
import { loadDatabase, type Database } from './database/catalog'
import { soundCurve, type SoundResult } from './sound/soundCurve'
import { getSound } from './sound/soundState'
import { onMobileData, onNetworkChange, phoneLink } from './linkClient'

let adaptiveLowData = false
export const isAdaptiveLowDataActive = () => adaptiveLowData
export const setAdaptiveLowData = (active: boolean) => { adaptiveLowData = active }

function recordPcStreamThroughput(bytes: number, elapsedMs: number, isLowData: boolean) {
  // a song from the phone's cache fills in a moment and says nothing about the network
  if (bytes < 512_000 || elapsedMs < 2000) return
  const mbps = (bytes * 8) / (elapsedMs / 1000) / 1_000_000
  if (!isLowData && mbps < 1.5 && getSetting('auto_lowdata_on_weak') !== false && !adaptiveLowData) {
    adaptiveLowData = true
    logLine('INFO', 'Network', `PC stream throughput low (${mbps.toFixed(1)} Mbps). Enabled Low Data mode for smoother playback.`)
    lowDataListeners.forEach((l) => l())
  } else if (adaptiveLowData && mbps >= 8.0 && getSetting('stream_quality') !== 'Low Data (~128 kbps)') {
    adaptiveLowData = false
    logLine('INFO', 'Network', `PC stream throughput healthy (${mbps.toFixed(1)} Mbps). Resumed full quality streaming.`)
    lowDataListeners.forEach((l) => l())
  }
}

// §93 Batch 6: the automatic Low Data switch. It used to turn on after any one stall (a FLAC start on 4G that caught its
// breath once was enough) or a relayed link, and only a whole-file download could turn it off, which streamed songs
// never are: it stayed on until the app restarted. Now: two stalls within 20 s, 5 s or more into a song; off again
// on Wi-Fi, or when a song arrives fast enough.
const stalls: number[] = []
const STALL_WINDOW_MS = 20_000
function noteStall() {
  if (adaptiveLowData || !loaded || !isPcTrack(loaded) || getSetting('auto_lowdata_on_weak') === false) return
  if (livePosition() < 5) return
  const now = performance.now()
  while (stalls.length && now - stalls[0] > STALL_WINDOW_MS) stalls.shift()
  stalls.push(now)
  if (stalls.length < 2) return
  stalls.length = 0
  adaptiveLowData = true
  logLine('INFO', 'Network', 'The PC stream stalled twice in 20 s: Low Data (auto) is on until the connection is better')
  lowDataListeners.forEach((l) => l())
}
const lowDataListeners = new Set<() => void>()
/** The Now Playing pill follows the automatic switch. */
export const useAdaptiveLowData = () =>
  useSyncExternalStore((l) => { lowDataListeners.add(l); return () => { lowDataListeners.delete(l) } }, () => adaptiveLowData)
onNetworkChange((mobile) => {
  if (mobile || !adaptiveLowData) return
  adaptiveLowData = false
  logLine('INFO', 'Network', 'On Wi-Fi: Low Data (auto) is off from the next song')
  lowDataListeners.forEach((l) => l())
})

/** The song's file on the dev server. Electron serves the same paths once the shell moves there. */
const wantsLowData = () =>
  getSetting('stream_quality') === 'Low Data (~128 kbps)' || Boolean(getSetting('lowdata')) || adaptiveLowData
const bufferKey = (id: string, low = wantsLowData()) => `${id}:${low ? 'low' : 'raw'}`
/** Low data is for songs streamed from the PC; a file on this device always plays as it is. */
const lowDataFor = (t: Track) => isPcTrack(t) && wantsLowData()

export const audioUrl = (t: Track, isLowData = lowDataFor(t)) => {
  const base = `/shell-host/audio?path=${encodeURIComponent(t.path)}`
  return isLowData ? `${base}&lowdata=1` : base
}
/** §105 D: a tournament round takes the 128 kbps copy of a PC song on mobile data too (A and B hear the same file). */
export const roundLowData = (t: Track) => isPcTrack(t) && (wantsLowData() || onMobileData())

/** Where normalization puts songs. Quiet songs only come up as far as their own peak allows, so nothing clips. */
export const NORMALIZE_TARGET_LUFS = -14

/** Skipping faster than this counts as spamming: nothing loads until the skipping pauses. */
const SPAM_WINDOW_MS = 300
const SPAM_WAIT_MS = 150
/** A full-quality PC stream still silent after this switches to Low Data (§105). */
const SLOW_START_MS = 8000

const GRID = Array.from({ length: 256 }, (_, i) => 20 * 1000 ** (i / 255))

let ctx: AudioContext | null = null
let player: GalleryPlayer | null = null
const buffers = new Map<string, Promise<AudioBuffer>>()
const KEEP_DECODED = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) ? 0 : 1
const fetches = new Map<string, AbortController>()

/** Bumped by every song change: anything still loading for an older one sees it and gives up. */
let token = 0
let switching = false
let wantPlaying = true
let pendingSeek: number | null = null
/** Only the start of the song is in the player yet. A seek past it waits for the rest. */
let partialPlaying = false
let seekAfterSwap: number | null = null
/** The song is on the native Direct to DAC player (plan §77), not the web player. */
let direct = false
/** The native player's last report, and when it came (the position runs on from there while playing). */
let directState = { position: 0, duration: 0, playing: false, at: 0 }
/** Songs the native player couldn't open (a PC song mid-stream, a format it can't decode): the web player plays them. */
const directRefused = new Set<string>()
let lastStart = 0
/** What's actually in the player, and what's queued to follow it. These are the truth the screen has to match. */
let loaded: Track | null = null
let queued: Track | null = null
/** Changing the order (shuffle, repeat) makes a next song still being prepared out of date. */
let gaplessEpoch = 0

export interface EngineEvents {
  /** The queued song took over from the one that ended. */
  onAdvance?: (t: Track) => void
  onEnded?: () => void
  /** About to end, with nothing queued: return the song to queue, or null. */
  nextForGapless?: () => Track | null
  onLoading?: (loading: boolean) => void
  onBuffering?: (buffering: boolean) => void
  onError?: (track: Track, error: unknown) => void
}
let events: EngineEvents = {}
export const setEngineEvents = (e: EngineEvents) => { events = e }

let isBufferingState = false
const bufferingListeners = new Set<() => void>()
export const isEngineBuffering = () => isBufferingState
export function setEngineBuffering(b: boolean) {
  if (isBufferingState === b) return
  isBufferingState = b
  events.onBuffering?.(b)
  events.onLoading?.(b)
  // only a stalled PC stream is a network problem: a local song stalls when its full decode is slower than its quick start
  if (b) noteStall()
  bufferingListeners.forEach((l) => l())
}
export const useIsBuffering = () =>
  useSyncExternalStore(
    (l) => {
      bufferingListeners.add(l)
      return () => { bufferingListeners.delete(l) }
    },
    () => isBufferingState,
  )

export const getLoadedBuffer = (id: string): Promise<AudioBuffer> | undefined =>
  buffers.get(bufferKey(id)) ?? buffers.get(`${id}:raw`) ?? buffers.get(`${id}:low`)

/** The song's level for the player, moved so the player's own target lands on ours plus the pre-amp. */
export function levelForTarget(level: SongLevel, preampDb: number): SongLevel {
  return { lufs: level.lufs - (NORMALIZE_TARGET_LUFS + preampDb - SMART_TARGET_LUFS), peak: level.peak }
}

let library: Track[] = []
export const setEngineLibrary = (tracks: Track[]) => { library = tracks }

/** Finds a matching local track counterpart for a PC stream (or vice versa), matching by title and artist. */
export function findMatchingLocalTrack(t: Track): Track | undefined {
  if (!t.title || !t.artist) return undefined
  const titleNorm = t.title.toLowerCase().replace(/\s+/g, ' ').trim()
  const artistNorm = t.artist.toLowerCase().trim()
  return library.find((candidate) => {
    if (candidate.id === t.id) return false
    const candIsPc = candidate.source === 'pc' || candidate.path.startsWith('pc:')
    if (candIsPc) return false
    if (candidate.title.toLowerCase().replace(/\s+/g, ' ').trim() !== titleNorm) return false
    if (candidate.artist.toLowerCase().trim() !== artistNorm) return false
    if (Math.abs((candidate.sec || 0) - (t.sec || 0)) > 3) return false
    return true
  })
}

/** If a song is local, checks if a paired PC has a higher quality version available (e.g. lossless or higher bitrate). */
export function findHigherQualityPcTrack(t: Track): Track | undefined {
  const isPc = t.source === 'pc' || t.path.startsWith('pc:')
  if (isPc) return undefined
  if (!t.title || !t.artist) return undefined
  const titleNorm = t.title.toLowerCase().replace(/\s+/g, ' ').trim()
  const artistNorm = t.artist.toLowerCase().trim()
  const pcCandidate = library.find((candidate) => {
    if (candidate.id === t.id) return false
    const candIsPc = candidate.source === 'pc' || candidate.path.startsWith('pc:')
    if (!candIsPc) return false
    if (candidate.title.toLowerCase().replace(/\s+/g, ' ').trim() !== titleNorm) return false
    if (candidate.artist.toLowerCase().trim() !== artistNorm) return false
    if (Math.abs((candidate.sec || 0) - (t.sec || 0)) > 3) return false
    return true
  })
  if (!pcCandidate) return undefined
  const candQuality = (!pcCandidate.lossy ? 10000 : 0) + (pcCandidate.kbps || 0) + (pcCandidate.bits || 16) * 10
  const localQuality = (!t.lossy ? 10000 : 0) + (t.kbps || 0) + (t.bits || 16) * 10
  if (candQuality > localQuality) {
    return pcCandidate
  }
  return undefined
}

/**
 * Resolves the optimal version of a track based on Data & Network settings:
 * 1. Offline Mode: Restricted strictly to local files or saved offline tracks.
 * 2. Low Data Mode, or Normal on mobile data: Local-First Prioritization (0 MB cellular data used).
 * 3. Normal Mode: Highest quality between PC and phone wins.
 */
export function resolveBestTrack(t: Track): Track | null {
  const isOffline = Boolean(getSetting('offline_mode')) || !navigator.onLine
  const isLowData = getSetting('stream_quality') === 'Low Data (~128 kbps)' || Boolean(getSetting('lowdata'))
  const isPc = t.source === 'pc' || t.path.startsWith('pc:')

  if (isOffline) {
    if (isPc) {
      const local = findMatchingLocalTrack(t)
      if (local) {
        logLine('INFO', 'Player', `Offline Mode: Playing local copy for "${t.title}".`)
        return local
      }
      if (t.offline) return t
      logLine('WARN', 'Player', `Offline Mode: "${t.title}" is not available offline.`)
      return null
    }
    return t
  }

  // §111: on mobile data a lossless stream from the PC rarely has sound within 4.5 s, so the phone's copy plays at once
  // shortcut: a PC song already whole in the song cache also gives way to the phone's copy; check the cache if that matters
  if (isLowData || onMobileData()) {
    // Local-First Prioritization: Always prefer phone's local track over PC stream to save data
    if (isPc) {
      const local = findMatchingLocalTrack(t)
      if (local) {
        logLine('INFO', 'Player', `${isLowData ? 'Low Data Mode' : 'Mobile data'}: Playing local copy for "${t.title}" (0 MB data used).`)
        return local
      }
    }
    return t
  }

  // Normal Mode: Highest quality wins
  if (!isPc) {
    const betterPc = findHigherQualityPcTrack(t)
    if (betterPc) {
      logLine('INFO', 'Player', `Normal Mode: Preferring higher-quality PC stream (${betterPc.format || 'Lossless'}) for "${t.title}".`)
      return betterPc
    }
    return t
  } else {
    const local = findMatchingLocalTrack(t)
    if (local) {
      const localScore = (!local.lossy ? 10000 : 0) + (local.kbps || 0) + (local.bits || 16) * 10
      const pcScore = (!t.lossy ? 10000 : 0) + (t.kbps || 0) + (t.bits || 16) * 10
      if (localScore >= pcScore) {
        logLine('INFO', 'Player', `Normal Mode: Local copy matches or exceeds PC quality for "${t.title}".`)
        return local
      }
    }
    return t
  }
}

const measuredFile = (t: Track) => ({ file: { name: t.path, size: t.size } })

/**
 * §88 B: a PC song plays from an audio element as it arrives. Seeking asks the phone for that byte range, which comes
 * from the song cache (§88 C) or from the PC.
 */
function streamSong(t: Track): StreamSong {
  const el = new Audio()
  el.preload = 'auto'
  // the phone's server is another origin: without CORS the EQ chain would only get silence from it
  el.crossOrigin = 'anonymous'
  const low = lowDataFor(t)
  el.src = pcAudioBase ? `${pcAudioBase}/${low ? 'low' : 'raw'}/${t.path.slice(3)}` : audioUrl(t)
  // §90 E: a stream that ends well before the song's length was cut short (the PC's encoder stopped): its cached copy
  // goes, so the next play fetches it whole
  el.addEventListener('ended', () => {
    if (!(t.sec > 0) || !(el.duration > 0) || t.sec - el.duration <= 3) return
    logLine('WARN', 'Player', `"${t.title}" ended at ${el.duration.toFixed(0)} s of ${t.sec.toFixed(0)} s: dropped its saved copy`)
    void phoneLink?.dropCachedSong?.({ id: t.path.slice(3), lowData: low }).catch(() => {})
  })
  return { el, sec: t.sec }
}
/** The phone's own HTTP server for PC songs; the WebView's request hook couldn't serve an audio element's ranges. */
let pcAudioBase = ''
void phoneLink?.audioBase?.().then((r) => { pcAudioBase = r.base }).catch(() => {})

/** A typical modern master, for a streamed song whose level was never measured (its samples never reach the page). */
// shortcut: unmeasured PC songs play as if at -9 LUFS; measure them on the PC and send the level with the library if levels jump
const ASSUMED_LEVEL: SongLevel = { lufs: -9, peak: 1 }
const streamLevel = (t: Track) =>
  levelForTarget(albumOrOwn(t, knownLevel(measuredFile(t)) ?? ASSUMED_LEVEL), Number(getSetting('normpreamp') ?? 0))

/** Throughput of a stream, from how fast its element buffers, for the automatic Low Data switch. */
function watchThroughput(t: Track, el: HTMLAudioElement, low: boolean) {
  const from = performance.now()
  const onProgress = () => {
    const end = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0
    if (!t.sec || end < t.sec - 1) return
    el.removeEventListener('progress', onProgress)
    const bytes = low ? (128_000 / 8) * t.sec : t.size
    recordPcStreamThroughput(bytes, performance.now() - from, low)
  }
  el.addEventListener('progress', onProgress)
}


/**
 * §88 D: 30 s into a song, the next one (picked once, Shell's whatsNext) goes into the phone's song cache: on Wi-Fi
 * always, on mobile data only with Low Data.
 */
function fetchAheadLater(mine: number) {
  window.setTimeout(() => {
    if (mine !== token) return
    const next = events.nextForGapless?.()
    const r = next ? resolveBestTrack(next) : null
    if (!r || !isPcTrack(r) || (onMobileData() && !wantsLowData())) return
    logLine('INFO', 'Player', `Fetching the next song ahead: ${r.title}`)
    void phoneLink?.prebuffer?.({ id: r.id, lowData: wantsLowData() })
  }, 30_000)
}

/** Album gain: every song in the album moves together, from those measured so far. Falls back to the song itself. */
function albumOrOwn(t: Track, own: SongLevel): SongLevel {
  if (getSetting('gainmode') !== 'Album' || !t.album) return own
  const album = library.filter((x) => x.album === t.album && x.albumArtist === t.albumArtist && x.id !== t.id)
  return albumLevel([own, ...album.map((x) => knownLevel(measuredFile(x)))]) ?? own
}

const levelOf = async (t: Track, buffer: AudioBuffer) =>
  levelForTarget(albumOrOwn(t, await songLevel(measuredFile(t), buffer)), Number(getSetting('normpreamp') ?? 0))

const chosenMix = () => Number(getSetting('mixsecs') ?? 0) || undefined

function getPlayer(): GalleryPlayer {
  if (player && ctx && ctx.state !== 'closed') return player
  if (ctx?.state === 'closed') {
    logLine('WARN', 'Player', 'AudioContext closed unexpectedly; recreating audio player')
    player = null
    ctx = null
    lastEq = ''
  }
  const nextCtx = new AudioContext({ latencyHint: 'playback' })
  ctx = nextCtx
  const p = new GalleryPlayer(nextCtx)
  player = p
  nextCtx.addEventListener('statechange', () => {
    if (nextCtx.state !== 'closed' || ctx !== nextCtx) return
    logLine('WARN', 'Player', 'AudioContext closed by audio device or renderer')
    setEngineBuffering(false)
    player = null
    ctx = null
    lastEq = ''
  })
  p.onStalled = (stalled) => setEngineBuffering(stalled)
  p.onInterrupted = () => window.dispatchEvent(new Event(STREAM_INTERRUPTED))
  p.onEnded = () => {
    setEngineBuffering(false)
    events.onEnded?.()
  }
  p.onAdvance = () => {
    const t = queued
    queued = null
    loaded = t
    if (t) void setStreamFocus(isPcTrack(t))
    if (t) events.onAdvance?.(t)
  }
  p.onNearEnd = () => {
    const mixing = Boolean(getSetting('automix'))
    if (!mixing && !getSetting('gapless')) return
    const found = events.nextForGapless?.()
    const next = found ? resolveBestTrack(found) : null
    if (!next) return
    const mine = token
    const epoch = gaplessEpoch
    if (isPcTrack(next)) {
      if (!player?.playing) return
      const song = streamSong(next)
      queued = next
      player.queueNext(song, streamLevel(next), mixing ? mixSeconds(player.duration, next.sec, chosenMix()) : 0, mixEffectFrom(getSetting))
      return
    }
    void load(next).full
      .then(async (buffer) => {
        const level = await levelOf(next, buffer)
        // skipped since this began: it would play the wrong song after the current one
        if (mine !== token || epoch !== gaplessEpoch || !player?.playing) return
        queued = next
        player.queueNext(buffer, level, mixing ? mixSeconds(player.duration, buffer.duration, chosenMix()) : 0, mixEffectFrom(getSetting))
      })
      .catch((e: unknown) => { if (mine === token) logLine('WARN', 'Player', `Couldn't prepare the next song: ${String(e)}`) })
  }
  applyEq()
  applyVolume()
  logLine('INFO', 'Player', `Audio started at ${ctx.sampleRate} Hz`)
  watchGlitches(nextCtx)
  return p
}

/**
 * §107 C: audio glitches (blocks the audio thread didn't finish in time), from Chrome's playbackStats (shipped
 * under that name, not the draft's playoutStats) where the WebView has it: logged once a minute when new ones happened.
 */
function watchGlitches(c: AudioContext) {
  const stats = () => (c as AudioContext & { playbackStats?: { underrunEvents: number; underrunDuration: number } }).playbackStats
  if (!stats()) return
  let last = stats()!.underrunEvents
  let lastS = stats()!.underrunDuration
  const id = window.setInterval(() => {
    if (c.state === 'closed') return window.clearInterval(id)
    const s = stats()!
    const fresh = s.underrunEvents - last
    // underrunDuration is in seconds
    if (fresh > 0) logLine('WARN', 'Player', `${fresh} audio glitches in the last minute (spatial ${loadSpatial().mode}, ${Math.round((s.underrunDuration - lastS) * 1000)} ms dropped)`)
    last = s.underrunEvents
    lastS = s.underrunDuration
  }, 60_000)
}

/** How much of a song to decode for a quick start. Well over the time the rest takes to arrive. */
const QUICK_START_SECONDS = 12

interface Loading {
  /** The start of the song, when one was asked for and the file is long enough to be worth it. */
  quick: Promise<AudioBuffer> | null
  full: Promise<AudioBuffer>
}

const loads = new Map<string, Loading>()

function joined(chunks: Uint8Array[], length: number) {
  const all = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.length
  }
  return all
}

/** Reads a song in pieces. The start can be decoded and playing long before the whole file has been. */
function load(t: Track, wantQuick = false): Loading {
  const low = lowDataFor(t)
  const key = bufferKey(t.id, low)
  const found = loads.get(key)
  if (found) return found
  const known = buffers.get(key)
  if (known) {
    // Bump recency in LRU cache
    buffers.delete(key)
    buffers.set(key, known)
    return { quick: null, full: known }
  }

  getPlayer()
  const context = ctx as AudioContext
  const control = new AbortController()
  fetches.set(t.id, control)
  const rawQuick = t.sec > 0 ? Math.max(1_500_000, (t.size * QUICK_START_SECONDS) / t.sec) : Infinity
  const quickBytes = Math.min(3_500_000, rawQuick)
  // Only split into quick + full decode on huge lossless files (> 20 MB); smaller tracks & Low Data Opus
  // stream fast over LAN HTTP / direct QUIC in one pass without mid-song buffer swaps.
  const worthIt = wantQuick && !low && !t.lossy && t.size > 20_000_000 && quickBytes < t.size * 0.5

  let giveQuick: (b: Promise<AudioBuffer>) => void = () => {}
  const quick = worthIt ? new Promise<AudioBuffer>((resolve) => { giveQuick = resolve }) : null

  const full = (async () => {
    const isPc = t.source === 'pc' || t.path.startsWith('pc:')
    const localFallback = isPc ? findMatchingLocalTrack(t) : undefined
    const transferStartedAt = performance.now()
    let response: Response
    let useFallback = false
    try {
      const fetchPromise = fetch(audioUrl(t), { signal: control.signal })
      if (localFallback) {
        response = await Promise.race([
          fetchPromise,
          new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('PC stream timeout')), 4500)),
        ])
      } else {
        response = await fetchPromise
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    } catch (err) {
      if (localFallback) {
        logLine('WARN', 'Player', `PC stream failed or slow (${String(err)}). Seamlessly switching to local counterpart for "${t.title}".`)
        useFallback = true
        response = await fetch(audioUrl(localFallback), { signal: control.signal })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      } else {
        throw err
      }
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    let started = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        length += value.length
        if (worthIt && !started && length >= quickBytes) {
          started = true
          giveQuick(context.decodeAudioData(joined(chunks, length).buffer))
        }
      }
    } catch (streamErr) {
      chunks.length = 0
      if (!useFallback && localFallback) {
        logLine('WARN', 'Player', `PC stream dropped mid-transfer (${String(streamErr)}). Switching to local fallback.`)
        const fbRes = await fetch(audioUrl(localFallback), { signal: control.signal })
        if (!fbRes.ok) throw new Error(`Fallback HTTP ${fbRes.status}`)
        const fbBuf = await fbRes.arrayBuffer()
        const decoded = await context.decodeAudioData(fbBuf)
        if (worthIt && !started) giveQuick(Promise.resolve(decoded))
        return decoded
      }
      throw streamErr
    }

    fetches.delete(t.id)
    if (isPc && !useFallback) {
      recordPcStreamThroughput(length, performance.now() - transferStartedAt, low)
    }
    const assembled = joined(chunks, length)
    chunks.length = 0
    const decoded = context.decodeAudioData(assembled.buffer)
    // a file smaller than expected never reached the mark: the whole song is the quick start
    if (worthIt && !started) giveQuick(decoded)
    return decoded
  })()

  const loading: Loading = { quick, full }
  loads.set(key, loading)
  buffers.set(key, full)
  full.catch(() => { if (buffers.get(key) === full) buffers.delete(key) })
  full.catch((e: unknown) => { if (quick) giveQuick(Promise.reject(e instanceof Error ? e : new Error(String(e)))) })
  void full.catch(() => {}).finally(() => { if (loads.get(key) === loading) loads.delete(key) })
  // Whole decoded PCM AudioBuffers are tens of MB each: keep only the active/most recent entry in this cache
  // (GalleryPlayer holds active cur & queued next directly).
  // Android keeps none beyond what the player holds (review item 15): the WebView's memory is the tight one
  while (buffers.size > KEEP_DECODED) buffers.delete(buffers.keys().next().value as string)
  return loading
}

const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))

/** The level before the whole song is known: remembered from before, or estimated from its start. */
function startLevel(t: Track, start: AudioBuffer) {
  const own = knownLevel(measuredFile(t)) ?? measureLoudness(channelsOf(start), start.sampleRate)
  return levelForTarget(albumOrOwn(t, own), Number(getSetting('normpreamp') ?? 0))
}

/** Loads and plays a song. A newer call cancels this one, however far it got. `exact` plays `t` itself, not its best copy. */
export async function playTrack(t: Track, autostart = true, startAt = 0, exact = false) {
  const resolved = exact ? t : resolveBestTrack(t)
  if (!resolved) {
    logLine('WARN', 'Player', `Cannot play "${t.title}": Offline mode active and track is not downloaded.`)
    events.onLoading?.(false)
    return
  }
  t = resolved
  const mine = ++token
  if (direct) {
    direct = false
    setDirectView({ info: null })
    void DirectDac.stop().catch(() => {})
  }
  const p = getPlayer()
  wantPlaying = autostart
  pendingSeek = startAt > 0 ? startAt : null
  seekAfterSwap = null
  queued = null
  setEngineBuffering(false)
  switching = true
  p.switching = true
  p.fadeStop()
  events.onLoading?.(true)

  const now = performance.now()
  const spamming = now - lastStart < SPAM_WINDOW_MS
  lastStart = now
  if (spamming) {
    await new Promise((resolve) => window.setTimeout(resolve, SPAM_WAIT_MS))
    if (mine !== token) return
  }
  // only the song we now want is worth downloading
  for (const [id, control] of fetches) {
    if (id !== t.id) {
      control.abort()
      fetches.delete(id)
    }
  }

  if (await tryDirect(t, autostart, startAt, mine)) {
    if (mine !== token) return
    switching = false
    p.switching = false
    pendingSeek = null
    events.onLoading?.(false)
    return
  }
  if (mine !== token) return

  const finishSwitch = () => {
    switching = false
    p.switching = false
    events.onLoading?.(false)
  }
  // §86 H: how long a song takes from the tap to sound goes in the log, so slow starts can be measured, not guessed
  const askedAt = performance.now()
  const took = () => `${Math.round(performance.now() - askedAt)} ms`

  // a streamed song's element holds audio focus itself; a decoded one needs the playback service to hold it
  await setStreamFocus(isPcTrack(t))
  if (mine !== token) return
  if (isPcTrack(t)) {
    const song = streamSong(t)
    watchThroughput(t, song.el, lowDataFor(t))
    p.setBuffer(song, streamLevel(t))
    loaded = t
    partialPlaying = false
    if (pendingSeek !== null) p.seek(pendingSeek)
    pendingSeek = null
    if (wantPlaying) p.play()
    const local = findMatchingLocalTrack(t)
    const ready = await new Promise<boolean | 'low'>((resolve) => {
      song.el.addEventListener('canplay', () => resolve(true), { once: true })
      song.el.addEventListener('error', () => resolve(false), { once: true })
      // a copy on this phone takes over when the PC is slow to answer
      if (local) window.setTimeout(() => resolve(song.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA), 4500)
      // §105: without one, a full-quality stream with no sound yet after a while comes again as Low Data
      else if (!lowDataFor(t) && getSetting('auto_lowdata_on_weak') !== false)
        window.setTimeout(() => resolve(song.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || 'low'), SLOW_START_MS)
    })
    if (mine !== token) return
    if (ready === 'low') {
      adaptiveLowData = true
      logLine('INFO', 'Network', `"${t.title}" had no sound after ${took()}: Low Data (auto) is on until the connection is better`)
      lowDataListeners.forEach((l) => l())
      switching = false
      p.switching = false
      void playTrack(t, wantPlaying, livePosition())
      return
    }
    if (ready) {
      finishSwitch()
      logLine('INFO', 'Player', `Streaming ${t.path} (sound after ${took()})`)
      fetchAheadLater(mine)
      return
    }
    logLine('WARN', 'Player', `Couldn't stream ${t.path} (${song.el.error?.message || `code ${song.el.error?.code ?? '?'}`})${local ? '; playing the copy on this phone' : ''}`)
    if (local) {
      switching = false
      p.switching = false
      // §109: exact, or Normal Mode picks the PC copy again and this loops every 4.5 s with no sound
      void playTrack(local, wantPlaying, livePosition(), true)
      return
    }
    p.fadeStop()
    finishSwitch()
    events.onError?.(t, song.el.error ?? new Error('stream failed'))
    return
  }

  try {
    const { quick, full } = load(t, true)
    if (quick) {
      let start: AudioBuffer | null = null
      try {
        start = await quick
      } catch {
        // Partial decode can fail for M4A (moov at end), FLAC frames, or WAV RIFF sizes.
        // Fall back gracefully to full buffer decode without firing onError toast.
        start = null
      }
      if (start && mine === token) {
        p.setBuffer(start, startLevel(t, start), true)
        loaded = t
        partialPlaying = true
        if (pendingSeek !== null && pendingSeek < start.duration - 1) {
          p.seek(pendingSeek)
          pendingSeek = null
        }
        seekAfterSwap = pendingSeek
        pendingSeek = null
        if (wantPlaying) p.play()
        finishSwitch()
        logLine('INFO', 'Player', `Playing ${t.path} (first part after ${took()})`)
        fetchAheadLater(mine)
        const buffer = await full
        if (mine !== token) return
        logLine('INFO', 'Player', `Whole song ready after ${took()}`)
        const level = await levelOf(t, buffer)
        if (mine !== token) return
        p.swapBuffer(buffer, level)
        partialPlaying = false
        if (seekAfterSwap !== null) p.seek(seekAfterSwap)
        seekAfterSwap = null
        return
      }
    }
    const buffer = await full
    if (mine !== token) return
    const level = await levelOf(t, buffer)
    if (mine !== token) return
    p.setBuffer(buffer, level)
    loaded = t
    partialPlaying = false
    if (pendingSeek !== null) p.seek(pendingSeek)
    pendingSeek = null
    if (wantPlaying) p.play()
    finishSwitch()
    logLine('INFO', 'Player', `Playing ${t.path} (after ${took()})`)
    fetchAheadLater(mine)
  } catch (e) {
    if (mine === token) {
      logLine('ERROR', 'Player', `Couldn't play ${t.path}: ${String(e)}`)
      if (partialPlaying) p.fadeStop()
      partialPlaying = false
      finishSwitch()
      events.onError?.(t, e)
    }
  }
}

/** What keeps this song off Direct to DAC (plan §77); null = nothing changes the sound. */
function chainFor(t: Track): DirectBlocker | null {
  const sound = getSound()
  return directBlocker({
    setting: getSetting('directdac') !== false,
    eqOn: getEq().on,
    earCurves: bandCurves(getChannels()) !== null,
    soundOn: sound.aim.kind !== 'off' && !sound.bypass,
    spatialMode: loadSpatial().mode,
    automix: Boolean(getSetting('automix')),
    normalize: Boolean(getSetting('normalize')),
    levelKnown: knownLevel(measuredFile(t)) !== null,
  })
}

/** The native track's gain: the volume slider and the song's levelling, the same as the web player's Off path. */
function directGain(t: Track): number {
  const own = knownLevel(measuredFile(t))
  if (!own) return volume
  const level = levelForTarget(albumOrOwn(t, own), Number(getSetting('normpreamp') ?? 0))
  return volume * 10 ** (songGainDb(level) / 20)
}

/** Plays the song on the native player when a USB DAC is in and nothing changes the sound. False: the web player plays it. */
async function tryDirect(t: Track, autostart: boolean, startAt: number, mine: number): Promise<boolean> {
  // Low data streams a 128 kbps transcode: nothing to send to a DAC at its own rate
  if (!isAndroid() || directRefused.has(t.path) || lowDataFor(t)) return false
  const support = await DirectDac.support().catch(() => null)
  if (mine !== token) return true
  const blocker = chainFor(t)
  lastBlocker = blocker
  setDirectView({ dac: Boolean(support?.available), blocker })
  if (!support?.available || blocker) return false
  listenDirect()
  try {
    const { balanceDb: chDb, swap } = getChannels()
    const info = await DirectDac.play({ path: t.path, startAt, gain: directGain(t), autostart, balanceDb: chDb, swap })
    if (mine !== token) return true
    direct = true
    loaded = t
    queued = null
    partialPlaying = false
    seekAfterSwap = null
    directState = { position: startAt, duration: info.duration, playing: autostart, at: performance.now() }
    setDirectView({ info })
    logLine('INFO', 'Player', `Direct to DAC: ${t.path} (${info.rate} Hz ${info.bits || '?'}-bit, DAC at ${info.dacRate || 'converted'} Hz)`)
    return true
  } catch (e) {
    if (mine !== token) return true
    if (String(e).includes('unavailable')) directRefused.add(t.path)
    logLine('INFO', 'Player', `Direct to DAC not used for ${t.path}: ${String(e)}`)
    return false
  }
}

let directListening = false
function listenDirect() {
  if (directListening) return
  directListening = true
  void DirectDac.addListener('state', (s) => { if (direct) directState = { ...s, at: performance.now() } })
  void DirectDac.addListener('nearEnd', () => {
    if (!direct || !getSetting('gapless')) return
    const next = events.nextForGapless?.()
    const r = next ? resolveBestTrack(next) : null
    if (!r || directRefused.has(r.path) || lowDataFor(r) || chainFor(r)) return
    const epoch = gaplessEpoch
    void DirectDac.queueNext({ path: r.path, gain: directGain(r) }).then(
      () => { if (epoch === gaplessEpoch && direct) queued = r; else void DirectDac.clearNext() },
      () => directRefused.add(r.path),
    )
  })
  void DirectDac.addListener('advance', (info) => {
    if (!direct || !queued || info.path !== queued.path) return
    loaded = queued
    queued = null
    directState = { position: 0, duration: info.duration, playing: directState.playing, at: performance.now() }
    setDirectView({ info })
    events.onAdvance?.(loaded)
  })
  void DirectDac.addListener('ended', () => {
    if (!direct) return
    directState = { ...directState, playing: false }
    events.onEnded?.()
  })
  // the DAC came out: carry on from here on the web player, paused (Android pauses on unplugging too)
  void DirectDac.addListener('unplugged', ({ position }) => {
    if (!direct || !loaded) return
    direct = false
    setDirectView({ info: null, dac: false })
    void playTrack(loaded, false, position)
  })
  void DirectDac.addListener('error', ({ message }) => {
    if (!direct || !loaded) return
    const at = livePosition()
    logLine('WARN', 'Player', `Direct to DAC stopped (${message}); back to the normal player`)
    directRefused.add(loaded.path)
    direct = false
    setDirectView({ info: null })
    void playTrack(loaded, wantPlaying, at)
  })
}

let handOverTimer = 0
let lastBlocker: DirectBlocker | null | undefined
/**
 * An effect turned on or off, or a DAC came or went: move the song to the other player at the same spot. Waits a
 * moment so flicking a switch doesn't restart it each time. A song that only waited for its level stays put.
 */
function reconsiderDirect(deviceChanged = false) {
  if (!isAndroid()) return
  window.clearTimeout(handOverTimer)
  handOverTimer = window.setTimeout(() => {
    const t = loaded
    if (!t || switching) return
    const blocker = chainFor(t)
    const was = lastBlocker
    lastBlocker = blocker
    setDirectView({ blocker })
    if (direct && blocker) {
      void playTrack(t, wantPlaying, livePosition())
      return
    }
    if (direct || blocker || directRefused.has(t.path)) return
    if (!deviceChanged && (was === blocker || was === 'Measuring' || was === undefined)) return
    void DirectDac.support().then((s) => {
      setDirectView({ dac: s.available })
      if (s.available && loaded === t && !direct && !switching) void playTrack(t, wantPlaying, livePosition())
    }, () => {})
  }, 600)
}

const directPosition = () => {
  const s = directState
  const run = s.playing ? (performance.now() - s.at) / 1000 : 0
  return Math.min(s.position + run, s.duration || Infinity)
}

export function setPaused(paused: boolean) {
  wantPlaying = !paused
  // back from a pause (maybe from the notification, with the app away): wake the PC link before the stream needs it
  if (!paused && loaded && isPcTrack(loaded)) void phoneLink?.ping?.().catch(() => {})
  if (direct) {
    directState = { ...directState, position: directPosition(), playing: !paused, at: performance.now() }
    void (paused ? DirectDac.pause() : DirectDac.resume()).catch(() => {})
    return
  }
  // while a song loads the player still holds the old one: playing now would bring it back
  if (!player || switching) return
  if (paused) player.pause()
  else {
    player.play()
    logResume()
  }
}

/** §93 Batch 6: "Resumed (sound after X ms)": the time until the position starts moving again. */
function logResume() {
  const t0 = performance.now()
  const from = livePosition()
  const song = loaded
  const check = () => {
    if (!wantPlaying || loaded !== song) return
    if (livePosition() > from + 0.05) logLine('INFO', 'Player', `Resumed (sound after ${Math.round(performance.now() - t0)} ms)`)
    else if (performance.now() - t0 < 20_000) window.setTimeout(check, 50)
  }
  window.setTimeout(check, 50)
}

export function seekTo(seconds: number) {
  if (direct && !switching) {
    directState = { ...directState, position: seconds, at: performance.now() }
    void DirectDac.seek({ seconds }).catch(() => {})
  } else if (switching) pendingSeek = seconds
  else if (partialPlaying && player && seconds >= player.duration - 1) seekAfterSwap = seconds
  else {
    seekAfterSwap = null
    player?.seek(seconds)
  }
}

/** Sleep timer: fades the music out over `seconds` and pauses; true once quiet. Direct to DAC can't fade: it just stops. */
export const fadeOutForSleep = (seconds: number): Promise<boolean> => (direct || !player ? Promise.resolve(true) : player.fadeOutAndPause(seconds))
export const livePosition = () => (switching ? pendingSeek ?? 0 : direct ? directPosition() : seekAfterSwap ?? player?.position ?? 0)

// The position the screen shows. It used to live in the Shell context and re-render the whole app every 500 ms while
// music played; now only components that draw a time or a seek bar subscribe (useLivePosition). One timer, running
// only while something is subscribed; a paused song doesn't notify (same value).
const positionListeners = new Set<() => void>()
let shownPosition = 0
let positionTimer = 0
/** Set the shown position right away (a seek, a new song). */
export function showPosition(seconds: number) {
  if (seconds === shownPosition) return
  shownPosition = seconds
  positionListeners.forEach((l) => l())
}
function subscribePosition(l: () => void) {
  positionListeners.add(l)
  // nothing is drawn while the page is hidden (screen off, minimised): skip those ticks (plan §76 J)
  if (!positionTimer) positionTimer = window.setInterval(() => { if (!document.hidden) showPosition(livePosition()) }, 500)
  return () => {
    positionListeners.delete(l)
    if (!positionListeners.size) {
      window.clearInterval(positionTimer)
      positionTimer = 0
    }
  }
}
export const useLivePosition = () => useSyncExternalStore(subscribePosition, () => shownPosition)
/** Calls back when the shown position changes, outside React (paused lyrics repaint on a seek). Returns the unsubscribe. */
export const onPositionShown = subscribePosition
export const isLive = () => !switching && (direct ? directState.playing : Boolean(player?.playing))
/** The output analyser (after volume), for visuals that follow the music; null before the first song. */
export const engineAnalyser = () => player?.analyser ?? null
/** Direct USB output plays outside Web Audio, so the analyser hears nothing (§95: the seek wave keeps its usual height). */
export const isDirectOutput = () => direct
/** The output sample rate (48 kHz until the first song opens the audio device). */
export const engineSampleRate = () => ctx?.sampleRate ?? 48000

export function clearQueuedNext() {
  queued = null
  gaplessEpoch++
  player?.clearNext()
  if (direct) void DirectDac.clearNext().catch(() => {})
}

let volume = 1

function applyVolume() {
  // the EQ's preamp only, which runs through the limiter. Normalization's pre-amp moves its target instead, so it can't clip.
  const preamp = getEq().on ? 10 ** (getEq().preamp / 20) : 1
  player?.setVolume(Math.min(4, volume * preamp))
  if (direct && loaded) void DirectDac.setGain({ gain: directGain(loaded) }).catch(() => {})
}

export function setEngineVolume(v: number) {
  volume = v
  applyVolume()
}

let lastEq = ''
let lastChannels = ''

// Sound (§68) needs the Database and the averaged measurements; they load the first time a Sound aim is set
let soundDb: Database | null = null
let soundRefs: RefData | null = null
let soundLoading = false
function soundEnvReady(): boolean {
  if (soundDb && soundRefs) return true
  if (!soundLoading) {
    soundLoading = true
    void Promise.all([loadDatabase(), loadRefs()]).then(([db, refs]) => {
      soundDb = db
      soundRefs = refs
      applyEq()
    }, (e: unknown) => logLine('ERROR', 'Sound', `Couldn't load the measurements: ${String(e)}`)).finally(() => (soundLoading = false))
  }
  return false
}

/** The Sound correction now playing (null: none, bypassed, or still loading); the EQ page draws from it. */
export function currentSound(): SoundResult | null {
  const sound = getSound()
  if (sound.aim.kind === 'off' || !soundDb || !soundRefs) return null
  return soundCurve({ catalog: soundDb.catalog, refs: soundRefs, fit: loadFit(), airMode: airMode() }, sound)
}

function applyEq() {
  const p = player
  if (!p || !ctx) return
  const eq = getEq()
  const filters = eq.on ? eqFilters(eq) : []
  const sound = getSound()
  const soundOn = sound.aim.kind !== 'off' && !sound.bypass && soundEnvReady()
  const linear = sound.phase === 'linear'
  const key = JSON.stringify([filters, soundOn ? sound : null, linear, sound.bypass])
  // the device's channel correction (§78 E) applies with the EQ on or off; the EQ's own balance adds to it
  const ch = getChannels()
  p.setSwap(ch.swap)
  p.setEarCurves(bandCurves(ch))
  p.setBalance((eq.on ? balanceDb(eq.balance) : 0) + ch.balanceDb)
  const chKey = `${ch.swap}/${ch.balanceDb}`
  if (direct && chKey !== lastChannels) void DirectDac.setChannels({ balanceDb: ch.balanceDb, swap: ch.swap }).catch(() => {})
  lastChannels = chKey
  p.setDynamics({
    headroom: !eq.on || eq.headroom,
    limiter: !eq.on || eq.limiter,
    // the preamp can raise the level with no EQ curve in play
    limitAlways: eq.on,
    compressor: eq.on && eq.compressor ? { threshold: eq.threshold, ratio: eq.ratio, attack: eq.attack, release: eq.release } : null,
  })
  if (key === lastEq) return
  lastEq = key
  // linear phase delays every path the same, so switching (including the bypass) stays seamless
  p.setLinearPhase(linear ? 4096 : null)
  const sim = soundOn ? currentSound() : null
  if (!filters.length && !sim?.curve) {
    p.setFlat()
    return
  }
  // with a Sound aim, your EQ is added on the measurements' own grid, so the two add up exactly
  const grid = sim?.curve ? soundDb!.catalog.data.grid : GRID
  const curve = chainDb(filters, grid, ctx.sampleRate)
  if (sim?.curve) for (let i = 0; i < curve.length; i++) curve[i] += sim.curve[i]
  p.setFir(designFir(grid, curve, ctx.sampleRate, 4096, linear ? 'linear' : 'minimum'), grid, curve, { linear, space: sim?.space === 'open' })
}

let eqTimer = 0

/** Follows the settings that change the sound. Designing the filter takes a moment, so dragging is throttled. */
export function startEngineSettings() {
  setSmartVolumeOn(Boolean(getSetting('normalize')))
  subscribeSettings(() => {
    setSmartVolumeOn(Boolean(getSetting('normalize')))
    applyVolume()
    window.clearTimeout(eqTimer)
    eqTimer = window.setTimeout(applyEq, 60)
    reconsiderDirect()
  })
  onSpatialChange(() => reconsiderDirect())
  onDeviceChange(() => reconsiderDirect(true))
}

/** For checks in the browser during development. */
/** §107 G: the app's player for the HRTF test, made if nothing has played since the app started. */
export const appPlayer = () => getPlayer()

/** Length of the HRTF test's clip, from a third of the way into the song (past most intros). */
const HRTF_CLIP_S = 40

/**
 * §107 G: a clip of one of your songs for the HRTF test, local files first, then the PC's; a different song for
 * each `attempt` while there are enough. Null when the library is empty (the test plays pink noise then).
 */
export async function hrtfTestClip(attempt: number): Promise<{ buffer: AudioBuffer; title: string } | null> {
  const local = library.filter((t) => !isPcTrack(t) && t.sec > HRTF_CLIP_S)
  const pool = local.length ? local : library.filter((t) => t.sec > HRTF_CLIP_S)
  if (!pool.length) return null
  // a fresh random order per test (attempt 0), then walk it
  if (attempt === 0 || clipOrder.length !== pool.length) clipOrder = pool.map((_, i) => i).sort(() => Math.random() - 0.5)
  const t = pool[clipOrder[attempt % pool.length]]
  const full = await load(t).full
  const from = Math.floor(full.length / 3)
  const length = Math.min(full.length - from, Math.round(HRTF_CLIP_S * full.sampleRate))
  const clip = new AudioBuffer({ length, numberOfChannels: full.numberOfChannels, sampleRate: full.sampleRate })
  for (let c = 0; c < full.numberOfChannels; c++) clip.copyToChannel(full.getChannelData(c).subarray(from, from + length), c)
  return { buffer: clip, title: `${t.title}${t.artist ? ` · ${t.artist}` : ''}` }
}
let clipOrder: number[] = []

export const engineForTests = () =>({ player, ctx, loaded, queued, switching })

import { useSyncExternalStore } from 'react'
import { GalleryPlayer } from '../audio/galleryPlayer'
import { designFir } from '../audio/filter'
import { knownLevel, songLevel, type SongLevel } from '../audio/songLevel'
import { measureLoudness, setSmartVolumeOn, SMART_TARGET_LUFS, songGainDb } from '../audio/smartVolume'
import { DirectDac, directBlocker, setDirectView, type DirectBlocker } from '../audio/directDac'
import { isAndroid } from '../platform'
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
import { phoneLink } from './linkClient'

let adaptiveLowData = false
export const isAdaptiveLowDataActive = () => adaptiveLowData
export const setAdaptiveLowData = (active: boolean) => { adaptiveLowData = active }

function recordPcStreamThroughput(bytes: number, elapsedMs: number, isLowData: boolean) {
  if (bytes < 512_000 || elapsedMs <= 0) return
  const mbps = (bytes * 8) / (elapsedMs / 1000) / 1_000_000
  if (!isLowData && mbps < 1.5 && getSetting('auto_lowdata_on_weak') !== false && !adaptiveLowData) {
    adaptiveLowData = true
    logLine('INFO', 'Network', `PC stream throughput low (${mbps.toFixed(1)} Mbps). Enabled Low Data mode for smoother playback.`)
  } else if (adaptiveLowData && mbps >= 8.0 && getSetting('stream_quality') !== 'Low Data (~128 kbps)') {
    adaptiveLowData = false
    logLine('INFO', 'Network', `PC stream throughput healthy (${mbps.toFixed(1)} Mbps). Resumed full quality streaming.`)
  }
}

if (typeof window !== 'undefined' && phoneLink) {
  // On Android, check real PC link connection state cleanly without pinging local WebView assets.
  window.setInterval(() => {
    void phoneLink?.status().then((st) => {
      if (st.connected && st.path === 'relayed' && getSetting('auto_lowdata_on_weak') !== false && !adaptiveLowData) {
        adaptiveLowData = true
        logLine('INFO', 'Network', 'PC Link is relayed. Enabled fast Low Data streaming.')
      }
      // switching back is the throughput check's call alone (recordPcStreamThroughput): a direct path can still be
      // slow, and two owners flipped low data on and off every minute (review item 8)
    }).catch(() => {})
  }, 60000)
}

/** The song's file on the dev server. Electron serves the same paths once the shell moves there. */
const wantsLowData = () =>
  getSetting('stream_quality') === 'Low Data (~128 kbps)' || Boolean(getSetting('lowdata')) || adaptiveLowData
const bufferKey = (id: string, low = wantsLowData()) => `${id}:${low ? 'low' : 'raw'}`
/** Low data is for songs streamed from the PC; a file on this device always plays as it is. */
const lowDataFor = (t: Track) => isPcTrack(t) && wantsLowData()

export const audioUrl = (t: Track) => {
  const isLowData = lowDataFor(t)
  const base = `/shell-host/audio?path=${encodeURIComponent(t.path)}`
  return isLowData ? `${base}&lowdata=1` : base
}

/** Where normalization puts songs. Quiet songs only come up as far as their own peak allows, so nothing clips. */
export const NORMALIZE_TARGET_LUFS = -14

/** Skipping faster than this counts as spamming: nothing loads until the skipping pauses. */
const SPAM_WINDOW_MS = 300
const SPAM_WAIT_MS = 150

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
  if (b && !adaptiveLowData && loaded && isPcTrack(loaded) && getSetting('auto_lowdata_on_weak') !== false) {
    adaptiveLowData = true
    logLine('INFO', 'Player', 'Playback stalled on network stream. Automatically enabled fast low-data mode.')
  }
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
 * 2. Low Data Mode: Strict Local-First Prioritization (0 MB cellular data used).
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

  if (isLowData) {
    // Local-First Prioritization: Always prefer phone's local track over PC stream to save data
    if (isPc) {
      const local = findMatchingLocalTrack(t)
      if (local) {
        logLine('INFO', 'Player', `Low Data Mode: Playing local copy for "${t.title}" (0 MB data used).`)
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
  p.onEnded = () => {
    setEngineBuffering(false)
    events.onEnded?.()
  }
  p.onAdvance = () => {
    const t = queued
    queued = null
    loaded = t
    if (t) events.onAdvance?.(t)
  }
  p.onNearEnd = () => {
    const mixing = Boolean(getSetting('automix'))
    if (!mixing && !getSetting('gapless')) return
    const next = events.nextForGapless?.()
    if (!next) return
    // the phone keeps up to 32 MB of a PC song in RAM; prebuffering a bigger one downloaded it only to drop it (item 7)
    if (next.path.startsWith('pc:') && (wantsLowData() || next.size <= 32 * 1024 * 1024)) {
      void phoneLink?.prebuffer?.({ id: next.id, lowData: wantsLowData() })
    }
    const mine = token
    const epoch = gaplessEpoch
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
  return p
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

/** Loads and plays a song. A newer call cancels this one, however far it got. */
export async function playTrack(t: Track, autostart = true, startAt = 0) {
  const resolved = resolveBestTrack(t)
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
        logLine('INFO', 'Player', `Playing ${t.path}`)
        const buffer = await full
        if (mine !== token) return
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
    logLine('INFO', 'Player', `Playing ${t.path}`)
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
  if (direct) {
    directState = { ...directState, position: directPosition(), playing: !paused, at: performance.now() }
    void (paused ? DirectDac.pause() : DirectDac.resume()).catch(() => {})
    return
  }
  // while a song loads the player still holds the old one: playing now would bring it back
  if (!player || switching) return
  if (paused) player.pause()
  else player.play()
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
export const engineForTests = () => ({ player, ctx, loaded, queued, switching })

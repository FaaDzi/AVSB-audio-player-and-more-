import { measureLoudness } from './smartVolume'

/**
 * A song's Smart volume measurement (BS.1770 LUFS + sample peak) without stalling the screen.
 * Bundled songs carry it in the song list (scripts/song_loudness.ts). Your own songs are measured
 * once, in a worker, and remembered by file name and size. Measuring a 4-minute song on the main
 * thread took ~150 ms on a PC and several times that on a phone: the gallery froze on every song.
 */
export type SongLevel = { lufs: number; peak: number }

const CACHE_KEY = 'song-levels-v1'
/** Songs remembered; past this the oldest are forgotten. */
const CACHE_MAX = 3000

let cache: Record<string, SongLevel> | null = null
function store(): Record<string, SongLevel> {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, SongLevel>
  } catch {
    cache = {}
  }
  return cache
}
function remember(key: string, level: SongLevel) {
  const c = store()
  c[key] = level
  const keys = Object.keys(c)
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete c[k]
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* full or blocked: measured again next time */
  }
}

const keyOf = (file: { name: string; size: number }) => `${file.name}|${file.size}`

/** The level when it's known without measuring (bundled, or measured before). */
export function knownLevel(song: { level?: SongLevel; file?: { name: string; size: number } }): SongLevel | null {
  if (song.level) return song.level
  return song.file ? (store()[keyOf(song.file)] ?? null) : null
}

let worker: Worker | null = null
let workerFailed = false
let nextJob = 0
const jobs = new Map<number, (l: SongLevel | null) => void>()

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('./songLevel.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; level: SongLevel | null }>) => {
      jobs.get(e.data.id)?.(e.data.level)
      jobs.delete(e.data.id)
    }
    worker.onerror = () => {
      workerFailed = true
      worker = null
      for (const done of jobs.values()) done(null)
      jobs.clear()
    }
  } catch {
    workerFailed = true
  }
  return worker
}

/** Measure `buffer` off the main thread (on it, if workers aren't available). */
function measure(buffer: AudioBuffer): Promise<SongLevel> {
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  const w = getWorker()
  if (!w) return Promise.resolve(measureLoudness(chans, buffer.sampleRate))
  const id = ++nextJob
  // copies: the buffer keeps playing from its own data
  const copies = chans.map((c) => c.slice())
  return new Promise((resolve) => {
    jobs.set(id, (l) => resolve(l ?? measureLoudness(chans, buffer.sampleRate)))
    w.postMessage({ id, channels: copies, sampleRate: buffer.sampleRate }, copies.map((c) => c.buffer))
  })
}

/** The song's level: known, or measured once from its decoded audio and remembered. */
export async function songLevel(song: { level?: SongLevel; file?: { name: string; size: number } }, buffer: AudioBuffer): Promise<SongLevel> {
  const known = knownLevel(song)
  if (known) return known
  const level = await measure(buffer)
  if (song.file) remember(keyOf(song.file), level)
  return level
}

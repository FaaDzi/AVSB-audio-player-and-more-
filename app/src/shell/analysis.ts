import { Capacitor } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { songLevel } from '../audio/songLevel'
import type { SongFeatures } from './analysisCore'
import type { Track } from './library'
import { logLine } from './logs'
import { getSetting, subscribeSettings } from './settings/store'

const DB = 'shell-analysis'
const STORE = 'features'
/** Breathing room between songs, so the app stays quick while this runs. */
const REST_MS = 3000
/** A decoded song is about ten times its file. Cap strictly so scanning doesn't pressure RAM. */
const TOO_BIG_BYTES = 80e6

const known = new Map<string, SongFeatures>()
const failed = new Set<string>()
const listeners = new Set<() => void>()
let library: Track[] = []
let audioUrl: (t: Track) => string = () => ''
let version = 0
let running = false

const changed = () => {
  version++
  listeners.forEach((l) => l())
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => fail(open.error)
    open.onsuccess = () => done(open.result)
  })
}

async function write(run: (store: IDBObjectStore) => IDBRequest) {
  const db = await openDb()
  await new Promise<void>((done, fail) => {
    const tx = db.transaction(STORE, 'readwrite')
    run(tx.objectStore(STORE))
    tx.oncomplete = () => done()
    tx.onerror = () => fail(tx.error)
  })
  db.close()
}

async function readAll() {
  const db = await openDb()
  await new Promise<void>((done, fail) => {
    const cursor = db.transaction(STORE).objectStore(STORE).openCursor()
    cursor.onerror = () => fail(cursor.error)
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return done()
      known.set(String(row.key), row.value as SongFeatures)
      row.continue()
    }
  })
  db.close()
}

export const featuresOf = (id: string) => known.get(id)
export const analysedCount = () => library.filter((t) => known.has(t.id)).length
export const libraryCount = () => library.length

/** Re-renders the caller as songs get analyzed. */
export const useAnalysisProgress = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => version)

let sharedWorker: Worker | null = null
let sharedDecodeCtx: OfflineAudioContext | null = null

function getAnalysisWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  }
  return sharedWorker
}

function getDecodeContext(): OfflineAudioContext {
  if (!sharedDecodeCtx) {
    sharedDecodeCtx = new OfflineAudioContext(2, 1, 44100)
  }
  return sharedDecodeCtx
}

function features(samples: Float32Array, sampleRate: number): Promise<SongFeatures> {
  const worker = getAnalysisWorker()
  return new Promise<SongFeatures>((done, fail) => {
    const onMsg = (e: MessageEvent<SongFeatures>) => {
      cleanup()
      done(e.data)
    }
    const onErr = (e: ErrorEvent) => {
      cleanup()
      // Reset broken worker so next call recreates cleanly
      sharedWorker?.terminate()
      sharedWorker = null
      fail(new Error(e.message))
    }
    const cleanup = () => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    worker.postMessage({ samples, sampleRate }, [samples.buffer])
  })
}

async function analyseOne(t: Track) {
  const response = await fetch(audioUrl(t))
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const buffer = await getDecodeContext().decodeAudioData(bytes)
  // Album gain mode uses this too
  await songLevel({ file: { name: t.path, size: t.size } }, buffer)
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  // a plain loop: Float32Array.from with a callback is millions of calls, long enough to drop taps on a phone
  const samples = new Float32Array(left.length)
  for (let i = 0; i < left.length; i++) samples[i] = (left[i] + right[i]) / 2
  const found = await features(samples, buffer.sampleRate)
  await write((s) => s.put(found, t.id))
  known.set(t.id, found)
  changed()
}

const wanted = () => Boolean(getSetting('analysis')) && Capacitor.getPlatform() !== 'android'

/** A song only starts once nobody has touched the screen or keys for this long, so it never competes with a tap. */
const IDLE_MS = 4000
let lastInput = 0
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(type, () => { lastInput = Date.now() }, { passive: true, capture: true })
}
async function untilIdle() {
  for (let wait = IDLE_MS - (Date.now() - lastInput); wait > 0; wait = IDLE_MS - (Date.now() - lastInput)) {
    await new Promise((resolve) => window.setTimeout(resolve, wait))
  }
}

async function run() {
  if (running) return
  running = true
  try {
    for (;;) {
      if (!wanted()) return
      const t = library.find((x) => !known.has(x.id) && !failed.has(x.id) && (!x.path.startsWith('pc:') || x.downloaded))
      if (!t) return
      await untilIdle()
      try {
        if (t.size > TOO_BIG_BYTES) throw new Error('file too big to analyze')
        await analyseOne(t)
      } catch (e) {
        failed.add(t.id)
        logLine('WARN', 'Analysis', `Skipped ${t.path}: ${String(e)}`)
      }
      await new Promise((resolve) => window.setTimeout(resolve, REST_MS))
    }
  } finally {
    running = false
    sharedWorker?.terminate()
    sharedWorker = null
  }
}

export async function clearAnalysis() {
  await write((s) => s.clear())
  known.clear()
  failed.clear()
  changed()
  void run()
}

/** Loads what's been analyzed before, then keeps going in the background while the setting is on. */
export function startAnalysis(tracks: Track[], urlOf: (t: Track) => string) {
  library = tracks
  audioUrl = urlOf
  readAll()
    .catch((e: unknown) => logLine('WARN', 'Analysis', `Couldn't read saved analysis: ${String(e)}`))
    .finally(() => {
      changed()
      void run()
      subscribeSettings(() => { if (wanted()) void run() })
    })
}

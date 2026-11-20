import { firPeak } from './headroom'

/**
 * §95 D: the linear-phase EQ's headroom check (firPeak) froze the page for about half a second on each new song.
 * It runs in a worker now; on the main thread only where workers aren't available.
 */
let worker: Worker | null = null
let workerFailed = false
let nextJob = 0
const jobs = new Map<number, (peak: number | null) => void>()

function getWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('./headroom.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; peak: number | null }>) => {
      jobs.get(e.data.id)?.(e.data.peak)
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

/** firPeak off the main thread. The windows are copied: the player keeps its own for the next EQ change. */
export function firPeakAsync(windows: Float32Array[][], taps: Float32Array): Promise<number> {
  const w = getWorker()
  if (!w || !windows.length) return Promise.resolve(firPeak(windows, taps))
  const id = ++nextJob
  return new Promise((resolve) => {
    jobs.set(id, (peak) => resolve(peak ?? firPeak(windows, taps)))
    w.postMessage({ id, windows, taps })
  })
}

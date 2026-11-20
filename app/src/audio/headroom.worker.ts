import { firPeak } from './headroom'

/** headroomAsync.ts's worker: an EQ FIR's peak on a song's loud windows (about 600 FFTs), off the main thread. */
self.onmessage = (e: MessageEvent<{ id: number; windows: Float32Array[][]; taps: Float32Array }>) => {
  const { id, windows, taps } = e.data
  let peak: number | null = null
  try {
    peak = firPeak(windows, taps)
  } catch {
    /* the page measures it itself */
  }
  self.postMessage({ id, peak })
}

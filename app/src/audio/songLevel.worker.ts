import { measureLoudness } from './smartVolume'

/** songLevel.ts's worker: one song's BS.1770 loudness and peak, measured off the main thread. */
self.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number }>) => {
  const { id, channels, sampleRate } = e.data
  let level: { lufs: number; peak: number } | null = null
  try {
    level = measureLoudness(channels, sampleRate)
  } catch {
    /* the page measures it itself */
  }
  self.postMessage({ id, level })
}

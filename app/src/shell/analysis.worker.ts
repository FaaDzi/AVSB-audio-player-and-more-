import { analyseSamples } from './analysisCore'

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  self.postMessage(analyseSamples(e.data.samples, e.data.sampleRate))
}

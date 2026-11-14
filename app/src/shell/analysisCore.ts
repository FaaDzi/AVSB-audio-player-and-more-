export interface SongFeatures {
  /** Beats per minute, 60 to 180. */
  tempo: number
  /** How much of the energy is in the fast detail, 0 to 1. */
  brightness: number
  /** Average level in dB. */
  energy: number
}

const RATE = 11025
const HOP = 512

/** Tempo, brightness and energy from one channel. Small and rough on purpose: enough to say what sounds alike. */
export function analyseSamples(samples: Float32Array, sampleRate: number): SongFeatures {
  const step = Math.max(1, Math.round(sampleRate / RATE))
  const rate = sampleRate / step
  const count = Math.floor(samples.length / step)
  const mono = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += samples[i * step + j]
    mono[i] = sum / step
  }

  let total = 0
  let detail = 0
  for (let i = 1; i < count; i++) {
    total += mono[i] * mono[i]
    const d = mono[i] - mono[i - 1]
    detail += d * d
  }
  const energy = 10 * Math.log10(Math.max(1e-10, total / Math.max(1, count)))
  // white noise gives 2 here, so this lands between 0 and 1
  const brightness = total > 0 ? Math.min(1, detail / total / 2) : 0

  // how much the level rises from one short frame to the next
  const frames = Math.floor(count / HOP)
  const onset = new Float32Array(frames)
  let previous = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = 0; i < HOP; i++) sum += mono[f * HOP + i] * mono[f * HOP + i]
    const level = Math.sqrt(sum / HOP)
    onset[f] = Math.max(0, level - previous)
    previous = level
  }

  // the repeat that lines the rises up best, from 180 down to 60 beats a minute
  const framesPerSecond = rate / HOP
  const shortest = Math.max(1, Math.floor((framesPerSecond * 60) / 180))
  const longest = Math.ceil((framesPerSecond * 60) / 60)
  let best = shortest
  let bestScore = -1
  for (let lag = shortest; lag <= longest && lag < frames; lag++) {
    let score = 0
    for (let f = lag; f < frames; f++) score += onset[f] * onset[f - lag]
    score /= frames - lag
    if (score > bestScore * 1.02) {
      bestScore = score
      best = lag
    }
  }
  return { tempo: (framesPerSecond * 60) / best, brightness, energy }
}

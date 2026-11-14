import { fft } from '../audio/fft'
import type { Category } from './library'

export const CLIP_SECONDS = 40
const HOP_S = 0.5
const FFT_SIZE = 4096
const EDGE_S = 5 // ignore the very start/end of a song

type Feature = (bandEnergy: (lo: number, hi: number) => number, flux: number, total: number) => number

/** What makes a section a good demo for each category. Sums over the window are maximised. */
const FEATURES: Record<Category | 'any', Feature> = {
  bass: (e) => e(20, 120),
  vocals: (e) => e(250, 4000),
  treble: (e) => e(4000, 16000),
  acoustic: (_e, _f, total) => total,
  stage: (_e, _f, total) => total,
  busy: (_e, flux, total) => flux * Math.sqrt(total),
  any: (_e, _f, total) => total,
}

/** A window counts as a good alternative if it scores at least this share of the best one. */
const GOOD_ENOUGH = 0.75
const MAX_CANDIDATES = 4

/**
 * Pick the CLIP_SECONDS window that best demonstrates `category`, using per-frame
 * spectral features. Returns [start, end] in seconds.
 */
export function autoClip(channels: Float32Array[], sampleRate: number, category: Category | 'any'): [number, number] {
  return clipCandidates(channels, sampleRate, category)[0]
}

/**
 * Up to MAX_CANDIDATES non-overlapping CLIP_SECONDS windows that demonstrate `category`
 * nearly as well as the best one (best first), so a song can play a different part each
 * time while still testing the same thing (its bass, its vocals, its treble...).
 */
export function clipCandidates(channels: Float32Array[], sampleRate: number, category: Category | 'any'): [number, number][] {
  const duration = channels[0].length / sampleRate
  if (duration <= CLIP_SECONDS + 2 * EDGE_S) return [[0, Math.min(duration, CLIP_SECONDS)]]

  const hop = Math.round(HOP_S * sampleRate)
  const half = FFT_SIZE / 2
  const binHz = sampleRate / FFT_SIZE
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  let prev = new Float64Array(half)
  const scores: number[] = []

  for (let start = 0; start + FFT_SIZE <= channels[0].length; start += hop) {
    for (let i = 0; i < FFT_SIZE; i++) {
      let s = 0
      for (const ch of channels) s += ch[start + i]
      re[i] = (s / channels.length) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE))
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(half)
    let total = 0
    let flux = 0
    for (let k = 1; k < half; k++) {
      mag[k] = re[k] * re[k] + im[k] * im[k]
      total += mag[k]
      const d = Math.sqrt(mag[k]) - Math.sqrt(prev[k])
      if (d > 0) flux += d
    }
    prev = mag
    const band = (lo: number, hi: number) => {
      let s = 0
      for (let k = Math.max(1, Math.floor(lo / binHz)); k < Math.min(half, Math.ceil(hi / binHz)); k++) s += mag[k]
      return s
    }
    scores.push(FEATURES[category](band, flux, total))
  }

  // sliding sum of the scores over each window start
  const win = Math.round(CLIP_SECONDS / HOP_S)
  const first = Math.round(EDGE_S / HOP_S)
  const last = scores.length - win - first
  const sums: { at: number; sum: number }[] = []
  let sum = 0
  for (let i = first; i < first + win; i++) sum += scores[i]
  sums.push({ at: first, sum })
  for (let i = first + 1; i <= last; i++) {
    sum += scores[i + win - 1] - scores[i - 1]
    sums.push({ at: i, sum })
  }
  sums.sort((a, b) => b.sum - a.sum)
  const best = sums[0]
  const picked: number[] = []
  for (const w of sums) {
    if (picked.length >= MAX_CANDIDATES || w.sum < best.sum * GOOD_ENOUGH) break
    if (picked.every((p) => Math.abs(p - w.at) >= win)) picked.push(w.at)
  }
  return picked.map((at) => {
    const startS = Math.floor(at * HOP_S)
    return [startS, startS + CLIP_SECONDS]
  })
}

/** Copy [start, end] seconds of a buffer into a new AudioBuffer with short fades. */
export function sliceBuffer(ctx: BaseAudioContext, buf: AudioBuffer, start: number, end: number): AudioBuffer {
  const s = Math.max(0, Math.floor(start * buf.sampleRate))
  const e = Math.min(buf.length, Math.floor(end * buf.sampleRate))
  const out = ctx.createBuffer(buf.numberOfChannels, e - s, buf.sampleRate)
  const fade = Math.min(Math.floor(0.05 * buf.sampleRate), Math.floor((e - s) / 4))
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch).slice(s, e)
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      d[i] *= g
      d[d.length - 1 - i] *= g
    }
    out.copyToChannel(d, ch)
  }
  return out
}

import { fft } from '../audio/fft'
import type { Category } from './library'

/**
 * Lightweight song analysis for guessing a song's speciality (bass / vocals / treble /
 * acoustic / stage / busy). Everything here is a ratio or a spread in dB, so it doesn't
 * depend on how loud the file is. Cost: ~1k FFTs per song, well under a second.
 */
export interface SongFeatures {
  /** Share of energy 20–60 Hz (sub-bass rumble). */
  sub: number
  /** Share of energy 20–150 Hz. */
  bass: number
  /** Share of energy 150–500 Hz (warmth / body). */
  lowMid: number
  /** Share of centre-channel energy 500 Hz–4 kHz (where a lead vocal sits, panned centre). */
  vocal: number
  /** Share of energy 5–16 kHz. */
  treble: number
  /** 90th percentile of the 5–9 kHz share (sibilance / cymbal splash moments). */
  sibilance: number
  /** Side energy / total, 150 Hz–8 kHz (0 = mono, 0.5 = fully uncorrelated). */
  width: number
  /** Spectral flatness 150 Hz–8 kHz (0 = tonal, 1 = noise-like / dense). */
  flatness: number
  /** Loud-to-quiet spread across the song (dB, 95th − 10th percentile). */
  dynamics: number
  /** Peak-to-RMS ratio (dB); squashed modern masters are low, live acoustic recordings high. */
  crest: number
  /** Onsets per second (how often new hits/notes start). */
  onsets: number
  /** How many of 24 log bands are within 20 dB of the loudest (0–1, fullness of the mix). */
  density: number
}

export const FEATURE_KEYS: (keyof SongFeatures)[] = [
  'sub', 'bass', 'lowMid', 'vocal', 'treble', 'sibilance', 'width', 'flatness', 'dynamics', 'crest', 'onsets', 'density',
]

const SPEC_FFT = 4096
const SPEC_HOP_S = 0.25
const ONSET_FFT = 1024
const ONSET_SECONDS = 60
const LOG_BANDS = 24

const hann = (n: number) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}

/** Measure a song. `channels` is 1 or 2 channels of PCM at `sampleRate`. */
export function analyzeSong(channels: Float32Array[], sampleRate: number): SongFeatures {
  const L = channels[0]
  const R = channels[1] ?? channels[0]
  const n = L.length
  const binHz = sampleRate / SPEC_FFT
  const half = SPEC_FFT / 2
  const bin = (f: number) => Math.min(half - 1, Math.max(1, Math.round(f / binHz)))
  const win = hann(SPEC_FFT)
  const mRe = new Float64Array(SPEC_FFT), mIm = new Float64Array(SPEC_FFT)
  const sRe = new Float64Array(SPEC_FFT), sIm = new Float64Array(SPEC_FFT)

  // log bands 40 Hz–16 kHz for density
  const edges = Array.from({ length: LOG_BANDS + 1 }, (_, i) => bin(40 * (16000 / 40) ** (i / LOG_BANDS)))

  const acc = { sub: 0, bass: 0, lowMid: 0, vocal: 0, treble: 0, width: 0, side: 0, flat: 0, density: 0 }
  const sib: number[] = []
  const loud: number[] = []
  let frames = 0
  const hop = Math.round(SPEC_HOP_S * sampleRate)
  for (let start = 0; start + SPEC_FFT <= n; start += hop) {
    for (let i = 0; i < SPEC_FFT; i++) {
      const l = L[start + i], r = R[start + i]
      mRe[i] = 0.5 * (l + r) * win[i]
      sRe[i] = 0.5 * (l - r) * win[i]
      mIm[i] = 0
      sIm[i] = 0
    }
    fft(mRe, mIm)
    fft(sRe, sIm)
    const pm = new Float64Array(half), ps = new Float64Array(half)
    let total = 0
    for (let k = 1; k < half; k++) {
      pm[k] = mRe[k] * mRe[k] + mIm[k] * mIm[k]
      ps[k] = sRe[k] * sRe[k] + sIm[k] * sIm[k]
      total += pm[k] + ps[k]
    }
    const db = 10 * Math.log10(total / SPEC_FFT + 1e-20)
    loud.push(db)
    if (db < -70) continue // silence: don't let it skew the shares
    const band = (lo: number, hi: number, p: Float64Array[] = [pm, ps]) => {
      let s = 0
      for (let k = bin(lo); k < bin(hi); k++) for (const x of p) s += x[k]
      return s
    }
    acc.sub += band(20, 60) / total
    acc.bass += band(20, 150) / total
    acc.lowMid += band(150, 500) / total
    acc.vocal += band(500, 4000, [pm]) / total
    acc.treble += band(5000, 16000) / total
    sib.push(band(5000, 9000) / total)
    const mid8 = band(150, 8000, [pm]), side8 = band(150, 8000, [ps])
    acc.width += side8 / (mid8 + side8 + 1e-20)
    // flatness: geometric / arithmetic mean of power, 150 Hz–8 kHz
    let logSum = 0, linSum = 0, cnt = 0
    for (let k = bin(150); k < bin(8000); k++) {
      const p = pm[k] + ps[k] + 1e-20
      logSum += Math.log(p)
      linSum += p
      cnt++
    }
    acc.flat += Math.exp(logSum / cnt) / (linSum / cnt)
    // density: log bands within 20 dB of the loudest band
    const bands: number[] = []
    for (let b = 0; b < LOG_BANDS; b++) {
      let s = 0
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) s += pm[k] + ps[k]
      bands.push(10 * Math.log10(s / Math.max(1, edges[b + 1] - edges[b]) + 1e-20))
    }
    const top = Math.max(...bands)
    acc.density += bands.filter((b) => b > top - 20).length / LOG_BANDS
    frames++
  }
  const f = Math.max(1, frames)

  // crest factor over the whole song (mono)
  let peak = 0, sq = 0
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (L[i] + R[i])
    const a = Math.abs(m)
    if (a > peak) peak = a
    sq += m * m
  }
  const rms = Math.sqrt(sq / Math.max(1, n))

  return {
    sub: acc.sub / f,
    bass: acc.bass / f,
    lowMid: acc.lowMid / f,
    vocal: acc.vocal / f,
    treble: acc.treble / f,
    sibilance: percentile(sib, 0.9),
    width: acc.width / f,
    flatness: acc.flat / f,
    dynamics: percentile(loud.filter((x) => x > -70), 0.95) - percentile(loud.filter((x) => x > -70), 0.1),
    crest: 20 * Math.log10((peak + 1e-12) / (rms + 1e-12)),
    onsets: onsetRate(L, R, sampleRate),
    density: acc.density / f,
  }
}

/** Onsets per second over the middle minute: peaks in spectral flux above a moving threshold. */
function onsetRate(L: Float32Array, R: Float32Array, sampleRate: number): number {
  const len = Math.min(L.length, Math.round(ONSET_SECONDS * sampleRate))
  const from = Math.max(0, Math.floor((L.length - len) / 2))
  const hop = ONSET_FFT / 2
  const half = ONSET_FFT / 2
  const win = hann(ONSET_FFT)
  const re = new Float64Array(ONSET_FFT), im = new Float64Array(ONSET_FFT)
  let prev: Float64Array | null = null
  const flux: number[] = []
  for (let start = from; start + ONSET_FFT <= from + len; start += hop) {
    for (let i = 0; i < ONSET_FFT; i++) {
      re[i] = 0.5 * (L[start + i] + R[start + i]) * win[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(half)
    let d = 0
    for (let k = 1; k < half; k++) {
      mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]))
      if (prev) d += Math.max(0, mag[k] - prev[k])
    }
    prev = mag
    flux.push(d)
  }
  // peak picking: local max above mean + 0.5·std of a ±0.5 s window, at least 50 ms apart
  const w = Math.round((0.5 * sampleRate) / hop)
  const minGap = Math.max(1, Math.round((0.05 * sampleRate) / hop))
  let count = 0, last = -minGap
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue
    const seg = flux.slice(Math.max(0, i - w), i + w + 1)
    const mean = seg.reduce((a, b) => a + b, 0) / seg.length
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mean) ** 2, 0) / seg.length)
    if (flux[i] > mean + 0.5 * sd && i - last >= minGap) {
      count++
      last = i
    }
  }
  return count / (len / sampleRate)
}

// ---- classifier: nearest centroid on standardised features, fitted to hand-labelled songs ----
// (k-nearest-neighbours was tried too; it let the big categories outvote the small ones)
// Inputs are the sound measurements plus, when known, the web tag-group scores (songs/tags.ts).
// A missing input (NaN, e.g. no tags offline) is simply left out of the comparison.

export interface SpecialityModel {
  /** Names of the inputs: sound features, then tag groups ("tag:vocal", …). */
  keys: string[]
  mean: number[]
  std: number[]
  /** Per-input weights (0 = unused). */
  weight: number[]
  /** The average standardised hand-labelled song of each speciality. */
  centroids: { c: Category; x: number[] }[]
}

/** One song's inputs in model order; `tags` is a tag-group vector or null when unknown. */
export function inputs(f: SongFeatures, tags: number[] | null, tagCount: number): number[] {
  return [...FEATURE_KEYS.map((k) => f[k]), ...(tags ?? new Array<number>(tagCount).fill(NaN))]
}

const finite = (xs: number[]) => xs.filter((v) => Number.isFinite(v))
const z = (m: Pick<SpecialityModel, 'mean' | 'std'>, x: number[]) => x.map((v, i) => (v - m.mean[i]) / (m.std[i] || 1))

/**
 * Guess a speciality: how close the song sits to each speciality's average song.
 * Returns categories ranked by score (a softmax of the distances, sums to 1).
 */
export function classify(m: SpecialityModel, x: number[]): { category: Category; score: number }[] {
  const v = z(m, x)
  const used = v.map((t, i) => (Number.isFinite(t) ? m.weight[i] : 0))
  const n = Math.max(1, used.filter(Boolean).length)
  const d2 = m.centroids.map((c) => c.x.reduce((s, cx, i) => (used[i] && Number.isFinite(cx) ? s + used[i] * (cx - v[i]) ** 2 : s), 0))
  const e = d2.map((d) => Math.exp(-d / n)) // distance per input, so the spread doesn't depend on how many are used
  const total = e.reduce((a, b) => a + b, 0)
  return m.centroids.map((c, i) => ({ category: c.c, score: e[i] / total })).sort((a, b) => b.score - a.score)
}

/** Fit standardisation and one centroid per speciality (missing inputs are skipped). */
export function fitModel(rows: { x: number[]; c: Category }[], keys: string[], weight?: number[]): SpecialityModel {
  const col = (i: number) => finite(rows.map((r) => r.x[i]))
  const mean = keys.map((_, i) => {
    const c = col(i)
    return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0
  })
  const std = keys.map((_, i) => {
    const c = col(i)
    return c.length ? Math.sqrt(c.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / c.length) : 1
  })
  const zs = rows.map((r) => ({ c: r.c, x: z({ mean, std }, r.x) }))
  const cats = [...new Set(rows.map((r) => r.c))]
  const centroids = cats.map((c) => {
    const mine = zs.filter((r) => r.c === c)
    return {
      c,
      x: keys.map((_, i) => {
        const v = finite(mine.map((r) => r.x[i]))
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
      }),
    }
  })
  return { keys, mean, std, weight: weight ?? keys.map(() => 1), centroids }
}

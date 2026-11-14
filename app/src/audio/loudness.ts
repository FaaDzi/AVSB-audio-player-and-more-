import { fft } from './fft'
import { interpLog } from './filter'

export interface Spectrum {
  sampleRate: number
  /** Bin centre frequencies (Hz). */
  freqs: Float64Array
  /** Average power per bin (linear). */
  power: Float64Array
}

/**
 * Long-term average power spectrum of a buffer (mono sum, Hann-windowed Welch).
 * `maxFrames` spreads at most that many frames evenly over the buffer (a whole song in ~50 ms).
 */
export function longTermSpectrum(channels: Float32Array[], sampleRate: number, fftSize = 4096, maxFrames = Infinity): Spectrum {
  const len = channels[0].length
  const half = fftSize / 2
  const hop = Math.max(half, Math.floor((len - fftSize) / maxFrames))
  const power = new Float64Array(half + 1)
  const win = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize)

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  let frames = 0
  for (let start = 0; start + fftSize <= len; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      let s = 0
      for (const ch of channels) s += ch[start + i]
      re[i] = (s / channels.length) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k <= half; k++) power[k] += re[k] * re[k] + im[k] * im[k]
    frames++
  }
  if (frames) for (let k = 0; k <= half; k++) power[k] /= frames

  const freqs = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) freqs[k] = (k * sampleRate) / fftSize
  return { sampleRate, freqs, power }
}

/** ITU-R BS.1770 K-weighting magnitude² (48 kHz coefficients, evaluated by frequency). */
export function kWeightPower(f: number): number {
  const fs = 48000
  const stages = [
    // high-shelf pre-filter
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] },
    // RLB high-pass
    { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] },
  ]
  const w = (2 * Math.PI * Math.min(f, fs / 2)) / fs
  let p = 1
  for (const { b, a } of stages) {
    const num = complexPoly(b, w)
    const den = complexPoly(a, w)
    p *= (num[0] ** 2 + num[1] ** 2) / (den[0] ** 2 + den[1] ** 2)
  }
  return p
}

function complexPoly(c: number[], w: number): [number, number] {
  let r = 0
  let i = 0
  for (let k = 0; k < c.length; k++) {
    r += c[k] * Math.cos(w * k)
    i -= c[k] * Math.sin(w * k)
  }
  return [r, i]
}

/**
 * Relative K-weighted loudness (dB) of `spectrum` after applying a filter curve
 * (dB on `grid`) plus a flat gain. Only differences between calls are meaningful.
 */
export function filteredLoudnessDb(
  spectrum: Spectrum,
  grid: ArrayLike<number>,
  curveDb: ArrayLike<number>,
  gainDb = 0,
): number {
  const h = interpLog(grid, curveDb, spectrum.freqs)
  let sum = 0
  for (let k = 1; k < spectrum.freqs.length; k++) {
    const f = spectrum.freqs[k]
    if (f < 20) continue
    sum += spectrum.power[k] * 10 ** ((h[k] + gainDb) / 10) * kWeightPower(f)
  }
  return 10 * Math.log10(sum + 1e-30)
}

/** Pink noise (equal power per octave) on a log grid, a stand-in for an average music spectrum. */
const PINK: Spectrum = (() => {
  const n = 240
  const freqs = new Float64Array(n)
  for (let k = 0; k < n; k++) freqs[k] = 20 * 1000 ** (k / (n - 1))
  return { sampleRate: 48000, freqs, power: new Float64Array(n).fill(1) }
})()

/**
 * Gain (dB) that makes an EQ curve play as loud as no EQ (K-weighted), the way Wavelet keeps
 * presets level instead of pulling the peak to 0 dB. Pass the song's own spectrum when it's
 * known: pink noise has far less bass than real music, so with it bright curves came out
 * 2-4 dB quieter than no EQ and bassy ones 2-3 dB louder.
 */
export function loudnessMatchDb(grid: ArrayLike<number>, curveDb: ArrayLike<number>, spectrum: Spectrum = PINK): number {
  return filteredLoudnessDb(spectrum, grid, new Float64Array(grid.length)) - filteredLoudnessDb(spectrum, grid, curveDb)
}

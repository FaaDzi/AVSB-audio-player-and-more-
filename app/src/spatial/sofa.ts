import { fft } from '../audio/fft'
import { IMPORTED_ID } from './hrirStore'
import { resample } from './stage'
import type { HrirSet } from './types'

/**
 * SOFA import (plan §32 phase 3): a measured HRTF (Genelec Aural ID, a lab measurement, …) turned
 * into the app's HRIR ring the same way scripts/build_hrirs.py builds the bundled sets:
 * elevation-0 directions, linearly interpolated to a 5° ring, diffuse-field equalised (minimum-phase
 * inverse of the cos-weighted RMS average over all directions, ⅓-octave smoothed, flat below 150 Hz
 * and above 16 kHz, ±15 dB), resampled to 48 kHz, trimmed to just before the earliest onset, cut to
 * 256 taps with a fade-out, and levelled so the frontal ±30° pair heard as one source is at 0 dB.
 */

export { IMPORTED_ID }
const RATE = 48000
const STEP = 5
const TAPS = 256
const PRE = 4
const FADE = 32
const MAX_EQ_DB = 15
const DF_LO_HZ = 150
const DF_HI_HZ = 16000

/** One measured direction: azimuth (counter-clockwise, 90 = left) and elevation in degrees, left/right HRIR. */
export interface Measurement {
  az: number
  el: number
  left: Float32Array
  right: Float32Array
}

export interface SofaData {
  sampleRate: number
  measurements: Measurement[]
  /** ListenerShortName or similar, when the file has one. */
  listener?: string
}

const mod360 = (a: number) => ((a % 360) + 360) % 360

/**
 * The ear-height directions, sorted by azimuth: those at elevation 0 (±0.5°), or, if a set has no
 * ring there, at the measured elevation closest to 0 (up to 10° away). Duplicates are dropped.
 */
export function earHeightRing(ms: Measurement[]): Measurement[] {
  if (!ms.length) return []
  const el0 = ms.reduce((b, m) => (Math.abs(m.el) < Math.abs(b) ? m.el : b), ms[0].el)
  if (Math.abs(el0) > 10) return []
  const pick = Math.abs(el0) <= 0.5 ? (m: Measurement) => Math.abs(m.el) <= 0.5 : (m: Measurement) => Math.abs(m.el - el0) <= 0.5
  const out: Measurement[] = []
  for (const m of ms.filter(pick).map((m) => ({ ...m, az: mod360(m.az) })).sort((a, b) => a.az - b.az)) {
    if (!out.length || Math.abs(out[out.length - 1].az - m.az) > 1e-6) out.push(m)
  }
  if (out.length > 1 && Math.abs(out[0].az + 360 - out[out.length - 1].az) < 1e-6) out.pop()
  return out
}

/** Largest azimuth gap (degrees) in a sorted ring, wrapping around. */
export function largestGap(ring: { az: number }[]): number {
  if (ring.length < 2) return 360
  let gap = ring[0].az + 360 - ring[ring.length - 1].az
  for (let i = 1; i < ring.length; i++) gap = Math.max(gap, ring[i].az - ring[i - 1].az)
  return gap
}

/**
 * HRIR pairs every `stepDeg` around the head from a sorted ear-height ring: the measured pair when
 * one sits on the step, otherwise a linear mix of the two neighbours (like build_hrirs.py `ring_at`).
 */
export function interpolateRing(ring: Measurement[], stepDeg = STEP): { left: Float32Array; right: Float32Array }[] {
  const n = Math.round(360 / stepDeg)
  const len = Math.max(...ring.map((m) => Math.max(m.left.length, m.right.length)))
  const out: { left: Float32Array; right: Float32Array }[] = []
  for (let k = 0; k < n; k++) {
    const az = k * stepDeg
    const exact = ring.find((m) => Math.abs(m.az - az) < 1e-6)
    if (exact) {
      out.push({ left: Float32Array.from(exact.left), right: Float32Array.from(exact.right) })
      continue
    }
    let hi = ring.findIndex((m) => m.az > az)
    if (hi < 0) hi = 0
    const lo = (hi - 1 + ring.length) % ring.length
    const span = mod360(ring[hi].az - ring[lo].az) || 360
    const t = mod360(az - ring[lo].az) / span
    const mix = (a: Float32Array, b: Float32Array) => {
      const o = new Float32Array(len)
      for (let i = 0; i < len; i++) o[i] = (1 - t) * (a[i] ?? 0) + t * (b[i] ?? 0)
      return o
    }
    out.push({ left: mix(ring[lo].left, ring[hi].left), right: mix(ring[lo].right, ring[hi].right) })
  }
  return out
}

/** Magnitude of the rfft bins (0 … nfft/2) of `x` zero-padded or cut to `nfft`. */
export function magnitude(x: ArrayLike<number>, nfft: number): Float64Array {
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  for (let i = 0; i < Math.min(nfft, x.length); i++) re[i] = x[i]
  fft(re, im)
  const out = new Float64Array(nfft / 2 + 1)
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i])
  return out
}

/** ⅓-octave RMS smoothing of a magnitude on linear bins (as build_hrirs.py `third_octave_smooth`). */
export function thirdOctaveSmooth(freqs: ArrayLike<number>, mag: ArrayLike<number>): Float64Array {
  const out = new Float64Array(mag.length)
  const lo = 2 ** (-1 / 6)
  const hi = 2 ** (1 / 6)
  for (let i = 0; i < mag.length; i++) {
    const f = freqs[i]
    if (f <= 0) {
      out[i] = mag[i]
      continue
    }
    let s = 0
    let c = 0
    for (let j = 0; j < mag.length; j++) {
      if (freqs[j] >= f * lo && freqs[j] <= f * hi) {
        s += mag[j] * mag[j]
        c++
      }
    }
    out[i] = Math.sqrt(s / c)
  }
  return out
}

/** Minimum-phase impulse response (length nfft) with the given rfft magnitude, via the real cepstrum. */
export function minPhase(mag: ArrayLike<number>): Float64Array {
  const n = (mag.length - 1) * 2
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = Math.log(Math.max(mag[i <= n / 2 ? i : n - i], 1e-8))
  fft(re, im, true)
  // fold the cepstrum onto positive quefrencies
  for (let i = 1; i < n / 2; i++) re[i] *= 2
  for (let i = n / 2 + 1; i < n; i++) re[i] = 0
  im.fill(0)
  fft(re, im)
  for (let i = 0; i < n; i++) {
    const e = Math.exp(re[i])
    const ph = im[i]
    re[i] = e * Math.cos(ph)
    im[i] = e * Math.sin(ph)
  }
  fft(re, im, true)
  return re
}

/**
 * The diffuse-field equaliser for a set of measurements (as build_hrirs.py `diffuse_field_eq`): the
 * RMS magnitude over every direction and both ears, weighted by cos(elevation) (at least 0.05),
 * smoothed, held flat outside 150 Hz – 16 kHz, normalised to 0 dB RMS in that band, inverted with the
 * gain limited to ±15 dB, as a minimum-phase FIR of `nfft` samples.
 */
export function diffuseFieldEq(ms: Measurement[], sampleRate: number, nfft: number): Float64Array {
  const bins = nfft / 2 + 1
  const power = new Float64Array(bins)
  let wSum = 0
  for (const m of ms) {
    const w = Math.max(Math.cos((m.el * Math.PI) / 180), 0.05)
    for (const ear of [m.left, m.right]) {
      const mag = magnitude(ear, nfft)
      for (let i = 0; i < bins; i++) power[i] += w * mag[i] * mag[i]
    }
    wSum += 2 * w
  }
  const freqs = Float64Array.from({ length: bins }, (_, i) => (i * sampleRate) / nfft)
  const df = thirdOctaveSmooth(freqs, power.map((p) => Math.sqrt(p / wSum)))
  const lo = Math.min(bins - 1, freqs.findIndex((f) => f >= DF_LO_HZ))
  let hi = freqs.findIndex((f) => f >= DF_HI_HZ)
  if (hi < 0) hi = bins - 1
  for (let i = 0; i < lo; i++) df[i] = df[lo]
  for (let i = hi + 1; i < bins; i++) df[i] = df[hi]
  let rms = 0
  for (let i = lo; i < hi; i++) rms += df[i] * df[i]
  rms = Math.sqrt(rms / Math.max(1, hi - lo)) || 1
  const inv = df.map((v) => {
    const db = Math.min(MAX_EQ_DB, Math.max(-MAX_EQ_DB, -20 * Math.log10(Math.max(v / rms, 1e-12))))
    return 10 ** (db / 20)
  })
  return minPhase(inv)
}

/** Linear convolution of two short signals (FFT). */
export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const len = a.length + b.length - 1
  let n = 1
  while (n < len) n <<= 1
  const ar = new Float64Array(n)
  const ai = new Float64Array(n)
  const br = new Float64Array(n)
  const bi = new Float64Array(n)
  for (let i = 0; i < a.length; i++) ar[i] = a[i]
  for (let i = 0; i < b.length; i++) br[i] = b[i]
  fft(ar, ai)
  fft(br, bi)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i]
    ai[i] = ar[i] * bi[i] + ai[i] * br[i]
    ar[i] = r
  }
  fft(ar, ai, true)
  return ar.subarray(0, len)
}

/** First sample reaching `frac` of the peak. */
export function onset(x: ArrayLike<number>, frac = 0.2): number {
  let peak = 0
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]))
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= frac * peak) return i
  return 0
}

/** Trim every response to start PRE samples before the ring's earliest onset (keeping the ITD), cut to TAPS, fade out. */
export function trimRing(ring: { left: Float32Array; right: Float32Array }[], taps = TAPS): { left: Float32Array; right: Float32Array }[] {
  let first = Infinity
  for (const p of ring) first = Math.min(first, onset(p.left), onset(p.right))
  const start = Math.max(0, first - PRE)
  const fade = Float32Array.from({ length: FADE }, (_, i) => 0.5 * (1 + Math.cos((Math.PI * i) / (FADE - 1))))
  const cut = (x: Float32Array) => {
    const o = new Float32Array(taps)
    o.set(x.subarray(start, start + taps))
    for (let i = 0; i < FADE; i++) o[taps - FADE + i] *= fade[i]
    return o
  }
  return ring.map((p) => ({ left: cut(p.left), right: cut(p.right) }))
}

/** Scale so the ±30° pair summed (a centred source) has unit energy on average over both ears. */
export function levelRing(ring: { left: Float32Array; right: Float32Array }[], stepDeg = STEP) {
  const a = ring[Math.round(30 / stepDeg) % ring.length]
  const b = ring[Math.round(330 / stepDeg) % ring.length]
  let e = 0
  for (const [x, y] of [[a.left, b.left], [a.right, b.right]] as const) for (let i = 0; i < x.length; i++) e += (x[i] + y[i]) ** 2
  const g = e > 0 ? 1 / Math.sqrt(e / 2) : 1
  for (const p of ring) {
    for (let i = 0; i < p.left.length; i++) p.left[i] *= g
    for (let i = 0; i < p.right.length; i++) p.right[i] *= g
  }
  return ring
}

/** The whole build: SOFA measurements → the app's 48 kHz, 5° ring. Throws a readable Error when the set can't be used. */
export function buildHrirSet(data: SofaData, meta: { name: string; source: string }): HrirSet {
  const ear = earHeightRing(data.measurements)
  if (ear.length < 4 || largestGap(ear) > 60) {
    throw new Error('This file has no ring of directions around the head at ear height, so it can’t place speakers in front of you.')
  }
  const fs = data.sampleRate
  let nfft = 1024
  while (nfft < (1024 * fs) / RATE) nfft <<= 1
  const eq = diffuseFieldEq(data.measurements, fs, nfft)
  const ring = interpolateRing(ear, STEP).map((p) => {
    const f = (x: Float32Array) => resample(Float32Array.from(convolve(x, eq)), fs, RATE)
    return { left: f(p.left), right: f(p.right) }
  })
  return {
    id: IMPORTED_ID,
    name: meta.name,
    source: meta.source,
    sampleRate: RATE,
    stepDeg: STEP,
    ring: levelRing(trimRing(ring)),
  }
}

// ---------- reading the file (jsfive, loaded only when someone imports) ----------

interface H5Node {
  value: unknown
  shape: number[]
  attrs: Record<string, unknown>
}

const text = (v: unknown) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '')

/** Reads the parts of a SOFA (SimpleFreeFieldHRIR) file the build needs. */
export async function readSofa(buf: ArrayBuffer, fileName: string): Promise<SofaData> {
  const { File: H5File } = await import('jsfive')
  let f: { get(path: string): H5Node | null; attrs: Record<string, unknown> }
  try {
    f = new H5File(buf, fileName)
  } catch {
    throw new Error('Not a SOFA file (it couldn’t be read as HDF5/netCDF-4).')
  }
  const get = (k: string) => {
    try {
      return f.get(k) ?? null
    } catch {
      return null
    }
  }
  const ir = get('Data.IR')
  const sr = get('Data.SamplingRate')
  const pos = get('SourcePosition')
  if (!ir || !sr || !pos) throw new Error('This SOFA file has no HRIRs (Data.IR, Data.SamplingRate and SourcePosition are needed).')
  const [M, R, N] = ir.shape
  if (ir.shape.length !== 3 || R !== 2) throw new Error(`Expected impulse responses for 2 ears, found ${R ?? '?'} receivers.`)
  const sampleRate = Number((sr.value as number[])[0])
  if (!(sampleRate >= 8000 && sampleRate <= 384000)) throw new Error('The file’s sample rate is missing or unusable.')
  const irv = ir.value as ArrayLike<number>
  const pv = pos.value as ArrayLike<number>
  const perPos = pos.shape[0] === M
  if (!perPos && pos.shape[0] !== 1) throw new Error('The source positions don’t match the impulse responses.')
  const cartesian = /cart/i.test(text(pos.attrs?.Type))
  // a separate broadband delay per measurement and ear (most files have none)
  const delay = get('Data.Delay')
  const dv = (delay?.value as ArrayLike<number> | undefined) ?? []
  const dPer = delay?.shape[0] === M
  const measurements: Measurement[] = []
  for (let m = 0; m < M; m++) {
    const p = perPos ? m : 0
    let az = pv[p * 3]
    let el = pv[p * 3 + 1]
    if (cartesian) {
      const [x, y, z] = [pv[p * 3], pv[p * 3 + 1], pv[p * 3 + 2]]
      az = (Math.atan2(y, x) * 180) / Math.PI
      el = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI
    }
    const ch = (r: number) => {
      const d = Math.max(0, Math.round(Number(dv[(dPer ? m : 0) * 2 + r] ?? 0)))
      const o = new Float32Array(N + Math.min(d, 4096))
      const base = (m * 2 + r) * N
      for (let i = 0; i < N; i++) o[i + o.length - N] = irv[base + i]
      return o
    }
    measurements.push({ az, el, left: ch(0), right: ch(1) })
  }
  const listener = text(f.attrs?.ListenerShortName) || undefined
  return { sampleRate, measurements, listener }
}

/** File → HrirSet, with a readable error for anything that goes wrong. */
export async function importSofa(file: File): Promise<HrirSet> {
  if (file.size > 200 * 1024 * 1024) throw new Error('That file is too large for an HRTF (over 200 MB).')
  const data = await readSofa(await file.arrayBuffer(), file.name)
  const base = file.name.replace(/\.sofa$/i, '')
  return buildHrirSet(data, {
    name: data.listener && !base.includes(data.listener) ? `${base} (${data.listener})` : base,
    source: `Imported from ${file.name}`,
  })
}

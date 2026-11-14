import { fft } from './fft'

export interface CorrectionOptions {
  /** Fractional-octave smoothing applied to the difference curve. */
  smoothingOct: number
  /** Largest boost allowed anywhere (dB). */
  maxBoostDb: number
  /** Largest cut allowed anywhere (dB). */
  maxCutDb: number
  /** Below this frequency boosts are capped at `lowBoostDb` (speakers can't reproduce deep bass). */
  lowLimitHz: number
  lowBoostDb: number
  /** Hold back the correction above AIR_FROM_HZ (default: the saved setting, see airHeld). */
  holdAir?: boolean
}

export const IEM_OPTIONS: CorrectionOptions = {
  smoothingOct: 1 / 12,
  maxBoostDb: 12,
  maxCutDb: 18,
  lowLimitHz: 0,
  lowBoostDb: 12,
}

export const SPEAKER_OPTIONS: CorrectionOptions = {
  smoothingOct: 1 / 6,
  maxBoostDb: 9,
  maxCutDb: 18,
  lowLimitHz: 150,
  lowBoostDb: 3,
}

const AIR_KEY = 'air-held-v1'
/** From here up, rigs and insertion depth disagree by several dB, so a held-back correction fades... */
const AIR_FROM_HZ = 10000
/** ...to this share of itself at AIR_FULL_HZ and above. */
const AIR_SHARE = 0.5
const AIR_FULL_HZ = 14000

/**
 * Treble above 10 kHz: 'auto' (default: the gallery keeps full detail when both devices are
 * measured alike, eq/trebleDetail.ts), 'held' (always held back) or 'measured' (always in full).
 */
export function airMode(): 'auto' | 'held' | 'measured' {
  try {
    const v = localStorage.getItem(AIR_KEY)
    return v === '1' ? 'held' : v === '0' ? 'measured' : 'auto'
  } catch {
    return 'auto'
  }
}

export function setAirMode(m: 'auto' | 'held' | 'measured') {
  try {
    if (m === 'auto') localStorage.removeItem(AIR_KEY)
    else localStorage.setItem(AIR_KEY, m === 'held' ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** Is the air held back where no per-pair decision is made (the tournament)? Only 'measured' turns it off. */
export function airHeld(): boolean {
  return airMode() !== 'measured'
}

/** How much of the correction is kept at `f` when the air is held back (1 below AIR_FROM_HZ). */
export function airWeight(f: number): number {
  if (f <= AIR_FROM_HZ) return 1
  const t = Math.min(1, Math.log(f / AIR_FROM_HZ) / Math.log(AIR_FULL_HZ / AIR_FROM_HZ))
  return 1 - t * (1 - AIR_SHARE)
}

/** Interpolate a curve defined on a log-frequency grid at arbitrary frequencies (flat extension). */
export function interpLog(grid: ArrayLike<number>, values: ArrayLike<number>, freqs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(freqs.length)
  const n = grid.length
  let j = 0
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]
    if (f <= grid[0]) { out[i] = values[0]; continue }
    if (f >= grid[n - 1]) { out[i] = values[n - 1]; continue }
    while (j < n - 2 && grid[j + 1] < f) j++
    while (j > 0 && grid[j] > f) j--
    const t = Math.log(f / grid[j]) / Math.log(grid[j + 1] / grid[j])
    out[i] = values[j] + t * (values[j + 1] - values[j])
  }
  return out
}

/** Moving-average smoothing over a log-spaced grid with `pointsPerOctave` resolution. */
export function smoothLog(values: ArrayLike<number>, pointsPerOctave: number, octaves: number): Float64Array {
  const k = Math.max(0, Math.round((octaves * pointsPerOctave) / 2))
  const n = values.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let cnt = 0
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      sum += values[j]
      cnt++
    }
    out[i] = sum / cnt
  }
  return out
}

/**
 * The 4096-tap FIR resolves about 12 Hz (48 kHz / 4096): finer detail than that, which only deep bass
 * has on a log grid, can't be built and only leaves the filter off its curve. Smoothing therefore
 * never goes narrower than this many Hz (≈ 0.57 octave at 25 Hz, 0.2 at 80 Hz, the usual 1/12 above ~200 Hz).
 */
const FIR_RESOLUTION_HZ = 12
/** Boosts and cuts bend into their cap over this many dB instead of a hard corner the FIR rings around. */
const CAP_KNEE_DB = 2

/** `x` held under `cap` with a soft knee of ±k dB (unchanged below cap − k, exactly cap above cap + k). */
export function softCap(x: number, cap: number, k = CAP_KNEE_DB): number {
  if (x <= cap - k) return x
  if (x >= cap + k) return cap
  return x - (x - cap + k) ** 2 / (4 * k)
}

/**
 * Difference curve (dB on `grid`) that makes a device sounding like `reference`
 * sound like `candidate`: candidate − reference, smoothed and clamped.
 */
export function correctionCurve(
  grid: ArrayLike<number>,
  candidate: ArrayLike<number>,
  reference: ArrayLike<number>,
  opts: CorrectionOptions,
): Float64Array {
  const pointsPerOctave = Math.round(1 / Math.log2(grid[1] / grid[0]))
  const n = grid.length
  const diff = new Float64Array(n)
  for (let i = 0; i < n; i++) diff[i] = candidate[i] - reference[i]
  const sm = new Float64Array(n)
  const hold = opts.holdAir ?? airHeld()
  for (let i = 0; i < n; i++) {
    const octaves = Math.max(opts.smoothingOct, Math.log2(1 + FIR_RESOLUTION_HZ / grid[i]))
    const k = Math.max(0, Math.round((octaves * pointsPerOctave) / 2))
    let sum = 0
    let cnt = 0
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      sum += diff[j]
      cnt++
    }
    const cap = grid[i] < opts.lowLimitHz ? opts.lowBoostDb : opts.maxBoostDb
    sm[i] = -softCap(-softCap(sum / cnt, cap), opts.maxCutDb) * (hold ? airWeight(grid[i]) : 1)
  }
  return sm
}

/**
 * Minimum-phase FIR whose magnitude follows `dbAt(f)`, via the real-cepstrum method.
 * Returns `taps` filter coefficients for the given sample rate.
 */
export function minPhaseFir(
  grid: ArrayLike<number>,
  curveDb: ArrayLike<number>,
  sampleRate: number,
  taps = 4096,
): Float32Array {
  const n = taps * 4 // oversampled FFT to limit cepstral aliasing
  const half = n / 2
  const freqs = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) freqs[k] = (k * sampleRate) / n
  const db = interpLog(grid, curveDb, freqs)

  // log-magnitude spectrum (natural log), mirrored to full length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let k = 0; k <= half; k++) re[k] = (db[k] / 20) * Math.LN10
  for (let k = half + 1; k < n; k++) re[k] = re[n - k]

  // real cepstrum
  fft(re, im, true)
  // fold to a causal cepstrum → minimum phase
  for (let i = 1; i < half; i++) {
    re[i] *= 2
    im[i] *= 2
  }
  for (let i = half + 1; i < n; i++) {
    re[i] = 0
    im[i] = 0
  }
  // back to spectrum, exponentiate
  fft(re, im)
  for (let k = 0; k < n; k++) {
    const mag = Math.exp(re[k])
    const ph = im[k]
    re[k] = mag * Math.cos(ph)
    im[k] = mag * Math.sin(ph)
  }
  fft(re, im, true)

  // truncate with a half-Hann fade-out over the last quarter
  const out = new Float32Array(taps)
  const fade = taps / 4
  for (let i = 0; i < taps; i++) {
    const w = i < taps - fade ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - (taps - fade))) / fade))
    out[i] = re[i] * w
  }
  return out
}

/**
 * Linear-phase FIR with the same magnitude (plan §53.3, SoundID's "Linear Phase" mode): no phase
 * shift at any frequency, at the cost of taps/2 samples of delay (≈ 43 ms at 48 kHz for 4096 taps)
 * and a little pre-ringing before sharp sounds. Zero-phase spectrum → inverse FFT → centred → Hann.
 */
export function linearPhaseFir(grid: ArrayLike<number>, curveDb: ArrayLike<number>, sampleRate: number, taps = 4096): Float32Array {
  const n = taps
  const half = n / 2
  const freqs = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) freqs[k] = (k * sampleRate) / n
  const db = interpLog(grid, curveDb, freqs)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let k = 0; k <= half; k++) re[k] = 10 ** (db[k] / 20)
  for (let k = half + 1; k < n; k++) re[k] = re[n - k]
  fft(re, im, true)
  const out = new Float32Array(taps)
  for (let i = 0; i < taps; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / taps))
    out[i] = re[(i + half) % n] * w
  }
  return out
}

const PHASE_KEY = 'eq-phase-v1'
export type FirPhase = 'minimum' | 'linear'

/** The EQ filter phase from Settings → Sound: 'minimum' (default, no delay) or 'linear'. */
export function firPhase(): FirPhase {
  try {
    return localStorage.getItem(PHASE_KEY) === 'linear' ? 'linear' : 'minimum'
  } catch {
    return 'minimum'
  }
}

const phaseListeners = new Set<(p: FirPhase) => void>()

export function setFirPhase(p: FirPhase) {
  try {
    if (p === 'linear') localStorage.setItem(PHASE_KEY, p)
    else localStorage.removeItem(PHASE_KEY)
  } catch {
    /* ignore */
  }
  for (const cb of [...phaseListeners]) cb(p)
}

/** Called when the phase setting changes (the gallery rebuilds its playing filter); returns the unsubscribe. */
export function onFirPhaseChange(cb: (p: FirPhase) => void): () => void {
  phaseListeners.add(cb)
  return () => void phaseListeners.delete(cb)
}

/** The gallery's and matches' EQ filter, in the phase the user picked. */
export function designFir(grid: ArrayLike<number>, curveDb: ArrayLike<number>, sampleRate: number, taps = 4096, phase: FirPhase = firPhase()): Float32Array {
  return phase === 'linear' ? linearPhaseFir(grid, curveDb, sampleRate, taps) : minPhaseFir(grid, curveDb, sampleRate, taps)
}

/** Magnitude response (dB) of an FIR at the given frequencies — used for tests and plots. */
export function firResponseDb(taps: Float32Array, sampleRate: number, freqs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(freqs.length)
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / sampleRate
    let r = 0
    let im = 0
    for (let t = 0; t < taps.length; t++) {
      r += taps[t] * Math.cos(w * t)
      im -= taps[t] * Math.sin(w * t)
    }
    out[i] = 10 * Math.log10(r * r + im * im)
  }
  return out
}

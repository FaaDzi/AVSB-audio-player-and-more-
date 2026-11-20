import { smoothLog } from '../audio/filter'
import { addBiquadDb, chainDb, type Biquad } from './biquad'

export interface ParametricOptions {
  maxFilters: number
  qMin: number
  qMax: number
  maxGainDb: number
  /** Filters are placed between these (many EQ apps can't go above 10 kHz). */
  fMin: number
  fMax: number
  /** The curve counts in full up to here (default fMax); above it, a fifth. */
  weightTo?: number
  /** Start with a low shelf (105 Hz) and a high shelf (10 kHz) where the curve tilts at its ends, as AutoEq does. */
  shelves?: boolean
  /** §91 E1: how high the shelves may move (default fMax). PEQdB lets them go anywhere from 20 Hz to 16 kHz. */
  shelfFMax?: number
  /** Fine-tuning rounds for all filters together at the end (default 30). */
  passes?: number
}

/**
 * The sweet spot most players take (plan §53.4): FiiO and HiBy DAPs and dongles, Wavelet, Poweramp and
 * most DSP cables have 10 PEQ bands; Q above ~8 misbehaves on some dongles, so Q 0.5–6 and ±12 dB.
 */
export const PARAMETRIC_DEFAULTS: ParametricOptions = { maxFilters: 10, qMin: 0.5, qMax: 6, maxGainDb: 12, fMin: 20, fMax: 10000, shelves: true }
/** For Qudelix 5K (20 bands) and Equalizer APO (no limit). */
export const PARAMETRIC_20: ParametricOptions = { ...PARAMETRIC_DEFAULTS, maxFilters: 20 }

export interface ParametricEq {
  filters: Biquad[]
  /** Negative gain so the EQ never boosts above 0 dB (no clipping). */
  preampDb: number
  /** How far the filters miss the curve, 20 Hz–10 kHz (dB rms). */
  errorDb: number
}

/**
 * Fit peaking filters to an EQ curve (dB on a log grid), AutoEq style. Filters are
 * added one at a time where the curve is missed by the most, sized from the miss's width,
 * then all of them are fine-tuned together. The curve's overall level doesn't matter:
 * the fit follows its shape, and the preamp sets the level.
 */
export function fitParametric(grid: ArrayLike<number>, curve: ArrayLike<number>, opts: ParametricOptions = PARAMETRIC_DEFAULTS): ParametricEq {
  const idx: number[] = []
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 20 && grid[i] <= 16000) idx.push(i)
  const f = idx.map((i) => grid[i])
  const t = idx.map((i) => curve[i])
  // above the filter range the exact shape matters less (and measurements are rough there)
  const w = f.map((x) => (x <= (opts.weightTo ?? opts.fMax) ? 1 : 0.2))
  const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))

  const filters: Biquad[] = []
  const parts: Float64Array[] = []
  const sum = new Float64Array(f.length)
  const offsetOf = (s: ArrayLike<number>) => {
    let a = 0, b = 0
    for (let k = 0; k < f.length; k++) {
      a += w[k] * (t[k] - s[k])
      b += w[k]
    }
    return a / b
  }
  const errOf = (s: ArrayLike<number>) => {
    const o = offsetOf(s)
    let e = 0
    for (let k = 0; k < f.length; k++) e += w[k] * (t[k] - s[k] - o) ** 2
    return e
  }
  const shelfTop = opts.shelfFMax ?? opts.fMax
  const clampF = (b: Biquad): Biquad => ({
    kind: b.kind,
    fc: Math.min(b.kind === 'peak' ? opts.fMax : shelfTop, Math.max(opts.fMin, b.fc)),
    gain: Math.min(opts.maxGainDb, Math.max(-opts.maxGainDb, b.gain)),
    // a shelf above Q ≈ 1 overshoots into a bump before it settles; below 0.4 it barely turns
    q: b.kind === 'peak' ? Math.min(opts.qMax, Math.max(opts.qMin, b.q)) : Math.min(1, Math.max(0.4, b.q)),
  })

  // shelves first: a broad tilt at either end costs one shelf instead of several wide peaks
  if (opts.shelves) {
    for (const [kind, fc, inRange] of [
      ['lowshelf', 105, (x: number) => x < 105],
      ['highshelf', Math.min(10000, shelfTop), (x: number) => x > Math.min(10000, shelfTop)],
    ] as const) {
      if (filters.length >= opts.maxFilters) break
      const o = offsetOf(sum)
      let a = 0, c = 0
      for (let k = 0; k < f.length; k++) if (inRange(f[k])) {
        a += t[k] - sum[k] - o
        c++
      }
      const gain = c ? a / c : 0
      if (Math.abs(gain) < 1) continue
      const b = clampF({ kind, fc, gain, q: 0.7 })
      const resp = addBiquadDb(b, f, new Float64Array(f.length))
      const before = errOf(sum)
      const trial = Float64Array.from(sum, (v, k) => v + resp[k])
      if (errOf(trial) >= before) continue
      filters.push(b)
      parts.push(resp)
      sum.set(trial)
      refine(f, filters, parts, sum, errOf, clampF, 4)
    }
  }
  for (let n = filters.length; n < opts.maxFilters; n++) {
    const o = offsetOf(sum)
    const r = smoothLog(Float64Array.from(f, (_, k) => t[k] - sum[k] - o), ppo, 1 / 6)
    let best = -1
    for (let k = 0; k < f.length; k++) if (f[k] <= opts.fMax && (best < 0 || Math.abs(r[k]) > Math.abs(r[best]))) best = k
    if (best < 0 || Math.abs(r[best]) < 0.3) break
    // width of the miss at half its height -> bandwidth in octaves -> Q
    const half = r[best] / 2
    let lo = best, hi = best
    while (lo > 0 && Math.sign(r[lo - 1]) === Math.sign(half) && Math.abs(r[lo - 1]) > Math.abs(half)) lo--
    while (hi < f.length - 1 && Math.sign(r[hi + 1]) === Math.sign(half) && Math.abs(r[hi + 1]) > Math.abs(half)) hi++
    const bw = Math.max(1 / 6, Math.log2(f[hi] / f[lo]))
    const q = Math.sqrt(2 ** bw) / (2 ** bw - 1)
    const b = clampF({ kind: 'peak', fc: f[best], gain: r[best], q })
    const resp = addBiquadDb(b, f, new Float64Array(f.length))
    filters.push(b)
    parts.push(resp)
    for (let k = 0; k < f.length; k++) sum[k] += resp[k]
    refine(f, filters, parts, sum, errOf, clampF, 4)
  }
  refine(f, filters, parts, sum, errOf, clampF, opts.passes ?? 30)

  const round = (b: Biquad): Biquad => ({ kind: b.kind, fc: Math.round(b.fc), gain: Math.round(b.gain * 10) / 10, q: Math.round(b.q * 100) / 100 })
  const out = filters.map(round).sort((a, b) => a.fc - b.fc)
  const full = Array.from({ length: 200 }, (_, i) => 20 * 1000 ** (i / 199))
  const peak = Math.max(0, ...chainDb(out, full))
  const s = chainDb(out, f)
  const o = offsetOf(s)
  let e = 0, n = 0
  for (let k = 0; k < f.length; k++) if (f[k] <= 10000) {
    e += (t[k] - s[k] - o) ** 2
    n++
  }
  return { filters: out, preampDb: -Math.ceil(peak * 10) / 10, errorDb: Math.sqrt(e / n) }
}

/** Coordinate descent on every filter's frequency, gain and Q; keeps any step that lowers the error. */
function refine(
  f: number[],
  filters: Biquad[],
  parts: Float64Array[],
  sum: Float64Array,
  errOf: (s: ArrayLike<number>) => number,
  clampF: (b: Biquad) => Biquad,
  passes: number,
) {
  let err = errOf(sum)
  const trial = new Float64Array(sum.length)
  // big steps first, then small ones. (It used to stop as soon as the big steps stopped helping, so the small
  // ones never ran.)
  let fine = false
  for (let pass = 0; pass < passes; pass++) {
    let improved = false
    if (pass >= passes / 2) fine = true
    const scale = fine ? 0.4 : 1
    for (let j = 0; j < filters.length; j++) {
      const b = filters[j]
      const steps: Biquad[] = [
        { ...b, fc: b.fc * 2 ** (scale / 12) },
        { ...b, fc: b.fc / 2 ** (scale / 12) },
        { ...b, gain: b.gain + 0.5 * scale },
        { ...b, gain: b.gain - 0.5 * scale },
        { ...b, q: b.q * (1 + 0.15 * scale) },
        { ...b, q: b.q / (1 + 0.15 * scale) },
      ]
      for (const step of steps) {
        const c = clampF(step)
        const resp = addBiquadDb(c, f, new Float64Array(f.length))
        for (let k = 0; k < sum.length; k++) trial[k] = sum[k] - parts[j][k] + resp[k]
        const e = errOf(trial)
        if (e < err - 1e-9) {
          err = e
          filters[j] = c
          parts[j] = resp
          sum.set(trial)
          improved = true
          break
        }
      }
    }
    if (!improved) {
      if (fine) break
      fine = true
    }
  }
}

/** Equalizer APO / Peace text, also read by Wavelet's and Poweramp's parametric import. */
export function parametricText(eq: ParametricEq): string {
  const kind = { peak: 'PK', lowshelf: 'LSC', highshelf: 'HSC' }
  return [
    `Preamp: ${eq.preampDb.toFixed(1)} dB`,
    ...eq.filters.map((b, i) => `Filter ${i + 1}: ON ${kind[b.kind]} Fc ${b.fc} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.q.toFixed(2)}`),
  ].join('\n')
}

/** One second-order EQ filter, as EQ apps and Equalizer APO describe it. */
export interface Biquad {
  kind: 'peak' | 'lowshelf' | 'highshelf'
  fc: number
  gain: number
  q: number
}

/** RBJ Audio EQ Cookbook coefficients: [b0, b1, b2, a0, a1, a2]. */
function coeffs(f: Biquad, fs: number): number[] {
  const a = 10 ** (f.gain / 40)
  const w0 = (2 * Math.PI * f.fc) / fs
  const c = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * f.q)
  const s = 2 * Math.sqrt(a) * alpha
  if (f.kind === 'peak') return [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a]
  if (f.kind === 'lowshelf')
    return [
      a * (a + 1 - (a - 1) * c + s),
      2 * a * (a - 1 - (a + 1) * c),
      a * (a + 1 - (a - 1) * c - s),
      a + 1 + (a - 1) * c + s,
      -2 * (a - 1 + (a + 1) * c),
      a + 1 + (a - 1) * c - s,
    ]
  return [
    a * (a + 1 + (a - 1) * c + s),
    -2 * a * (a - 1 + (a + 1) * c),
    a * (a + 1 + (a - 1) * c - s),
    a + 1 - (a - 1) * c + s,
    2 * (a - 1 - (a + 1) * c),
    a + 1 - (a - 1) * c - s,
  ]
}

/** Magnitude (dB) of one filter at `freqs`, added into `out` (so chains just sum). */
export function addBiquadDb(f: Biquad, freqs: ArrayLike<number>, out: Float64Array, fs = 48000): Float64Array {
  if (!f.gain) return out
  const [b0, b1, b2, a0, a1, a2] = coeffs(f, fs)
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / fs
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2)
    const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2)
    out[i] += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
  }
  return out
}

/** Summed magnitude (dB) of a filter chain at `freqs`. */
export function chainDb(filters: Biquad[], freqs: ArrayLike<number>, fs = 48000): Float64Array {
  const out = new Float64Array(freqs.length)
  for (const f of filters) addBiquadDb(f, freqs, out, fs)
  return out
}

import { fft } from './fft'

/**
 * Peak headroom for the gallery's EQ stage. Loudness matching keeps a profile as loud as no
 * EQ, but an EQ also changes how peaky the waveform is: measured on real songs, 191 of 205
 * IEM simulations pushed peaks past the limiter, 60 of them by 3-6 dB, and a fast limiter
 * squashing drum hits and sibilance that hard is heard as crackle or buzz. So the player
 * finds the song's loudest moments once, measures each profile's true peak on just those
 * (filtering 96 short windows lands within 0.4 dB of filtering the whole song), and caps
 * the preamp so the limiter only ever shaves a little.
 */

/** Window length and the filter lead-in before it (samples): the FIR has 4096 taps. */
const WIN = 2048
const LEAD = 4096
const FFT_N = 8192 // ≥ LEAD + WIN; the wrapped part of the circular convolution falls in the lead-in

/** The `n` loudest WIN-sample stretches of a song (by peak, all channels), each with LEAD samples before it. */
export function loudWindows(channels: Float32Array[], n = 96): Float32Array[][] {
  const len = channels[0]?.length ?? 0
  const blocks: { at: number; peak: number }[] = []
  for (let s = LEAD; s + WIN <= len; s += WIN) {
    let p = 0
    for (const c of channels) for (let i = s; i < s + WIN; i++) p = Math.max(p, Math.abs(c[i]))
    blocks.push({ at: s, peak: p })
  }
  blocks.sort((a, b) => b.peak - a.peak)
  return blocks.slice(0, n).map(({ at }) => channels.map((c) => c.slice(at - LEAD, at + WIN)))
}

/** Highest |sample| in the windows as they are (no EQ). */
export function rawPeak(windows: Float32Array[][]): number {
  let p = 0
  for (const w of windows) for (const c of w) for (let i = LEAD; i < c.length; i++) p = Math.max(p, Math.abs(c[i]))
  return p
}

/** Highest |sample| in the windows after an FIR (taps ≤ LEAD long). */
export function firPeak(windows: Float32Array[][], taps: Float32Array): number {
  const hr = new Float64Array(FFT_N)
  const hi = new Float64Array(FFT_N)
  hr.set(taps.subarray(0, Math.min(taps.length, FFT_N)))
  fft(hr, hi)
  const re = new Float64Array(FFT_N)
  const im = new Float64Array(FFT_N)
  let p = 0
  for (const w of windows) {
    for (const c of w) {
      re.fill(0)
      im.fill(0)
      re.set(c)
      fft(re, im)
      for (let k = 0; k < FFT_N; k++) {
        const a = re[k]
        const b = im[k]
        re[k] = a * hr[k] - b * hi[k]
        im[k] = a * hi[k] + b * hr[k]
      }
      fft(re, im, true)
      for (let i = LEAD; i < c.length; i++) p = Math.max(p, Math.abs(re[i]))
    }
  }
  return p
}

/** Highest |sample| in the windows after a chain of RBJ peaking filters (the custom EQ). */
export function peakingPeak(windows: Float32Array[][], bands: { freq: number; gainDb: number; q: number }[], sampleRate: number): number {
  const coefs = bands
    .filter((b) => b.gainDb)
    .map(({ freq, gainDb, q }) => {
      const A = 10 ** (gainDb / 40)
      const w0 = (2 * Math.PI * freq) / sampleRate
      const al = Math.sin(w0) / (2 * q)
      const cos = Math.cos(w0)
      const a0 = 1 + al / A
      return [(1 + al * A) / a0, (-2 * cos) / a0, (1 - al * A) / a0, (-2 * cos) / a0, (1 - al / A) / a0]
    })
  let p = 0
  for (const w of windows) {
    for (const c of w) {
      const y = Float64Array.from(c)
      for (const [b0, b1, b2, a1, a2] of coefs) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0
        for (let i = 0; i < y.length; i++) {
          const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
          x2 = x1
          x1 = y[i]
          y2 = y1
          y1 = v
          y[i] = v
        }
      }
      for (let i = LEAD; i < y.length; i++) p = Math.max(p, Math.abs(y[i]))
    }
  }
  return p
}

/**
 * Largest preamp (dB) that keeps `peak` × preamp × `volume` within `allowDb` of the limiter's
 * threshold, so the limiter takes at most about that much off the loudest hits.
 */
export function headroomDb(peak: number, volume: number, thresholdDb = -1, allowDb = 1.5): number {
  if (!(peak > 0) || !(volume > 0)) return Infinity
  return thresholdDb + allowDb - 20 * Math.log10(peak * volume)
}

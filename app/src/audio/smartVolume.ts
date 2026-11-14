/**
 * Smart volume: every song played at a similar loudness, so a quiet classical track and a
 * rhythm-game master don't need the volume moved between them. It is one plain gain per song
 * (like moving the volume slider when the song starts): no compressor, no limiter, no EQ, so the
 * sound and its dynamics stay exactly as they are.
 *
 * Loud songs are always turned down to the target. Quiet songs are turned up only as far as their
 * own peak allows, so nothing clips; a quiet song with full-scale peaks stays a little quieter.
 */

/** Level every song is moved toward (LUFS): Apple Music's. */
export const SMART_TARGET_LUFS = -16

const KEY = 'smart-volume-v1'

export function smartVolumeOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setSmartVolumeOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number]

/** ITU-R BS.1770 K-weighting at any sample rate (the libebur128 design): a high shelf, then a high-pass. */
function kWeighting(fs: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs)
  const Q1 = 0.7071752369554196
  const Vh = 10 ** (3.999843853973347 / 20)
  const Vb = Vh ** 0.4996667741545416
  let a0 = 1 + K / Q1 + K * K
  const shelf: Biquad = [
    (Vh + (Vb * K) / Q1 + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q1 + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q1 + K * K) / a0,
  ]
  K = Math.tan((Math.PI * 38.13547087602444) / fs)
  const Q2 = 0.5003270373238773
  a0 = 1 + K / Q2 + K * K
  const hp: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0]
  return [shelf, hp]
}

/**
 * Integrated loudness (LUFS, ITU-R BS.1770-4 / EBU R128: K-weighted, 400 ms blocks with 75 %
 * overlap, absolute gate −70 LUFS, relative gate −10 LU) and sample peak (linear) of a song.
 * A mono file counts as the same signal in both ears, as it's played.
 */
export function measureLoudness(channels: Float32Array[], sampleRate: number): { lufs: number; peak: number } {
  const len = channels[0]?.length ?? 0
  const seg = Math.max(1, Math.round(sampleRate * 0.1)) // 100 ms: blocks are 4 of these
  const nSeg = Math.floor(len / seg)
  const energy = new Float64Array(nSeg) // summed over channels, per 100 ms
  const [s, h] = kWeighting(sampleRate)
  let peak = 0
  for (const c of channels) {
    // x: input, y: after the shelf (= the high-pass's input), z: after the high-pass
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0
    for (let k = 0; k < nSeg; k++) {
      let sum = 0
      for (let i = k * seg, end = i + seg; i < end; i++) {
        const x = c[i]
        const ax = x < 0 ? -x : x
        if (ax > peak) peak = ax
        const y = s[0] * x + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2
        const z = h[0] * y + h[1] * y1 + h[2] * y2 - h[3] * z1 - h[4] * z2
        x2 = x1
        x1 = x
        y2 = y1
        y1 = y
        z2 = z1
        z1 = z
        sum += z * z
      }
      energy[k] += sum
    }
  }
  const weight = channels.length === 1 ? 2 : 1
  const blocks: number[] = [] // mean-square power per 400 ms block
  for (let k = 0; k + 4 <= nSeg; k++) blocks.push(((energy[k] + energy[k + 1] + energy[k + 2] + energy[k + 3]) * weight) / (4 * seg))
  const lufsOf = (p: number) => -0.691 + 10 * Math.log10(p)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const loud = blocks.filter((p) => p > 0 && lufsOf(p) > -70)
  if (!loud.length) return { lufs: -Infinity, peak }
  const relGate = lufsOf(mean(loud)) - 10
  const gated = loud.filter((p) => lufsOf(p) > relGate)
  return { lufs: lufsOf(mean(gated)), peak }
}

/**
 * The song's Smart volume gain (dB): toward the target, but never so far up that its peak would
 * pass full scale. With Smart volume off, only the song's own overs come off (decoded lossy files
 * can peak a little above 0 dBFS).
 */
export function songGainDb(m: { lufs: number; peak: number }, smart = smartVolumeOn()): number {
  const ceiling = m.peak > 0 ? -20 * Math.log10(m.peak) : Infinity
  if (!smart || !Number.isFinite(m.lufs)) return Math.min(0, ceiling)
  return Math.min(SMART_TARGET_LUFS - m.lufs, ceiling)
}

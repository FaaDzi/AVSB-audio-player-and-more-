import type { HrirSet } from './types'

/**
 * Head size for the virtual speakers. How much later a sound reaches the far ear (the ITD) is the main
 * left/right cue, and it grows with head width: a set measured on someone with a smaller head than yours
 * pulls the speakers inwards and less out in front. Every HRIR pair's ITD is scaled by
 * your head width / AVERAGE_HEAD_CM, shifting the later ear by a fraction of a sample where needed.
 */
export const AVERAGE_HEAD_CM = 15.2
export const HEAD_CM_MIN = 12.5
export const HEAD_CM_MAX = 18

export const clampHeadCm = (cm: number) => Math.min(HEAD_CM_MAX, Math.max(HEAD_CM_MIN, cm))

/** Where an impulse response starts (samples, sub-sample): the first crossing of `frac` × its peak. */
export function onset(x: ArrayLike<number>, frac = 0.2): number {
  let peak = 0
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]))
  const th = frac * peak
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    if (a >= th) {
      if (i === 0) return 0
      const b = Math.abs(x[i - 1])
      return i - 1 + (th - b) / (a - b || 1)
    }
  }
  return 0
}

/** `x` delayed by `d` samples (negative = earlier), Hann-windowed sinc, same length. */
export function shift(x: Float32Array, d: number): Float32Array {
  if (Math.abs(d) < 1e-3) return x
  const out = new Float32Array(x.length)
  const half = 16
  for (let n = 0; n < x.length; n++) {
    const t = n - d
    let s = 0
    for (let k = Math.max(0, Math.ceil(t - half)); k <= Math.min(x.length - 1, Math.floor(t + half)); k++) {
      const u = t - k
      const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)
      s += x[k] * sinc * (0.5 + 0.5 * Math.cos((Math.PI * u) / half))
    }
    out[n] = s
  }
  return out
}

/** The set with every pair's ITD scaled by `k` (the later ear moves; the earlier one stays put). */
export function scaleItd(set: HrirSet, k: number): HrirSet {
  if (Math.abs(k - 1) < 0.005) return set
  return {
    ...set,
    ring: set.ring.map((p) => {
      const itd = onset(p.left) - onset(p.right) // > 0: the left ear hears it later
      const extra = (k - 1) * itd
      return itd > 0 ? { left: shift(p.left, extra), right: p.right } : { left: p.left, right: shift(p.right, -extra) }
    }),
  }
}

import { describe, expect, it } from 'vitest'
import { onset, scaleItd, shift } from './headSize'
import type { HrirSet } from './types'

/** A smooth click starting at sample `at` (fractional), for onset checks. */
const click = (at: number, n = 128) => {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i - at
    x[i] = t < 0 ? 0 : Math.sin(Math.min(1, t / 6) * Math.PI) * Math.exp(-t / 10)
  }
  return x
}

describe('head size (ITD scaling)', () => {
  it('finds onsets to a fraction of a sample, and a shift moves them by that much', () => {
    const x = click(20)
    const o = onset(x)
    // within 0.3 samples (6 µs at 48 kHz): well under the ~10–20 µs ITD change anyone can hear
    expect(Math.abs(onset(shift(x, 3.4)) - o - 3.4)).toBeLessThan(0.3)
    expect(Math.abs(onset(shift(x, -2)) - o + 2)).toBeLessThan(0.3)
  })
  it('scales the gap between the ears by k, moving only the later ear', () => {
    const set: HrirSet = { id: 't', name: 't', source: '', sampleRate: 48000, stepDeg: 90, ring: [
      { left: click(20), right: click(20) },
      { left: click(20), right: click(50) },
      { left: click(46), right: click(20) },
    ] }
    const big = scaleItd(set, 1.2)
    for (let i = 0; i < set.ring.length; i++) {
      const before = onset(set.ring[i].left) - onset(set.ring[i].right)
      const after = onset(big.ring[i].left) - onset(big.ring[i].right)
      expect(after).toBeCloseTo(before * 1.2, 0)
    }
    expect(onset(big.ring[1].left)).toBeCloseTo(onset(set.ring[1].left), 3)
    expect(scaleItd(set, 1)).toBe(set)
  })
})

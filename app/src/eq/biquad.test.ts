import { describe, expect, it } from 'vitest'
import { chainDb } from './biquad'
import { parametricText } from './parametric'

describe('low- and high-pass filters (§96)', () => {
  it('pass below / above the corner and cut on the other side, -3 dB at the corner with Q 0.71', () => {
    const [lo, at, hi] = chainDb([{ kind: 'lowpass', fc: 1000, gain: 0, q: 0.7071 }], [100, 1000, 10000])
    expect(Math.abs(lo)).toBeLessThan(0.1)
    expect(at).toBeCloseTo(-3, 0)
    expect(hi).toBeLessThan(-35)
    const [hlo, , hhi] = chainDb([{ kind: 'highpass', fc: 1000, gain: 0, q: 0.7071 }], [100, 1000, 10000])
    expect(hlo).toBeLessThan(-35)
    expect(Math.abs(hhi)).toBeLessThan(0.1)
  })

  it('export as LPQ / HPQ without a gain, as Equalizer APO reads them', () => {
    const text = parametricText({ filters: [{ kind: 'lowpass', fc: 9000, gain: 0, q: 0.7 }], preampDb: 0, errorDb: 0 })
    expect(text).toContain('ON LPQ Fc 9000 Hz Q 0.70')
    expect(text).not.toContain('Gain')
  })
})

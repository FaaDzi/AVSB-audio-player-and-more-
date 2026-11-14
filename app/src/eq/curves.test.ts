import { describe, expect, it } from 'vitest'
import { chainDb } from './biquad'
import { tameTreble, tasteCurve } from './curves'
import { fitParametric, parametricText } from './parametric'

// the app's grid: 1/24 octave from 20 Hz to 20 kHz
const GRID = Array.from({ length: 240 }, (_, i) => 20 * 2 ** (i / 24))
const at = (curve: ArrayLike<number>, hz: number) => curve[GRID.findIndex((f) => f >= hz)]

describe('biquads', () => {
  it('peak filters hit their gain at fc and fade far away', () => {
    const r = chainDb([{ kind: 'peak', fc: 1000, gain: 6, q: 1 }], [1000, 20, 18000])
    expect(r[0]).toBeCloseTo(6, 1)
    expect(Math.abs(r[1])).toBeLessThan(0.1)
  })
  it('shelves reach their gain on their side only', () => {
    const lo = chainDb([{ kind: 'lowshelf', fc: 105, gain: 5, q: 0.7 }], [20, 5000])
    const hi = chainDb([{ kind: 'highshelf', fc: 2500, gain: -4, q: 0.7 }], [100, 18000])
    expect(lo[0]).toBeCloseTo(5, 0)
    expect(Math.abs(lo[1])).toBeLessThan(0.1)
    expect(Math.abs(hi[0])).toBeLessThan(0.1)
    expect(hi[1]).toBeCloseTo(-4, 0)
  })
})

describe('taste', () => {
  it('bass lifts the lows, tilt pivots at 1 kHz', () => {
    const c = tasteCurve(GRID, { bass: 4, treble: 0, tilt: -1 })
    expect(at(c, 30)).toBeGreaterThan(4 + 4) // shelf + ~5 octaves of tilt
    expect(Math.abs(at(c, 1000))).toBeLessThan(0.3)
    expect(at(c, 8000)).toBeCloseTo(-3, 0)
  })
})

describe('tameTreble', () => {
  it('flattens a narrow treble spike but leaves the mids alone', () => {
    const spiky = GRID.map((f) => (f > 7800 && f < 8600 ? 10 : 0) + (f > 900 && f < 1100 ? 3 : 0))
    const tamed = tameTreble(GRID, spiky)
    expect(at(tamed, 8200)).toBeLessThan(5)
    expect(at(tamed, 1000)).toBe(at(spiky, 1000))
  })
})

describe('fitParametric', () => {
  it('fits a smooth EQ curve within half a dB using at most 10 filters', () => {
    const want = chainDb(
      [
        { kind: 'lowshelf', fc: 105, gain: 6, q: 0.7 },
        { kind: 'peak', fc: 3000, gain: -4, q: 1.5 },
        { kind: 'peak', fc: 6500, gain: 3, q: 3 },
      ],
      GRID,
    )
    const eq = fitParametric(GRID, want)
    expect(eq.filters.length).toBeLessThanOrEqual(10)
    expect(eq.errorDb).toBeLessThan(0.5)
    for (const b of eq.filters) {
      expect(b.q).toBeGreaterThanOrEqual(0.5)
      expect(b.q).toBeLessThanOrEqual(6)
      expect(b.fc).toBeLessThanOrEqual(10000)
    }
    // the preamp keeps the whole chain at or under 0 dB
    const peak = Math.max(...chainDb(eq.filters, GRID))
    expect(peak + eq.preampDb).toBeLessThanOrEqual(0.05)
  })

  it('writes Equalizer APO text', () => {
    const text = parametricText({ filters: [{ kind: 'peak', fc: 100, gain: 3, q: 0.7 }], preampDb: -3.1, errorDb: 0 })
    expect(text).toBe('Preamp: -3.1 dB\nFilter 1: ON PK Fc 100 Hz Gain 3.0 dB Q 0.70')
  })
})

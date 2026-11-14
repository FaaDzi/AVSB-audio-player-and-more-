import { describe, expect, it } from 'vitest'
import { bestFit, bestFitTarget, boostCap, worstSpread } from './bestFit'

const grid = Array.from({ length: 241 }, (_, i) => 20 * 2 ** (i / 24))
const bands = { subBass: [20, 60], midBass: [60, 250], lowerMids: [250, 1000], upperMids: [1000, 4000], lowerTreble: [4000, 8000], air: [8000, 16000] } as Record<
  'subBass' | 'midBass' | 'lowerMids' | 'upperMids' | 'lowerTreble' | 'air',
  [number, number]
>
const at = (f: number) => grid.findIndex((g) => g >= f)
/** A bump of `db` at `fc`, `oct` octaves wide (raised cosine). */
const bump = (fc: number, db: number, oct: number) =>
  grid.map((f) => {
    const x = Math.abs(Math.log2(f / fc)) / (oct / 2)
    return x >= 1 ? 0 : (db * (1 + Math.cos(Math.PI * x))) / 2
  })

describe('bestFitTarget', () => {
  it("doesn't fill a narrow dip but fills a wide one, up to the cap", () => {
    const narrow = bestFitTarget(grid, bump(2000, 8, 0.2), bands, null)
    expect(narrow[at(2000)]).toBeLessThan(2)
    const wide = bestFitTarget(grid, bump(2000, 8, 1.5), bands, null)
    expect(wide[at(2000)]).toBeCloseTo(6, 0)
  })

  it('caps treble boosts at +3 dB and corrects nothing above 10 kHz', () => {
    const c = bestFitTarget(grid, bump(7000, 8, 1.5), bands, null)
    expect(c[at(7000)]).toBeLessThanOrEqual(3.01)
    const air = bestFitTarget(grid, bump(12000, -6, 1), bands, null)
    expect(Math.abs(air[at(12000)])).toBeLessThan(0.01)
  })

  it('drops a band the measurements disagree on', () => {
    const full = bump(100, 5, 2)
    const sure = bestFitTarget(grid, full, bands, { midBass: 1, subBass: 1, lowerMids: 1 })
    const unsure = bestFitTarget(grid, full, bands, { midBass: 5, subBass: 5, lowerMids: 5 })
    expect(sure[at(100)]).toBeGreaterThan(4)
    expect(Math.abs(unsure[at(100)])).toBeLessThan(0.01)
  })

  it('cuts are not capped', () => {
    const c = bestFitTarget(grid, bump(3000, -10, 1), bands, null)
    expect(c[at(3000)]).toBeLessThan(-9)
  })
})

describe('bestFit', () => {
  it('uses at most 8 filters with Q ≤ 2 and a preamp for the biggest boost', () => {
    const full = grid.map((_, i) => bump(60, 5, 2)[i] + bump(3000, -4, 1)[i] + bump(6000, 4, 0.8)[i])
    const r = bestFit(grid, full, bands, null)
    expect(r.eq.filters.length).toBeLessThanOrEqual(8)
    for (const f of r.eq.filters) expect(f.q).toBeLessThanOrEqual(2)
    expect(r.eq.preampDb).toBeLessThanOrEqual(-Math.max(...r.curve) + 0.2)
    expect(r.afterDb).toBeLessThan(r.beforeDb)
  })

  it('boostCap goes from 6 to 3 dB between 5 and 7 kHz', () => {
    expect(boostCap(1000)).toBe(6)
    expect(boostCap(6000)).toBeGreaterThan(3)
    expect(boostCap(6000)).toBeLessThan(6)
    expect(boostCap(9000)).toBe(3)
  })

  it('worstSpread takes the larger disagreement per band', () => {
    expect(worstSpread({ subBass: 1, air: 3 }, { subBass: 2 })).toEqual({ subBass: 2, air: 3 })
    expect(worstSpread(null, undefined)).toBeNull()
  })
})

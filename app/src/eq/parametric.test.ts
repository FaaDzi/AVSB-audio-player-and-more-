import { describe, expect, it } from 'vitest'
import { fitParametric, PARAMETRIC_20, PARAMETRIC_DEFAULTS } from './parametric'

const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))
// a bass shelf, a treble shelf and a few bumps: what a sim correction looks like
const curve = grid.map(
  (f) =>
    6 / (1 + (f / 100) ** 2) -
    3 / (1 + (10000 / f) ** 2) +
    4 * Math.exp(-((Math.log2(f / 2500) / 0.3) ** 2)) -
    3 * Math.exp(-((Math.log2(f / 6000) / 0.2) ** 2)) +
    2 * Math.exp(-((Math.log2(f / 400) / 0.6) ** 2)),
)

describe('fitParametric sweet spot (§53.4)', () => {
  const ten = fitParametric(grid, curve)
  const twenty = fitParametric(grid, curve, PARAMETRIC_20)
  it('stays within 10 filters, Q ≤ 6, ±12 dB, and starts with shelves for tilted ends', () => {
    expect(ten.filters.length).toBeLessThanOrEqual(10)
    expect(ten.filters.every((f) => f.q <= 6 && Math.abs(f.gain) <= 12)).toBe(true)
    expect(ten.filters.some((f) => f.kind === 'lowshelf')).toBe(true)
    expect(ten.filters.filter((f) => f.kind !== 'peak').every((f) => f.q <= 1)).toBe(true)
  })
  it('fits at least as closely with 20 filters', () => {
    expect(twenty.filters.length).toBeLessThanOrEqual(20)
    expect(twenty.errorDb).toBeLessThanOrEqual(ten.errorDb + 1e-9)
  })
  it('fits better with shelves than with peaks only', () => {
    const peaksOnly = fitParametric(grid, curve, { ...PARAMETRIC_DEFAULTS, shelves: false })
    expect(ten.errorDb).toBeLessThanOrEqual(peaksOnly.errorDb + 0.05)
  })
})

import { describe, expect, it } from 'vitest'
import { applyFit, DEFAULT_FIT, fitFor } from './fit'

const grid = [20, 50, 120, 500, 2000, 10000]
const flat = Float64Array.from(grid, () => 0)

describe('fit', () => {
  it('good seal leaves the curve unchanged', () => {
    expect([...applyFit(grid, flat, DEFAULT_FIT)]).toEqual([...flat])
  })

  it('faint seal lowers deep bass by ~4 dB and leaves mids/treble alone', () => {
    const out = applyFit(grid, flat, { ...DEFAULT_FIT, seal: 'faint' })
    expect(out[0]).toBeCloseTo(-4 / (1 + (20 / 120) ** 2), 6)
    expect(out[2]).toBeCloseTo(-2, 6) // half at the shelf frequency
    expect(Math.abs(out[4])).toBeLessThan(0.02)
    expect(Math.abs(out[5])).toBeLessThan(0.001)
  })

  it('a fit check only applies to the IEM it was done with (balance carries over)', () => {
    const f = { ...DEFAULT_FIT, iemId: 'a', seal: 'none' as const, balanceDb: 1.5, testedAt: 'x' }
    expect(fitFor(f, 'a').seal).toBe('none')
    expect(fitFor(f, 'b').seal).toBe('good')
    expect(fitFor(f, 'b').balanceDb).toBe(1.5)
  })
})

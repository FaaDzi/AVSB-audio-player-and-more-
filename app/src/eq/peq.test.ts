import { describe, expect, it } from 'vitest'
import { chainDb } from './biquad'
import { bandsToFilters, nextFilter, parseFilters, peqAsParametric, PEQ_MAX_FILTERS, tidyFilter } from './peq'

describe('peq', () => {
  it('keeps filters inside the editor limits', () => {
    expect(tidyFilter({ kind: 'peak', fc: 5, gain: 40, q: 0.01 })).toEqual({ kind: 'peak', fc: 20, gain: 15, q: 0.3 })
    expect(tidyFilter({ kind: 'highshelf', fc: 8123.4, gain: -3.04, q: 0.7071 })).toEqual({ kind: 'highshelf', fc: 8123, gain: -3, q: 0.71 })
  })
  it('turns the graphic bands into the same peaking filters', () => {
    const f = bandsToFilters([31, 62, 125], [3, 0, -2], 1.41)
    expect(f).toEqual([
      { kind: 'peak', fc: 31, gain: 3, q: 1.41 },
      { kind: 'peak', fc: 125, gain: -2, q: 1.41 },
    ])
  })
  it('adds a new filter in the widest gap', () => {
    const f = nextFilter([{ kind: 'peak', fc: 100, gain: 0, q: 1 }])
    expect(f.fc).toBeGreaterThan(1000) // 100 Hz → 20 kHz is the widest gap
    expect(f.gain).toBe(0)
  })
  it('sets the preamp to the largest boost', () => {
    const filters = [{ kind: 'peak' as const, fc: 1000, gain: 6, q: 1 }]
    const p = peqAsParametric(filters)
    expect(p.preampDb).toBeCloseTo(-Math.max(...chainDb(filters, [1000])), 1)
    expect(peqAsParametric([{ kind: 'peak', fc: 1000, gain: -6, q: 1 }]).preampDb).toBe(-0)
  })
  it('rejects malformed or oversized saved lists', () => {
    expect(parseFilters([{ kind: 'peak', fc: 100, gain: 2, q: 1 }])).toHaveLength(1)
    expect(parseFilters([{ kind: 'notch', fc: 100, gain: 2, q: 1 }])).toBeNull()
    expect(parseFilters(Array(PEQ_MAX_FILTERS + 1).fill({ kind: 'peak', fc: 100, gain: 0, q: 1 }))).toBeNull()
    expect(parseFilters('x')).toBeNull()
  })
})

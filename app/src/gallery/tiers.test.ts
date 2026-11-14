import { describe, expect, it } from 'vitest'
import { chainDb } from '../eq/biquad'
import { fitParametric, PARAMETRIC_DEFAULTS } from '../eq/parametric'
import { tierOf, TIER_MAX_FILTERS } from './gallery'

const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))

describe('custom EQ tiers (§54.2)', () => {
  it('reads the tier from the custom EQ', () => {
    expect(tierOf({})).toBe('basic')
    expect(tierOf({ filters: [] })).toBe('advanced')
    expect(tierOf({ filters: [], tier: 'advanced+' })).toBe('advanced+')
    expect(TIER_MAX_FILTERS).toEqual({ advanced: 10, 'advanced+': 20 })
  })
  it('refits 20 filters into the 10 Advanced takes, keeping the curve close', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ kind: 'peak' as const, fc: Math.round(30 * 1.4 ** i), gain: i % 2 ? 2 : -2, q: 1.5 }))
    const curve = chainDb(twenty, grid)
    const ten = fitParametric(grid, curve, { ...PARAMETRIC_DEFAULTS, maxFilters: 10, fMax: 16000 })
    expect(ten.filters.length).toBeLessThanOrEqual(10)
    expect(ten.errorDb).toBeLessThan(1.5)
  })
})

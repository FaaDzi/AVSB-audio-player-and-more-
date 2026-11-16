import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { autoEq, CANAL_PEAK_HZ, curveAt, depthCurve, missDb, NO_PREFS, prefCurve, TUNE_STEP_DB, tuneAt } = await import('./eqStudio')
const { chainDb } = await import('../eq/biquad')

const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))

describe('EQ tab maths (plan §84)', () => {
  it('AutoEQ brings a device with a bass hump and a treble peak close to a flat target', () => {
    const device = chainDb([{ kind: 'lowshelf', fc: 120, gain: 6, q: 0.7 }, { kind: 'peak', fc: 5000, gain: 7, q: 2 }], grid)
    const target = new Float64Array(grid.length)
    const want = Float64Array.from(device, (v) => -v)
    const r = autoEq({ grid, device, target, want }, 8)!
    expect(r.beforeDb).toBeGreaterThan(2)
    expect(r.afterDb).toBeLessThan(0.8)
    expect(r.filters.length).toBeLessThanOrEqual(8)
    expect(r.preamp).toBeLessThanOrEqual(0)
    expect(autoEq({ grid, device, target: null, want: null })).toBeNull()
  })

  it('preferences move the target where their names say', () => {
    const p = prefCurve(grid, { ...NO_PREFS, bass: 4, earGain: -3 })
    expect(curveAt(grid, p, 40)).toBeGreaterThan(3)
    expect(curveAt(grid, p, 2750)).toBeCloseTo(-3, 0)
    expect(Math.abs(curveAt(grid, p, 12000))).toBeLessThan(0.5)
    expect(curveAt(grid, prefCurve(grid, { ...NO_PREFS, tilt: -1 }), 4000)).toBeCloseTo(-2, 1)
  })

  it('a deeper fit moves the canal peak up, a shallow one down, and normal changes nothing', () => {
    expect(depthCurve(grid, 'normal').every((v) => v === 0)).toBe(true)
    const deep = depthCurve(grid, 'deep')
    expect(curveAt(grid, deep, CANAL_PEAK_HZ.deep)).toBeGreaterThan(2)
    expect(curveAt(grid, deep, CANAL_PEAK_HZ.normal)).toBeLessThan(-2)
    expect(curveAt(grid, depthCurve(grid, 'shallow'), CANAL_PEAK_HZ.shallow)).toBeGreaterThan(2)
    expect(Math.abs(curveAt(grid, deep, 1000))).toBeLessThan(0.3)
  })

  it('"too loud" adds a narrow cut, the same spot again deepens it, and undoing it removes the filter', () => {
    const one = tuneAt([], 6000, -TUNE_STEP_DB)!
    expect(one).toMatchObject([{ kind: 'peak', fc: 6000, gain: -1.5 }])
    const two = tuneAt(one, 6300, -TUNE_STEP_DB)!
    expect(two).toHaveLength(1)
    expect(two[0].gain).toBe(-3)
    expect(tuneAt(two, 9000, TUNE_STEP_DB)).toHaveLength(2) // elsewhere: its own filter
    expect(tuneAt(one, 6000, TUNE_STEP_DB)).toEqual([])
    // broad filters (AutoEQ's) are left alone: the ear found something narrower
    const broad = [{ kind: 'peak' as const, fc: 6000, gain: -4, q: 1 }]
    expect(tuneAt(broad, 6000, -TUNE_STEP_DB)).toHaveLength(2)
    const full = Array.from({ length: 20 }, (_, i) => ({ kind: 'peak' as const, fc: 50 + i * 10, gain: 1, q: 1 }))
    expect(tuneAt(full, 6000, -TUNE_STEP_DB)).toBeNull()
  })

  it('missDb ignores a plain level difference', () => {
    const a = grid.map(() => 3)
    expect(missDb(grid, a, grid.map(() => -5))).toBeCloseTo(0)
  })
})

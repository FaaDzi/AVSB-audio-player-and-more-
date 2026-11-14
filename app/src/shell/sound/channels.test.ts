import { describe, expect, it } from 'vitest'
import { bandCurves, combineRuns, NO_CHANGE, runSpread } from './channels'

describe('channel balance (§78 E)', () => {
  it('averages two runs band by band and takes their median as the overall offset', () => {
    const r = combineRuns([1, 2, 2, 3, 1, 0], [1, 1, 2, 2, 2, 1])
    expect(r.bands).toEqual([1, 1.5, 2, 2.5, 1.5, 0.5])
    expect(r.balanceDb).toBe(1.5)
  })

  it('reports how far the runs disagree', () => {
    expect(runSpread([0, 0, 4], [0, 1, 0])).toBe(4)
  })

  it('splits what differs per band into left and right halves, only when asked', () => {
    const c = { ...NO_CHANGE, balanceDb: 1, bands: [1, 1, 1, 3, 1, -1] }
    expect(bandCurves(c)).toBeNull()
    const curves = bandCurves({ ...c, perBand: true })!
    expect(curves.right).toEqual([0, 0, 0, 1, 0, -1])
    expect(curves.left).toEqual([-0, -0, -0, -1, -0, 1])
  })

  it('leaves the curves out when every band matches the overall offset', () => {
    expect(bandCurves({ ...NO_CHANGE, balanceDb: 2, bands: [2, 2, 2, 2, 2, 2], perBand: true })).toBeNull()
  })
})

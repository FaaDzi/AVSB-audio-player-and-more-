import { describe, expect, it } from 'vitest'
import { matchScore, similarGroup } from './similar'

const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))
const base = grid.map((f) => (f < 200 ? 6 : 0) + (f > 2000 && f < 4000 ? 8 : 0))

describe('find similar (§106 C)', () => {
  it('the same curve, or the same curve louder, scores ~100', () => {
    expect(matchScore(grid, base, base)).toBeGreaterThan(99.9)
    expect(matchScore(grid, base, base.map((v) => v + 5))).toBeGreaterThan(99.9)
  })
  it('a small wiggle still scores high, a different tuning scores low', () => {
    const near = base.map((v, i) => v + 0.5 * Math.sin(i / 7))
    const far = grid.map((f) => (f < 200 ? -4 : 0) + (f > 2000 ? -6 : 0))
    expect(matchScore(grid, base, near)).toBeGreaterThan(90)
    expect(matchScore(grid, base, far)).toBeLessThan(40)
  })
  it('above 10 kHz counts for nothing', () => {
    const treble = base.map((v, i) => v + (grid[i] > 10500 ? 12 : 0))
    expect(matchScore(grid, base, treble)).toBeGreaterThan(98)
  })
  it('headphones only meet the same back; semi-open is open', () => {
    const hp = (back?: 'open' | 'semi-open' | 'closed') => similarGroup({ kind: 'headphones', members: [{ back } as never] })
    expect(hp('open')).toBe(hp('semi-open'))
    expect(hp('open')).not.toBe(hp('closed'))
    expect(similarGroup({ kind: 'tws', members: [] })).not.toBe(similarGroup({ kind: 'iems', members: [] }))
  })
})

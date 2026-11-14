import { describe, expect, it } from 'vitest'
import { buildBracket, entrantsOf, nextMatch, type MatchResult } from './bracket'
import { bracketConfidence, tuningGapDb } from './confidence'

const flat = { subBass: 0, midBass: 0, lowerMids: 0, upperMids: 0, lowerTreble: 0, air: 0 }
// seed n gets n dB of bass: every pair is ≥ 1 dB apart
const metricsOf = (id: string) => ({ metrics: { ...flat, subBass: Number(id.slice(1)) } })
const entrants = ['s1', 's2', 's3', 's4']

/** Play a 4-bracket; `pick` chooses the winner and the score of each match. */
function play(pick: (x: number, y: number, bestOf: number) => MatchResult) {
  const b = buildBracket(4)
  const results: Record<string, MatchResult> = {}
  for (let m = nextMatch(b, results); m; m = nextMatch(b, results)) {
    const [x, y] = entrantsOf(b, m, results) as [number, number]
    results[m.id] = pick(x, y, m.bestOf)
  }
  return { b, results }
}

describe('bracketConfidence', () => {
  it('clean sweeps by the better seed read as solid', () => {
    const { b, results } = play((x, y, bo) => {
      const need = Math.floor(bo / 2) + 1
      return x < y ? { winner: 0, wins: [need, 0] } : { winner: 1, wins: [0, need] }
    })
    const c = bracketConfidence(b, results, entrants, metricsOf)
    expect(c.level).toBe('solid')
    expect(c.flips).toBe(0)
    expect(c.split).toBe(0)
  })

  it('a rematch that flips and split rounds make it shaky', () => {
    const met = new Set<string>()
    const { b, results } = play((x, y, bo) => {
      const key = [x, y].sort().join()
      const first = !met.has(key)
      met.add(key)
      const need = Math.floor(bo / 2) + 1
      // better seed wins the first meeting, loses any rematch; every best-of goes the distance
      const winner = (first ? (x < y ? 0 : 1) : x < y ? 1 : 0) as 0 | 1
      const wins: [number, number] = winner === 0 ? [need, need - 1] : [need - 1, need]
      return { winner, wins }
    })
    const c = bracketConfidence(b, results, entrants, metricsOf)
    expect(c.rematches).toBeGreaterThan(0)
    expect(c.flips).toBeGreaterThan(0)
    expect(c.level).toBe('shaky')
  })

  it('flags near-identical tunings', () => {
    expect(tuningGapDb({ metrics: flat }, { metrics: { ...flat, air: 0.6 } })).toBeCloseTo(0.6)
    const { b, results } = play((x, y) => (x < y ? { winner: 0, wins: [2, 0] } : { winner: 1, wins: [0, 2] }))
    const c = bracketConfidence(b, results, entrants, () => ({ metrics: flat }))
    expect(c.nearIdentical).toBe(c.matches)
    expect(c.level).not.toBe('solid')
  })
})

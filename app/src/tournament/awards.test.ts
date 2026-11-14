import { describe, expect, it } from 'vitest'
import { computeAwards, pickTier } from './awards'
import { buildBracket, entrantsOf, nextMatch, type MatchResult } from './bracket'

/** Play a bracket: the lower seed wins every match without dropping a song, unless `play` says otherwise. */
function playOut(size: number, play: (a: number, b: number, id: string, bestOf: number) => MatchResult | null = () => null) {
  const b = buildBracket(size)
  const results: Record<string, MatchResult> = {}
  for (let m = nextMatch(b, results); m; m = nextMatch(b, results)) {
    const [x, y] = entrantsOf(b, m, results) as [number, number]
    const need = Math.floor(m.bestOf / 2) + 1
    const fav = x < y ? 0 : 1
    results[m.id] = play(x, y, m.id, m.bestOf) ?? { winner: fav as 0 | 1, wins: fav === 0 ? [need, 0] : [0, need] }
  }
  return { b, results }
}
const noPrice = { priceOf: () => null }

describe('pick rate tiers', () => {
  it('100 / 95 / 90 %, and nothing below or on too few songs', () => {
    expect(pickTier(10, 10)).toBe('flawless')
    expect(pickTier(19, 20)).toBe('dominating')
    expect(pickTier(9, 10)).toBe('favourite')
    expect(pickTier(8, 10)).toBeNull()
    expect(pickTier(3, 3)).toBeNull()
  })
})

describe('awards', () => {
  it('chalk bracket: the champion is flawless, nobody came back, no dark horse or heartbreak', () => {
    const { b, results } = playOut(8)
    const a = computeAwards(b, results, 8, noPrice)
    expect(a.pickRate).toMatchObject({ seed: 1, tier: 'flawless' })
    expect(a.comeback).toBeNull()
    expect(a.darkHorse).toBeNull()
    expect(a.heartbreak).toBeNull()
    expect(a.goliath).toBeNull()
  })

  it('a seed that drops to the lower bracket and wins the final is a perfect comeback', () => {
    // seed 8 loses its first match, then wins everything after it
    const { b, results } = playOut(8, (x, y, id, bestOf) => {
      if (x !== 8 && y !== 8) return null
      const need = Math.floor(bestOf / 2) + 1
      const eight = x === 8 ? 0 : 1
      const win = id !== 'U1-1' && id.startsWith('U1') === false
      const w = (win ? eight : 1 - eight) as 0 | 1
      return { winner: w, wins: w === 0 ? [need, need - 1] : [need - 1, need] }
    })
    const a = computeAwards(b, results, 8, noPrice)
    const champ = entrantsOf(b, b.matches.find((m) => m.id === 'GF')!, results)[results.GF.winner]
    if (champ === 8) expect(a.comeback).toMatchObject({ seed: 8, tier: 'perfect' })
    expect(a.darkHorse?.seed).toBe(8)
    // every one of seed 8's matches went the distance: the final's loser is the heartbreak
    expect(a.heartbreak).not.toBeNull()
  })

  it('random seeds (hidden names) give no dark horse', () => {
    const { b, results } = playOut(4, (x, y, _id, bestOf) => {
      const need = Math.floor(bestOf / 2) + 1
      const w = (x > y ? 0 : 1) as 0 | 1 // the higher seed number always wins
      return { winner: w, wins: w === 0 ? [need, 0] : [0, need] }
    })
    expect(computeAwards(b, results, 4, noPrice).darkHorse?.seed).toBe(4)
    expect(computeAwards(b, results, 4, { ...noPrice, randomSeeds: true }).darkHorse).toBeNull()
  })

  it('goliath: the cheaper IEM beating the dearer one by the most', () => {
    const prices = [0, 500, 400, 300, 50]
    const { b, results } = playOut(4, (x, y, _id, bestOf) => {
      const need = Math.floor(bestOf / 2) + 1
      const w = (x > y ? 0 : 1) as 0 | 1
      return { winner: w, wins: w === 0 ? [need, 0] : [0, need] }
    })
    const a = computeAwards(b, results, 4, { priceOf: (s) => prices[s] })
    expect(a.goliath).toMatchObject({ seed: 4, price: 50, beatPrice: 500 })
  })
})

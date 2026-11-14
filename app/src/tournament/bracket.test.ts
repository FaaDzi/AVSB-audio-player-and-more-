import { describe, expect, it } from 'vitest'
import { buildBracket, entrantsOf, isComplete, nextMatch, placings, seedOrder, type MatchResult, playedIds } from './bracket'

/** Play a whole bracket, lower seed number always wins unless `upset` says otherwise. */
function playOut(size: number, upset: (a: number, b: number, id: string) => boolean = () => false) {
  const b = buildBracket(size)
  const results: Record<string, MatchResult> = {}
  const played: string[] = []
  const seen = new Map<string, number>()
  for (let m = nextMatch(b, results); m; m = nextMatch(b, results)) {
    const [x, y] = entrantsOf(b, m, results) as [number, number]
    const key = [x, y].sort().join('-')
    seen.set(key, (seen.get(key) ?? 0) + 1)
    const favourite = x < y ? 0 : 1
    const winner = (upset(x, y, m.id) ? 1 - favourite : favourite) as 0 | 1
    const need = Math.floor(m.bestOf / 2) + 1
    results[m.id] = { winner, wins: winner === 0 ? [need, 0] : [0, need] }
    played.push(m.id)
  }
  return { b, results, played, seen }
}

describe('seedOrder', () => {
  it('keeps seeds 1 and 2 apart until the final', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })
})

describe('double elimination', () => {
  for (const n of [4, 8, 16]) {
    it(`${n} entrants: 2N−2 matches, everyone plays, ends with a grand final`, () => {
      const { b, results, played } = playOut(n)
      expect(b.matches).toHaveLength(2 * n - 2)
      expect(played).toHaveLength(2 * n - 2)
      expect(played.at(-1)).toBe('GF')
      expect(isComplete(b, results)).toBe(true)
      expect(b.matches.find((m) => m.id === 'GF')!.bestOf).toBe(5)
      expect(b.matches.filter((m) => m.id !== 'GF').every((m) => m.bestOf === 3)).toBe(true)
    })

    it(`${n} entrants: everyone outside the final is out after exactly two losses`, () => {
      const { b, results } = playOut(n, (a, c, id) => (a + c + id.length) % 3 === 0)
      const losses = new Map<number, number>()
      for (const m of b.matches) {
        const [x, y] = entrantsOf(b, m, results) as [number, number]
        const loser = results[m.id].winner === 0 ? y : x
        losses.set(loser, (losses.get(loser) ?? 0) + 1)
      }
      const [first, second] = placings(b, results)
      const champion = first.seeds[0]
      const runnerUp = second.seeds[0]
      for (let s = 1; s <= n; s++) {
        if (s === champion || s === runnerUp) continue
        expect(losses.get(s) ?? 0, `seed ${s}`).toBe(2)
      }
      // no bracket reset: the champion has at most one loss, the runner-up one or two
      expect(losses.get(champion) ?? 0).toBeLessThanOrEqual(1)
      expect([1, 2]).toContain(losses.get(runnerUp))
    })

    it(`${n} entrants: placings cover every entrant once`, () => {
      const { b, results } = playOut(n)
      const all = placings(b, results).flatMap((p) => p.seeds).sort((a, c) => a - c)
      expect(all).toEqual(Array.from({ length: n }, (_, i) => i + 1))
    })
  }

  it('favourites win → seed 1 champion, seed 2 runner-up, no matches played before they are ready', () => {
    const { b, results } = playOut(8)
    const p = placings(b, results)
    expect(p[0]).toEqual({ place: '1st', seeds: [1] })
    expect(p[1]).toEqual({ place: '2nd', seeds: [2] })
    expect(p[2].place).toBe('3rd')
  })

  it('lower-bracket team can win the grand final (no reset)', () => {
    const { b, results } = playOut(4, (_a, _c, id) => id === 'GF')
    expect(results.GF.winner).toBe(1)
    expect(placings(b, results)[0].seeds[0]).not.toBe(1)
  })
})

describe('mystery reveal', () => {
  it('only IEMs that have played a finished match are unmasked', () => {
    const b = buildBracket(8)
    const entrants = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(playedIds(b, {}, entrants).size).toBe(0)
    const first = b.matches.find((m) => m.playOrder === 1)!
    const shown = playedIds(b, { [first.id]: { winner: 0, wins: [2, 0] } }, entrants)
    expect([...shown].sort()).toEqual(['a', 'h'])
  })
})

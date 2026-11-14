import { describe, expect, it } from 'vitest'
import { champion, currentPair, pick, shuffled, startKnockout, totalPicks, twoRounds } from './knockout'

/** Deterministic "random" that never reorders (j = i every step of Fisher–Yates). */
const keep = () => 0.999999

describe('HRTF knockout', () => {
  it('shuffles without losing or duplicating entries', () => {
    let s = 1
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const out = shuffled(['a', 'b', 'c', 'd', 'e'], rand)
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(shuffled(['a', 'b', 'c'], keep)).toEqual(['a', 'b', 'c'])
  })

  it('meets neighbours in order, then the winners, in n − 1 picks', () => {
    let k = startKnockout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], keep)
    const seen: string[] = []
    // the first-listed entrant always wins
    while (currentPair(k)) {
      const p = currentPair(k)!
      seen.push(p.join(''))
      k = pick(k, p[0])
    }
    expect(seen).toEqual(['ab', 'cd', 'ef', 'gh', 'ac', 'eg', 'ae'])
    expect(champion(k)).toBe('a')
    expect(k.picks).toBe(totalPicks(8))
  })

  it('gives the odd one out a bye', () => {
    let k = startKnockout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], keep)
    const seen: string[] = []
    while (currentPair(k)) {
      const p = currentPair(k)!
      seen.push(p.join(''))
      k = pick(k, p[1])
    }
    // round 1: ab cd ef gh, i has a bye → b d f h i; round 2: bd fh, i bye → d h i; round 3: dh, i bye → h i
    expect(seen).toEqual(['ab', 'cd', 'ef', 'gh', 'bd', 'fh', 'dh', 'hi'])
    expect(champion(k)).toBe('i')
    expect(k.picks).toBe(8)
  })

  it('ignores a pick that is not in the current pair, and handles tiny brackets', () => {
    const k = startKnockout(['a', 'b', 'c'], keep)
    expect(pick(k, 'c')).toBe(k)
    expect(champion(startKnockout(['solo']))).toBe('solo')
    expect(currentPair(startKnockout([]))).toBeNull()
    expect(champion(startKnockout(['x', 'x']))).toBe('x')
  })
})

describe('two rounds over grouped sets', () => {
  const entries = [
    { id: 'generic', group: 'generic' },
    { id: 'a', group: 'generic' },
    { id: 'b', group: 'b' },
    { id: 'c', group: 'b' },
    { id: 'imported' },
  ]
  it('round 1 is the heads (an ungrouped set is its own head), round 2 the winner’s group', () => {
    const r = twoRounds(entries)
    expect(r.heads).toEqual(['generic', 'b', 'imported'])
    expect(r.members('b')).toEqual(['b', 'c'])
    expect(r.members('imported')).toEqual(['imported'])
  })
  it('a group pointing at a set that is not offered makes that set its own head', () => {
    expect(twoRounds([{ id: 'x', group: 'gone' }]).heads).toEqual(['x'])
  })
})

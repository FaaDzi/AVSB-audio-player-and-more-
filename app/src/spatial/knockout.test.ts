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

describe('the HRTF test (§108: runner-up group, final check, Same as a tie)', async () => {
  const { answerHrtf, hrtfPair, hrtfProgress, startHrtfTest } = await import('./knockout')
  const noShuffle = () => 0.999
  // 4 groups of 4: heads a, b, c, d
  const groups: Record<string, string[]> = { a: ['a', 'a2', 'a3', 'a4'], b: ['b', 'b2', 'b3', 'b4'], c: ['c', 'c2', 'c3', 'c4'], d: ['d', 'd2', 'd3', 'd4'] }
  const plan = { heads: ['a', 'b', 'c', 'd'], members: (h: string) => groups[h] }
  /** Answers every pair by a fixed preference order (earlier in `rank` wins). */
  const run = (rank: string[], sameOnce?: [string, string]) => {
    let t = startHrtfTest(plan, noShuffle)
    let usedSame = false
    for (let i = 0; i < 30 && !t.winner; i++) {
      const p = hrtfPair(t)!
      const same = !usedSame && sameOnce && p.includes(sameOnce[0]) && p.includes(sameOnce[1])
      if (same) usedSame = true
      t = answerHrtf(t, same ? null : rank.indexOf(p[0]) <= rank.indexOf(p[1]) ? p[0] : p[1], plan, noShuffle)
    }
    return t
  }

  it('takes 8 picks for a steady listener and finds their favourite', () => {
    const rank = ['b3', 'b', 'a', 'a2', 'c', 'd', 'b2', 'b4', 'a3', 'a4', 'c2', 'c3', 'c4', 'd2', 'd3', 'd4']
    const t = run(rank)
    expect(t.winner).toBe('b3')
    expect(hrtfProgress(t, plan)).toEqual({ done: 8, of: 8 })
  })

  it('lets the runner-up group head win when it beats the winning group (a close round 1)', () => {
    // round 1: b just beats a in the final (a and b seeded apart); afterwards a is preferred over b's whole group
    const seeded = { ...plan, heads: ['a', 'c', 'b', 'd'] }
    let t = startHrtfTest(seeded, noShuffle)
    for (let i = 0; i < 30 && !t.winner; i++) {
      const p = hrtfPair(t)!
      const choice = t.round === 1 ? (p.includes('b') ? 'b' : p.includes('a') ? 'a' : p[0]) : p.includes('a') ? 'a' : p[0]
      t = answerHrtf(t, choice, seeded, noShuffle)
    }
    expect(t.winner).toBe('a')
  })

  it('the final check takes the best of three when the listener changes their mind', () => {
    let t = startHrtfTest(plan, noShuffle)
    let finalAnswers = 0
    for (let i = 0; i < 30 && !t.winner; i++) {
      const p = hrtfPair(t)!
      // until the final, always the first; in the final: the rival, then the champion again
      const choice = t.final ? (finalAnswers++ === 0 ? t.final.rival : t.final.champ) : p[0]
      t = answerHrtf(t, choice, plan, noShuffle)
    }
    expect(t.final!.asked).toBe(3)
    expect(t.winner).toBe(t.final!.champ)
    expect(hrtfProgress(t, plan).done).toBe(9)
  })

  it('a "Same" in round 2 makes the tied set the rival in the final check', () => {
    let t = startHrtfTest(plan, noShuffle)
    let tied: [string, string] | null = null
    for (let i = 0; i < 30 && !t.winner; i++) {
      const p = hrtfPair(t)!
      if (t.round === 2 && !tied) {
        tied = p
        t = answerHrtf(t, null, plan, noShuffle)
      } else t = answerHrtf(t, t.final ? t.final.champ : p[0], plan, noShuffle)
    }
    expect(tied).not.toBeNull()
    if (t.final && t.final.champ === tied![0]) expect(t.final.rival).toBe(tied![1])
    expect(t.winner).not.toBeNull()
  })
})

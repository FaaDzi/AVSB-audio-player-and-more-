import { describe, expect, it } from 'vitest'
import { pickClip } from './fireWipe'
import { channelTable } from './vsLinesColors'

describe('pickClip', () => {
  it('never repeats the last burst and reaches every other one', () => {
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    let last = -1
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = pickClip(9, last, rand)
      expect(n).not.toBe(last)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(9)
      seen.add(n)
      last = n
    }
    expect(seen.size).toBe(9)
  })

  it('covers both ends of the range', () => {
    expect(pickClip(9, -1, () => 0)).toBe(0)
    expect(pickClip(9, -1, () => 0.9999)).toBe(8)
    expect(pickClip(9, 8, () => 0.9999)).toBe(7)
    expect(pickClip(9, 0, () => 0)).toBe(1)
    expect(pickClip(1, 0)).toBe(0)
  })
})

describe('VS speed line colours', () => {
  it('maps grey 0 to the light background and 1 to the dark streak', () => {
    // IEM: #ffe27a background, #b86e00 streaks
    expect(channelTable('iems', 0)).toBe('1.000 0.722')
    expect(channelTable('iems', 2)).toBe('0.478 0.000')
  })
})

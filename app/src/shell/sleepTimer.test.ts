import { describe, expect, it } from 'vitest'
import { countSong, sleepLabel, sleepStep, SLEEP_FADE_S } from './sleepTimer'

describe('sleep timer', () => {
  it('fades out in the last seconds of a timed stop, and lets an old one lapse', () => {
    const t = { kind: 'time' as const, endsAt: 100_000 }
    expect(sleepStep(t, 100_000 - (SLEEP_FADE_S + 5) * 1000, 60)).toBeNull()
    expect(sleepStep(t, 100_000 - 8000, 60)).toBe(8)
    expect(sleepStep(t, 100_000 + 10_000, 60)).toBe('expired')
  })

  it('stops at the end of the song only once no songs are left to count', () => {
    let t = countSong({ kind: 'songs', left: 1, songId: 'a' }, 'a')
    expect(sleepStep(t, 0, 2)).toBeNull()
    t = countSong(t, 'b')
    expect(t).toEqual({ kind: 'songs', left: 0, songId: 'b' })
    expect(sleepStep(t, 0, 30)).toBeNull()
    expect(sleepStep(t, 0, 3)).toBeCloseTo(2.6)
    expect(sleepLabel(t, 0)).toBe('End of song')
  })
})

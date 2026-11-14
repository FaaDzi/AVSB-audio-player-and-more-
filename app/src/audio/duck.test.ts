import { describe, expect, it } from 'vitest'
import { holdMusic, musicHeld, onMusicHold } from './duck'

describe('music hold', () => {
  it('reports the first hold and the last release only', () => {
    const seen: boolean[] = []
    const off = onMusicHold((h) => seen.push(h))
    const a = holdMusic()
    const b = holdMusic()
    expect(musicHeld()).toBe(true)
    a()
    a() // a second release of the same hold does nothing
    expect(musicHeld()).toBe(true)
    b()
    expect(musicHeld()).toBe(false)
    expect(seen).toEqual([true, false])
    off()
  })
})

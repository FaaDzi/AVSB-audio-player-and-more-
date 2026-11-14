import { describe, expect, it } from 'vitest'
import { autoplayScore, pickAutoplay, soundLikeness, type AutoplayInputs } from './autoplay'
import type { Track } from './library'

const song = (id: string, extra: Partial<Track> = {}) => ({ id, artist: '', album: '', genre: '', ...extra }) as Track
const inputs: AutoplayInputs = { features: () => undefined, learned: {}, personal: false }

describe('autoplay', () => {
  it('prefers the same artist and genre', () => {
    const now = song('now', { artist: 'A', genre: 'Rock' })
    expect(autoplayScore(song('x', { artist: 'A' }), now, inputs)).toBeGreaterThan(autoplayScore(song('y', { genre: 'Rock' }), now, inputs))
    expect(autoplayScore(song('y', { genre: 'Rock' }), now, inputs)).toBeGreaterThan(autoplayScore(song('z'), now, inputs))
  })
  it('only uses taste once personal, and skips count against a song', () => {
    const learned = { x: { plays: 0, skips: 3 } }
    expect(autoplayScore(song('x'), song('now'), { ...inputs, learned })).toBe(0)
    expect(autoplayScore(song('x'), song('now'), { ...inputs, learned, personal: true })).toBeLessThan(0)
  })
  it('scores alike songs higher, and half time as close', () => {
    const a = { tempo: 120, brightness: 0.3, energy: -14 }
    expect(soundLikeness(a, a)).toBe(1)
    expect(soundLikeness(a, { ...a, tempo: 60 })).toBeCloseTo(1, 5)
    expect(soundLikeness(a, { tempo: 87, brightness: 0.8, energy: -30 })).toBeLessThan(0.4)
  })
  it('picks from the best few', () => {
    const others = [song('good', { artist: 'A' }), ...Array.from({ length: 30 }, (_, i) => song(`s${i}`))]
    expect(pickAutoplay(others, song('now', { artist: 'A' }), inputs, () => 0).id).toBe('good')
  })
})

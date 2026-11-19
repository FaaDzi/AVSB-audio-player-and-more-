import { describe, expect, it } from 'vitest'
import { asState, stamp } from './playlistSync'
import { isPremiumQuality } from './library'

describe('playlist covers sync (§89 D)', () => {
  it('keeps a small image cover, drops anything else, and a new cover counts as an edit', () => {
    const img = 'data:image/jpeg;base64,AAAA'
    const s = asState({ lists: [{ id: 'a', name: 'A', tracks: [], cover: img }, { id: 'b', name: 'B', tracks: [], cover: 'javascript:x' }, { id: 'c', name: 'C', tracks: [], cover: `data:image/jpeg;base64,${'A'.repeat(300_000)}` }], deleted: {} })
    expect(s?.lists.map((p) => p.cover)).toEqual([img, undefined, undefined])
    const before = [{ id: 'a', name: 'A', tracks: [], updated: 5 }]
    expect(stamp(before, [{ ...before[0], cover: img }], {}, 9).lists[0].updated).toBe(9)
  })
})

describe('the light-blue quality pill (§89)', () => {
  it('marks 24-bit, hi-res rates and Dolby, not CD or MP3', () => {
    expect(isPremiumQuality({ lossy: false, bits: 24, rate: 44100, format: 'FLAC' })).toBe(true)
    expect(isPremiumQuality({ lossy: false, bits: 16, rate: 96000, format: 'FLAC' })).toBe(true)
    expect(isPremiumQuality({ lossy: true, bits: 0, rate: 48000, format: 'EAC3' })).toBe(true)
    expect(isPremiumQuality({ lossy: false, bits: 16, rate: 44100, format: 'FLAC' })).toBe(false)
    expect(isPremiumQuality({ lossy: true, bits: 0, rate: 44100, format: 'MP3' })).toBe(false)
  })
})

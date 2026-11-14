import { describe, expect, it } from 'vitest'
import { pickLyrics, plainTitle, rankLyrics, titleAgrees, titleGuesses } from './onlineLyrics'

describe('titleAgrees', () => {
  it('takes a song known by another name when the artist agrees', () => {
    const song = { title: 'THE END OF HATSUNE MIKU - cosMo@Bousou-P', artist: '' }
    expect(titleAgrees({ trackName: 'The Disappearance of Hatsune Miku -DEAD END-', artistName: 'cosMo feat. Hatsune Miku' }, 'THE END OF HATSUNE MIKU', song)).toBe(true)
  })
  it('takes a cover by its title', () => {
    expect(titleAgrees({ trackName: 'phony', artistName: 'Will Stetson' }, 'Phony', { title: 'フォニイ (Phony) [6+α chorus]', artist: 'arian' })).toBe(true)
  })
  it('refuses a record that only shares the length', () => {
    expect(titleAgrees({ trackName: 'Kembalilah', artistName: 'Anima' }, 'Anima', { title: 'Anima', artist: 'XI' })).toBe(false)
    expect(titleAgrees({ trackName: 'Nightcore - Schwerelos', artistName: 'Nightcore' }, 'Witchcraft', { title: 'Witchcraft (Nightcore)', artist: 'Pendulum' })).toBe(false)
  })
})

describe('titleGuesses', () => {
  it('tries the bare title and the name in brackets, skipping edition notes', () => {
    expect(titleGuesses({ title: 'フォニイ (Phony) [6+α chorus]', artist: 'arian' })).toEqual(['フォニイ', 'Phony'])
    expect(titleGuesses({ title: 'Grievous Lady (Laur Remix)', artist: 'Laur' })).toEqual(['Grievous Lady'])
  })
  it('takes the artist off a title when the artist tag is empty', () => {
    expect(titleGuesses({ title: 'THE END OF HATSUNE MIKU - cosMo@Bousou-P', artist: '' })).toEqual(['THE END OF HATSUNE MIKU'])
    expect(titleGuesses({ title: 'BUNRETSU - HAKAI', artist: 'cosMo' })).toEqual(['BUNRETSU - HAKAI'])
  })
})

describe('plainTitle', () => {
  it('drops edition notes and keeps the rest', () => {
    expect(plainTitle('Fields Of Gold (Songbird 2023 Remaster)')).toBe('Fields Of Gold')
    expect(plainTitle('Bitch, Don’t Kill My Vibe (International Remix / Explicit Version)')).toBe('Bitch, Don’t Kill My Vibe')
    expect(plainTitle('Song (feat. Someone) [Live]')).toBe('Song')
    expect(plainTitle('(Untitled)')).toBe('(Untitled)')
  })
})

describe('rankLyrics (plan §76 C)', () => {
  // LRCLIB's uploads of Sabaton "82nd All the Way" (checked 2026-11-12): album cuts at 211 s, the history edition's
  // spoken-intro cut at 228 s, and one 211 s upload carrying the history edition's timing (first line at 19.12)
  const lrc = (first: number) => `[00:${first.toFixed(2).padStart(5, '0')}] In the draft of 1917, a man from Tennessee`
  const sabaton = [
    { duration: 228, syncedLyrics: lrc(34.39) },
    { duration: 211, syncedLyrics: lrc(19.12) },
    { duration: 211, syncedLyrics: lrc(17.26) },
    { duration: 211, syncedLyrics: lrc(17.26) },
    { duration: 211.2, syncedLyrics: lrc(17.26) },
    { duration: 212, syncedLyrics: lrc(17.36) },
  ]
  it('takes the closest length and the timing most uploads agree on, not the first upload', () => {
    expect(pickLyrics(sabaton, 211)).toBe(lrc(17.26))
    expect(pickLyrics(sabaton, 228, 15)).toBe(lrc(34.39))
  })
  it('prefers an upload without blanked-out words', () => {
    const masked = { duration: 200, syncedLyrics: '[00:10.00] I told you **** quit' }
    const clean = { duration: 200, syncedLyrics: '[00:10.00] I told you nigga quit' }
    expect(pickLyrics([masked, clean], 200)).toBe(clean.syncedLyrics)
  })
  it('lists every usable version for "Try another version"', () => {
    expect(rankLyrics(sabaton, 211).length).toBe(5)
  })
})

describe('pickLyrics', () => {
  it('prefers synced lyrics and falls back to plain', () => {
    expect(pickLyrics([{ duration: 200, syncedLyrics: 'synced', plainLyrics: 'plain' }], 200)).toBe('synced')
    expect(pickLyrics([{ duration: 200, syncedLyrics: null, plainLyrics: 'plain' }], 200)).toBe('plain')
  })
  it('rejects a different length, beyond 10 seconds', () => {
    expect(pickLyrics([{ duration: 200, plainLyrics: 'x' }], 211)).toBeNull()
    expect(pickLyrics([{ duration: 200, plainLyrics: 'x' }], 209)).toBe('x')
  })
  it('skips instrumentals and takes the next usable record', () => {
    expect(pickLyrics([{ instrumental: true, plainLyrics: 'x' }, { plainLyrics: 'y' }], 100)).toBe('y')
    expect(pickLyrics([], 100)).toBeNull()
  })
})

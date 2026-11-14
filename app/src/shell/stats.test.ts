import { describe, expect, it } from 'vitest'
import { addListen, countsAsPlayed, topArtists, type Listening } from './stats'
import type { Track } from './library'

const empty: Listening = { songs: {}, history: [], learned: {}, autoplayed: 0 }
const listen = { id: 'a', heard: 40, length: 200, finished: false, viaAutoplay: false, learning: true, at: 1 }

describe('listening statistics', () => {
  it('counts a song after 30 seconds, or half of a short one', () => {
    expect(countsAsPlayed(30, 200)).toBe(true)
    expect(countsAsPlayed(29, 200)).toBe(false)
    expect(countsAsPlayed(21, 40)).toBe(true)
  })
  it('records a play in the history and a skip outside it', () => {
    const played = addListen(empty, listen)
    expect(played.songs.a).toMatchObject({ plays: 1, skips: 0, heard: 40 })
    expect(played.history).toHaveLength(1)
    const skipped = addListen(empty, { ...listen, heard: 5 })
    expect(skipped.songs.a).toMatchObject({ plays: 0, skips: 1 })
    expect(skipped.history).toHaveLength(0)
  })
  it('a song that reaches its end always counts', () => {
    expect(addListen(empty, { ...listen, heard: 1, finished: true }).songs.a.plays).toBe(1)
  })
  it('learns only while learning is on, and counts Autoplay songs', () => {
    expect(addListen(empty, { ...listen, learning: false }).learned).toEqual({})
    expect(addListen(empty, { ...listen, viaAutoplay: true }).autoplayed).toBe(1)
  })

  it('splits collaborating artists so each collaborator gets credited individually', () => {
    const tracks: Track[] = [
      {
        id: 'song1',
        title: 'Touch the Sky',
        artist: 'Kanye West, Lupe Fiasco',
        album: 'Late Registration',
        path: '/path/1',
        sec: 236,
        size: 5000000,
        added: 1,
        bits: 16,
        rate: 44100,
        kbps: 320,
        format: 'MP3',
        lossy: true,
      },
    ]
    const state: Listening = {
      songs: {
        song1: { plays: 5, skips: 0, heard: 1180, last: 1 },
      },
      history: [],
      learned: {},
      autoplayed: 0,
    }
    const ranked = topArtists(state, tracks)
    const names = ranked.map((r) => r.name)
    expect(names).toContain('Kanye West')
    expect(names).toContain('Lupe Fiasco')
    expect(names).not.toContain('Kanye West, Lupe Fiasco')
    expect(ranked.find((r) => r.name === 'Kanye West')?.plays).toBe(5)
    expect(ranked.find((r) => r.name === 'Lupe Fiasco')?.plays).toBe(5)
  })
})

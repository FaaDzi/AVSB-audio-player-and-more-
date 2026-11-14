import { describe, expect, it } from 'vitest'
import { hiddenTrackIds, visiblePlaylists, type Playlist, type Track } from './library'
import { totalPlays, withoutSongs, type Listening } from './stats'

const t = (id: string, folder: string) => ({ id, path: `${folder}/${id}.flac`, folder }) as Track

describe('hidden folders count nowhere (§80 B)', () => {
  const tracks = [t('a', 'Music/Rock'), t('b', 'Music/Secret'), t('c', 'Music/Secret/Deep')]
  const hidden = hiddenTrackIds(tracks, ['Music/Secret'])

  it('finds the songs in a hidden folder and its subfolders', () => {
    expect([...hidden].sort()).toEqual(['b', 'c'])
  })

  it('leaves a playlist out only when all its songs are hidden, and keeps empty ones', () => {
    const shown = new Set(['a'])
    const lists: Playlist[] = [
      { id: '1', name: 'mixed', tracks: ['b', 'a'] },
      { id: '2', name: 'all hidden', tracks: ['b', 'c'] },
      { id: '3', name: 'empty', tracks: [] },
    ]
    expect(visiblePlaylists(lists, shown).map((p) => p.name)).toEqual(['mixed', 'empty'])
    expect(lists[0].tracks).toEqual(['b', 'a'])
  })

  it('takes hidden songs out of the totals without deleting them', () => {
    const state: Listening = {
      songs: { a: { plays: 2, heard: 60, skips: 0, last: 1 }, b: { plays: 5, heard: 100, skips: 0, last: 1 } },
      history: [], learned: {}, autoplayed: 0,
    } as unknown as Listening
    expect(totalPlays(withoutSongs(state, hidden))).toBe(2)
    expect(totalPlays(state)).toBe(7)
  })
})

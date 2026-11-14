import { describe, expect, it } from 'vitest'
import { apoParametricText, DEFAULT_FILTER, filterSongs, headroomGains, isUserSong, loadScrollLock, matchesQuery, saveScrollLock, type GalleryItem } from './gallery'

const file = { name: 'f', size: 1, arrayBuffer: async () => new ArrayBuffer(0) }
const song = (o: Partial<GalleryItem>): GalleryItem => ({
  id: o.title ?? 'x',
  artist: 'Daft Punk',
  title: "Doin' it Right",
  album: 'Random Access Memories',
  year: 2013,
  category: 'bass',
  also: ['vocals'],
  genre: 'electronic',
  clip: { start: null, end: null },
  file,
  ...o,
})

describe('gallery search', () => {
  const s = song({})
  it('needs every word, across fields', () => {
    expect(matchesQuery(s, 'daft right')).toBe(true)
    expect(matchesQuery(s, 'daft metal')).toBe(false)
    expect(matchesQuery(s, 'DÁFT')).toBe(true)
  })
  it('understands key=value and year ranges', () => {
    expect(matchesQuery(s, 'genre=elec')).toBe(true)
    expect(matchesQuery(s, 'type=vocals')).toBe(true)
    expect(matchesQuery(s, 'artist=lorde')).toBe(false)
    expect(matchesQuery(s, 'year>2010 year<2015')).toBe(true)
    expect(matchesQuery(s, 'year=2012')).toBe(false)
  })
})

describe('gallery filters', () => {
  const items = [
    song({ id: 'a', title: 'B side', artist: 'Zed', genre: 'pop', category: 'vocals', also: [] }),
    song({ id: 'b', title: 'A side', artist: 'Abe', genre: 'rock', category: 'bass', also: ['busy'] }),
  ]
  it('filters by speciality (main or also) and favourites, then sorts', () => {
    expect(filterSongs(items, { ...DEFAULT_FILTER, category: 'busy' }, new Set()).map((s) => s.id)).toEqual(['b'])
    expect(filterSongs(items, { ...DEFAULT_FILTER, favoritesOnly: true }, new Set(['a'])).map((s) => s.id)).toEqual(['a'])
    expect(filterSongs(items, DEFAULT_FILTER, new Set()).map((s) => s.id)).toEqual(['b', 'a'])
    expect(filterSongs(items, { ...DEFAULT_FILTER, sort: 'genre' }, new Set()).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('gallery EQ export', () => {
  it('never boosts above 0 dB', () => {
    expect(headroomGains([3, -2, 0])).toEqual([0, -5, -3])
    expect(apoParametricText([100], [4])).toBe('Preamp: -4.0 dB\nFilter 1: ON PK Fc 100 Hz Gain 4.0 dB Q 1.41')
  })
})

describe('our list vs your songs', () => {
  it('treats unlisted files from your folder as yours', () => {
    expect(isUserSong({ id: 'extra-mysongflac' })).toBe(true)
    expect(isUserSong({ id: 'bass-01' })).toBe(false)
    expect(isUserSong({ id: 's-014' })).toBe(false)
  })
})

describe('scroll-lock preference', () => {
  it('defaults to false (auto-switch)', () => {
    const mem: Record<string, string> = {}
    const s = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) }
    expect(loadScrollLock(s)).toBe(false)
  })

  it('persists and retrieves locked state', () => {
    const mem: Record<string, string> = {}
    const s = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) }
    saveScrollLock(true, s)
    expect(loadScrollLock(s)).toBe(true)
    saveScrollLock(false, s)
    expect(loadScrollLock(s)).toBe(false)
  })
})

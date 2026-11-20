import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { METADATA_FILTERS, NO_FILTERS, SORTS, cachedSavedCover, coverUrl, deleteMemoryCover, deletePlaylist, filterTracks, folderName, folderPath, genreBadge, groupAlbums, groupArtists, groupFolders, initial, isPlaylistSaved, moveItem, overlayTrack, playlistCount, playlistNamesForTrack, qualityLabel, recentTracks, registerCoverLoader, removeFromPlaylist, setMemoryCover, sortByFileName, sortIcon, sortTracks, splitArtists, versionKey, withArrivalOrder, mergeTwins, withArtistFromTitle, type LibraryData, type Track } from './library'

const base: Track = {
  id: 'a', path: 'a.flac', folder: '.', title: 'A', artist: 'X', albumArtist: 'X', album: 'Alb', track: 1, trackTotal: 2, disc: 1,
  date: '2020-01-01', year: 2020, genre: 'Pop', label: 'L', isrc: 'USRC17607839', isrcOk: true, lyrics: true, replayGain: false,
  downloaded: false, format: 'FLAC', lossy: false, bits: 16, rate: 44100, sec: 100, size: 10, kbps: 900, added: 1, cover: '',
}
const t = (o: Partial<Track>): Track => ({ ...base, ...o })

describe('filters', () => {
  it('quality splits hi-res, CD and lossy', () => {
    const list = [t({ id: '1', bits: 24 }), t({ id: '2' }), t({ id: '3', lossy: true, bits: 0, format: 'OPUS' })]
    expect(filterTracks(list, { ...NO_FILTERS, quality: 'hires' }).map((x) => x.id)).toEqual(['1'])
    expect(filterTracks(list, { ...NO_FILTERS, quality: 'cd' }).map((x) => x.id)).toEqual(['2'])
    expect(filterTracks(list, { ...NO_FILTERS, quality: 'lossy' }).map((x) => x.id)).toEqual(['3'])
    expect(filterTracks(list, { ...NO_FILTERS, format: 'OPUS' }).map((x) => x.id)).toEqual(['3'])
  })

  it('finds each kind of missing tag', () => {
    expect(filterTracks([t({ year: 0 })], { ...NO_FILTERS, metadata: 'missing-year' })).toHaveLength(1)
    expect(filterTracks([t({})], { ...NO_FILTERS, metadata: 'missing-year' })).toHaveLength(0)
    expect(filterTracks([t({ isrc: 'nope', isrcOk: false })], { ...NO_FILTERS, metadata: 'bad-isrc' })).toHaveLength(1)
    expect(filterTracks([t({ isrc: '', isrcOk: false })], { ...NO_FILTERS, metadata: 'bad-isrc' })).toHaveLength(0)
  })

  it('an album missing tracks is incomplete, and one with no total is unknown', () => {
    const list = [t({ id: '1', trackTotal: 2 }), t({ id: '2', album: 'Other', trackTotal: 1 }), t({ id: '3', album: 'Third', trackTotal: 0 })]
    expect(filterTracks(list, { ...NO_FILTERS, metadata: 'incomplete-album' }).map((x) => x.id)).toEqual(['1'])
    expect(filterTracks(list, { ...NO_FILTERS, metadata: 'unknown-album' }).map((x) => x.id)).toEqual(['3'])
  })

  it('searches title, artist and album', () => {
    expect(filterTracks([t({ title: 'Blue' })], NO_FILTERS, 'blu')).toHaveLength(1)
    expect(filterTracks([t({ title: 'Blue' })], NO_FILTERS, 'red')).toHaveLength(0)
  })
})

describe('sorts', () => {
  it('empty fields go last in both directions', () => {
    const list = [t({ id: 'none', genre: '' }), t({ id: 'b', genre: 'B' }), t({ id: 'a', genre: 'A' })]
    expect(sortTracks(list, 'genre-asc').map((x) => x.id)).toEqual(['a', 'b', 'none'])
    expect(sortTracks(list, 'genre-desc').map((x) => x.id)).toEqual(['b', 'a', 'none'])
  })

  it('does not change the list it was given', () => {
    const list = [t({ id: '1', size: 1 }), t({ id: '2', size: 2 })]
    sortTracks(list, 'size-desc')
    expect(list[0].id).toBe('1')
  })
})

describe('grouping', () => {
  it('splits collaborators but keeps names that contain a comma', () => {
    expect(splitArtists('Tyler, The Creator, Daniel Caesar').sort()).toEqual(['Daniel Caesar', 'Tyler, The Creator'])
    expect(splitArtists('Daft Punk, Panda Bear')).toEqual(['Daft Punk', 'Panda Bear'])
    expect(splitArtists('')).toEqual([])
  })

  it('reads the artist out of a title only when the artist tag is empty', () => {
    expect(withArtistFromTitle({ title: 'Oriens - GINKIHA', artist: '' })).toEqual({ title: 'Oriens', artist: 'GINKIHA' })
    expect(withArtistFromTitle({ title: 'Wish Upon a Shooting Star - SUi - Deemo 2.4', artist: '' })).toEqual({ title: 'Wish Upon a Shooting Star', artist: 'SUi' })
    expect(withArtistFromTitle({ title: 'BUNRETSU - HAKAI', artist: 'cosMo' })).toEqual({ title: 'BUNRETSU - HAKAI', artist: 'cosMo' })
    expect(withArtistFromTitle({ title: '[IA] A Tale of Six Trillion Years and a Night', artist: '' }).artist).toBe('')
  })

  it('splits at the separators chosen in Metadata separators', () => {
    expect(splitArtists('A; B, C')).toEqual(['A', 'B', 'C'])
    expect(splitArtists('K/DA, Madison Beer')).toEqual(['K/DA', 'Madison Beer'])
    expect(splitArtists('K/DA, Madison Beer', [',', '/'])).toEqual(['K', 'DA', 'Madison Beer'])
    expect(splitArtists('Mitchie M×OSTER project, Hatsune Miku', [',', '×'])).toEqual(['Mitchie M', 'OSTER project', 'Hatsune Miku'])
    expect(splitArtists('Simon & Garfunkel, R&B Guy', [',', '&'])).toEqual(['Simon & Garfunkel', 'R&B Guy'])
    expect(splitArtists('Jay & Bob, Simon and Garfunkel', [',', '&'])).toEqual(['Simon and Garfunkel', 'Jay', 'Bob'])
    expect(splitArtists('Kanye West feat. Rihanna')).toEqual(['Kanye West', 'Rihanna'])
    expect(splitArtists('Tyler, The Creator, Daniel Caesar', [])).toEqual(['Tyler, The Creator, Daniel Caesar'])
    expect(splitArtists('Tyler, The Creator; Kali Uchis', [';']).sort()).toEqual(['Kali Uchis', 'Tyler, The Creator'])
  })

  it('one-track albums are singles', () => {
    const { albums, singles } = groupAlbums([t({ id: '1' }), t({ id: '2' }), t({ id: '3', album: 'Solo' }), t({ id: '4', album: '' })])
    expect(albums.map((a) => a.tracks.length)).toEqual([2])
    expect(singles.map((a) => a.name)).toEqual(['Solo'])
  })

  it('folders name their path, and each folder appears once', () => {
    const groups = groupFolders([t({ id: '1', folder: 'D:/Music' }), t({ id: '2', folder: 'D:/Music/Other' }), t({ id: '3', folder: 'D:/Music' })])
    expect(groups.map((g) => [folderPath(g.folder), g.tracks.length])).toEqual([['D:\\Music', 2], ['D:\\Music\\Other', 1]])
    expect(folderName('D:/Music')).toBe('Music')
    expect(folderName('D:/Music/Other')).toBe('Other')
  })

  it('a folder lists by file name, ignoring the folder and comparing numbers as numbers', () => {
    const list = [t({ id: '30', path: 'Other/30 Hours.flac' }), t({ id: '4', path: '4 Your Eyez Only.flac' }), t({ id: 'b', path: 'bad guy.flac' })]
    expect(sortByFileName(list).map((x) => x.id)).toEqual(['4', '30', 'b'])
  })

  it('moves an item without touching the original', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(list, 0, 3)).toBe(list)
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('recent tracks are the four weeks up to the newest', () => {
    const day = 24 * 60 * 60
    const list = [t({ id: 'new', added: 100 * day }), t({ id: 'near', added: 80 * day }), t({ id: 'old', added: 10 * day }), t({ id: 'none', added: 0 })]
    expect(recentTracks(list).map((x) => x.id)).toEqual(['new', 'near'])
    expect(recentTracks([])).toEqual([])
  })

  it('every sort has an icon, and counts read as words', () => {
    expect(SORTS.map(([mode]) => sortIcon(mode)).every(Boolean)).toBe(true)
    expect(sortIcon('latest')).toBe('schedule')
    expect(sortIcon('album-desc')).toBe('album')
    expect(playlistCount(1)).toBe('1 playlist')
    expect(playlistCount(2)).toBe('2 playlists')
  })

  it('labels', () => {
    expect(initial('ado')).toBe('A')
    expect(initial('アイドル')).toBe('#')
    expect(qualityLabel(t({ bits: 24, rate: 96000 }))).toBe('FLAC 24-bit/96kHz')
    expect(qualityLabel(t({ rate: 44100 }))).toBe('FLAC 16-bit/44.1kHz')
    // MediaStore often reports no bit depth / rate: leave those out instead of "0-bit/0kHz"
    expect(qualityLabel(t({ bits: 0, rate: 48000 }))).toBe('FLAC 48kHz')
    expect(qualityLabel(t({ bits: 0, rate: 0, format: '' }))).toBe('Lossless')
    expect(qualityLabel(t({ lossy: true, format: 'MP3', kbps: 0 }))).toBe('MP3')
    expect(genreBadge('rap')).toBe('rap')
    expect(genreBadge('hip-hop')).toBe('HH')
    expect(genreBadge('drum & bass')).toBe('DB')
    expect(genreBadge('classical')).toBe('clas')
  })
})

describe('playlists', () => {
  const data: LibraryData = {
    tracks: [],
    playlists: [
      { id: 'fav', name: 'Favorites', tracks: ['a', 'b'] },
      { id: 'p1', name: 'Gym', tracks: ['b', 'c'] },
    ],
  }
  it('lights the + only for the listener’s own playlists, not Favorites', () => {
    expect(isPlaylistSaved(data.playlists, 'a')).toBe(false)
    expect(isPlaylistSaved(data.playlists, 'b')).toBe(true)
    expect(playlistNamesForTrack(data.playlists, 'b')).toEqual(['Gym'])
  })
  it('deletes a playlist and removes songs from one without touching the others', () => {
    expect(deletePlaylist(data, 'p1').playlists.map((p) => p.id)).toEqual(['fav'])
    const after = removeFromPlaylist(data, 'p1', ['b'])
    expect(after.playlists.find((p) => p.id === 'p1')?.tracks).toEqual(['c'])
    expect(after.playlists.find((p) => p.id === 'fav')?.tracks).toEqual(['a', 'b'])
  })
})

describe('cover LRU cache', () => {
  it('caps in-memory covers at 100 and bumps recency on read', () => {
    for (let i = 0; i < 100; i++) {
      setMemoryCover(`lru-${i}`, `data:image/jpeg;base64,cover-${i}`)
    }
    // Touch lru-0 so it becomes most-recently-used while lru-1 becomes least-recently-used.
    expect(cachedSavedCover('lru-0')).toBe('data:image/jpeg;base64,cover-0')
    setMemoryCover('lru-100', 'data:image/jpeg;base64,cover-100')

    expect(cachedSavedCover('lru-0')).toBe('data:image/jpeg;base64,cover-0')
    expect(cachedSavedCover('lru-1')).toBeUndefined()
    expect(cachedSavedCover('lru-100')).toBe('data:image/jpeg;base64,cover-100')

    for (let i = 0; i <= 100; i++) deleteMemoryCover(`lru-${i}`)
  })

  it('reflects cached memory covers in overlayTrack and coverUrl until deleted', () => {
    setMemoryCover('present-cover-id', 'data:image/jpeg;base64,abc')
    expect(cachedSavedCover('present-cover-id')).toBe('data:image/jpeg;base64,abc')
    expect(coverUrl('present-cover-id')).toBe('data:image/jpeg;base64,abc')
    expect(overlayTrack(t({ id: 'present-cover-id', cover: '' })).cover).toBe('data:image/jpeg;base64,abc')

    deleteMemoryCover('present-cover-id')
    expect(cachedSavedCover('present-cover-id')).toBeUndefined()
    expect(coverUrl('present-cover-id')).toBe('/shell-host/cover?id=present-cover-id')
  })

  it("doesn't reload a saved cover the track still carries after the LRU dropped it", () => {
    const store: Record<string, string> = { 'shell.details.evicted': JSON.stringify({ values: {}, from: { cover: 'coverart' } }) }
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null })
    const loads: string[] = []
    registerCoverLoader((id) => loads.push(id))
    try {
      setMemoryCover('evicted', 'data:image/jpeg;base64,kept')
      const track = t({ id: 'evicted', cover: '' })
      overlayTrack(track)
      deleteMemoryCover('evicted') // what an LRU eviction does
      expect(overlayTrack(track).cover).toBe('data:image/jpeg;base64,kept')
      expect(loads).toEqual([])
    } finally {
      registerCoverLoader(() => {})
      vi.unstubAllGlobals()
    }
  })
})

// runs only where the sample data has been built (scripts/build_shell_fixture.py)
const fixture = new URL('../../shell-fixture/library.json', import.meta.url)
describe.runIf(existsSync(fixture))('on the real library tags', () => {
  const data = JSON.parse(readFileSync(fixture, 'utf-8')) as LibraryData

  it('quality filters cover every track exactly once', () => {
    const count = (quality: 'hires' | 'cd' | 'lossy') => filterTracks(data.tracks, { ...NO_FILTERS, quality }).length
    expect(count('hires') + count('cd') + count('lossy')).toBe(data.tracks.length)
    expect(count('lossy')).toBeGreaterThan(0)
  })

  it('complete and missing-any are opposites', () => {
    const count = (metadata: 'complete' | 'missing-any') => filterTracks(data.tracks, { ...NO_FILTERS, metadata }).length
    expect(count('complete') + count('missing-any')).toBe(data.tracks.length)
  })

  it('every metadata filter and sort runs, and sorting keeps all tracks', () => {
    for (const [metadata] of METADATA_FILTERS) expect(filterTracks(data.tracks, { ...NO_FILTERS, metadata }).length).toBeLessThanOrEqual(data.tracks.length)
    for (const [mode] of SORTS) expect(sortTracks(data.tracks, mode)).toHaveLength(data.tracks.length)
  })

  it('album, single and folder groups account for every track', () => {
    const { albums, singles } = groupAlbums(data.tracks)
    const grouped = [...albums, ...singles].reduce((n, a) => n + a.tracks.length, 0)
    expect(grouped + data.tracks.filter((x) => !x.album).length).toBe(data.tracks.length)
    expect(groupFolders(data.tracks).reduce((n, f) => n + f.tracks.length, 0)).toBe(data.tracks.length)
    const paths = groupFolders(data.tracks).map((f) => folderPath(f.folder))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('no artist name is left with a comma', () => {
    const odd = groupArtists(data.tracks).filter((a) => a.name.includes(',') && !/Tyler|Earth|Grover|Crosby|Emerson|Blood/.test(a.name))
    expect(odd.map((a) => a.name)).toEqual([])
  })
})

describe('Artists by album artist (§92 A)', () => {
  const songs = [
    t({ id: 'a', artist: 'Kanye West feat. Rihanna', albumArtist: 'Kanye West', album: 'X' }),
    t({ id: 'b', artist: 'Kanye West', albumArtist: '', album: 'Y' }),
    t({ id: 'c', artist: 'Rihanna', albumArtist: 'Various Artists', album: 'Hits' }),
    t({ id: 'd', artist: 'Kendrick Lamar', albumArtist: 'Kanye West', album: 'X' }),
  ]
  it('lists main artists once, with guests under Appears on', () => {
    const list = groupArtists(songs, undefined, true)
    expect(list.map((a) => a.name)).toEqual(['Kanye West', 'Rihanna'])
    const kanye = list.find((a) => a.name === 'Kanye West')!
    expect(kanye.tracks.map((x) => x.id)).toEqual(['a', 'b', 'd'])
    const rihanna = list.find((a) => a.name === 'Rihanna')!
    expect(rihanna.tracks.map((x) => x.id)).toEqual(['c'])
    expect(rihanna.appearsOn.map((x) => x.id)).toEqual(['a'])
  })
  it('lists everyone on the song when asked', () => {
    expect(groupArtists(songs).map((a) => a.name)).toEqual(['Kanye West', 'Kendrick Lamar', 'Rihanna'])
  })
})

describe('albums of songs without an album artist', () => {
  it('stay together under the first artist named', () => {
    const { albums } = groupAlbums([
      t({ id: '1', artist: 'Kanye West, Dwele', albumArtist: '', album: 'Graduation', track: 1 }),
      t({ id: '2', artist: 'Kanye West', albumArtist: '', album: 'Graduation', track: 2 }),
    ])
    expect(albums.map((a) => [a.artist, a.tracks.length])).toEqual([['Kanye West', 2]])
  })
})

describe('versionKey', () => {
  it('tells other recordings apart and leaves the usual one alone', () => {
    expect(versionKey('3005')).toBe('')
    expect(versionKey('3005 (Beach Picnic Version) [Secret Track]')).toBe('beach picnic version+secret track')
    expect(versionKey('Pacific Paradise (Original Mix)')).toBe('')
    expect(versionKey('Song (2011 Remaster) - Album Version')).toBe('')
    expect(versionKey('Song (Live at Wembley)')).toBe('live')
  })
})

describe('phone and PC together (§91 A, council 2026-11-19)', () => {
  it('puts the PC library just after it first arrived, in its own order, and later songs after that', () => {
    const songs = withArrivalOrder([
      t({ id: 'p1', added: 1_000 }),
      t({ id: 'pc_a', path: 'pc:a', added: 500 }),
      t({ id: 'pc_b', path: 'pc:b', added: 900 }),
      t({ id: 'p2', added: 3_000 }),
      t({ id: 'pc_c', path: 'pc:c', added: 4_000 }),
    ], 2_000)
    expect(sortTracks(songs, 'oldest').map((x) => x.id)).toEqual(['p1', 'pc_a', 'pc_b', 'p2', 'pc_c'])
  })
  it('lists a song on both once, as the phone copy', () => {
    const merged = mergeTwins([
      t({ id: 'p', title: '3005', artist: 'Childish Gambino', sec: 234, cover: '' }),
      t({ id: 'pc_x', path: 'pc:x', title: '3005', artist: 'Childish Gambino', sec: 235, cover: 'c1' }),
      t({ id: 'pc_y', path: 'pc:y', title: '3005', artist: 'Childish Gambino', sec: 226 }),
    ])
    expect(merged.map((x) => [x.id, x.pcTwin, x.cover])).toEqual([['p', 'pc_x', 'c1'], ['pc_y', undefined, '']])
  })
})

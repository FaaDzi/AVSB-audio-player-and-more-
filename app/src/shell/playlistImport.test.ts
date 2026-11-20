import { describe, expect, it } from 'vitest'
import { matchEntries, parsePlaylist } from './playlistImport'
import { withPcLists } from './playlistLink'
import type { Playlist, Track } from './library'

const song = (id: string, title: string, artist: string, sec: number, extra: Partial<Track> = {}): Track =>
  ({ id, title, artist, sec, path: `D:/Music/${artist}/${title}.flac`, folder: `D:/Music/${artist}`, ...extra }) as Track

const pcLib = [song('1', 'Brain Stew', 'Green Day', 193), song('2', 'Golden Brown', 'The Stranglers', 207), song('3', 'Witchcraft', 'Pendulum', 252)]
// an Android library: content:// paths, the file's name and its folder under the storage root
const phoneLib = [
  song('a1', 'Brain Stew', 'Green Day', 193, { path: 'content://media/external/audio/media/1', folder: '/Music/Green Day/', file: '05 Brain Stew.mp3' }),
  song('a2', 'Witchcraft', 'Pendulum', 252, { path: 'content://media/external/audio/media/2', folder: '/Download/', file: 'Pendulum - Witchcraft.opus' }),
]

describe('playlist import (§98)', () => {
  it('reads an extended M3U with its name, lengths and "Artist - Title"', () => {
    const p = parsePlaylist('x.m3u8', '\uFEFF#EXTM3U\n#PLAYLIST:Road trip\n#EXTINF:193,Green Day - Brain Stew\nD:\\Music\\Green Day\\Brain Stew.flac\n#EXTINF:-1,Nobody - Nothing\nnothing.mp3\n')
    expect(p.name).toBe('Road trip')
    expect(p.entries[0]).toMatchObject({ artist: 'Green Day', title: 'Brain Stew', sec: 193 })
    expect(matchEntries(p.entries, pcLib).map((t) => t?.id ?? null)).toEqual(['1', null])
  })

  it('matches a Samsung Music export from another phone by folder and file name', () => {
    const p = parsePlaylist('Gym.m3u', '/storage/emulated/0/Music/Green Day/05 Brain Stew.mp3\n/storage/0000-1111/Download/Pendulum - Witchcraft.opus\n')
    expect(p.name).toBe('Gym')
    expect(matchEntries(p.entries, phoneLib).map((t) => t?.id)).toEqual(['a1', 'a2'])
  })

  it('tells two files of the same name apart by their folder', () => {
    const twins = [
      song('x1', 'Intro', 'A', 60, { path: 'content://1', folder: '/Music/A/', file: 'Intro.mp3' }),
      song('x2', 'Intro', 'B', 60, { path: 'content://2', folder: '/Music/B/', file: 'Intro.mp3' }),
    ]
    const p = parsePlaylist('t.m3u', '/storage/emulated/0/Music/B/Intro.mp3\n')
    expect(matchEntries(p.entries, twins)[0]?.id).toBe('x2')
  })

  it('falls back to the file name read as "Artist - Title" when no path or name fits', () => {
    const p = parsePlaylist('x.m3u', 'C:/Old PC/03 - The Stranglers - Golden Brown.mp3\n')
    expect(matchEntries(p.entries, pcLib)[0]?.id).toBe('2')
  })

  it('reads PLS, XSPF, WPL and CSV', () => {
    const pls = parsePlaylist('a.pls', '[playlist]\nFile1=x/Witchcraft.mp3\nTitle1=Pendulum - Witchcraft\nLength1=252\nNumberOfEntries=1\n')
    expect(pls.entries[0]).toMatchObject({ title: 'Witchcraft', artist: 'Pendulum', sec: 252 })
    const xspf = parsePlaylist('b.xspf', '<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>Mine &amp; yours</title><trackList><track><location>file:///D:/Music/Green%20Day/Brain%20Stew.flac</location><title>Brain Stew</title><creator>Green Day</creator><duration>193000</duration></track></trackList></playlist>')
    expect(xspf.name).toBe('Mine & yours')
    expect(matchEntries(xspf.entries, pcLib)[0]?.id).toBe('1')
    const wpl = parsePlaylist('c.wpl', '<?wpl version="1.0"?><smil><head><title>WMP</title></head><body><seq><media src="..\\Music\\Pendulum\\Witchcraft.flac"/></seq></body></smil>')
    expect(matchEntries(wpl.entries, pcLib)[0]?.id).toBe('3')
    const csv = parsePlaylist('d.csv', 'Track Name,Artist Name(s),Duration (ms)\n"Golden Brown","The Stranglers",207000\nBrain Stew,"Green Day, Someone",193000\n')
    expect(matchEntries(csv.entries, pcLib).map((t) => t?.id)).toEqual(['2', '1'])
  })
})

describe('the PC is king (§98)', () => {
  const list = (id: string, name: string, origin?: 'pc'): Playlist => ({ id, name, tracks: [], ...(origin ? { origin } : {}) })
  it("a phone gets the PC's playlists, keeps its own and its Favorites, and drops PC lists the PC no longer has", () => {
    const mine = [list('fav', 'Favorites'), list('old', 'Gone from PC', 'pc'), list('own', 'Phone only'), list('shared', 'Was synced')]
    const pc = [list('shared', 'Was synced'), list('new', 'New on PC'), list('pcfav', 'Favorites')]
    const next = withPcLists(mine, pc)
    expect(next.map((p) => [p.id, p.origin ?? 'phone'])).toEqual([['shared', 'pc'], ['new', 'pc'], ['fav', 'phone'], ['own', 'phone']])
  })
})

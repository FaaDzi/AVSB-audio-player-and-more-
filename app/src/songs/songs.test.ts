import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { newMatch, recordRound } from '../match/state'
import { autoClip, clipCandidates, CLIP_SECONDS } from './clip'
import { buildLibrary, cleanSongName, matchesFile, pickedFolder, type LibrarySong, type SongManifest } from './library'
import { CHOSEN_SHARE, pickSongs } from './picker'
import { genreGroup, GENRE_GROUPS } from './genres'

const manifest: SongManifest = JSON.parse(readFileSync(new URL('../../../songs/manifest.json', import.meta.url), 'utf-8'))
const fakeFile = (name: string) => ({ name, size: 1 }) as File

describe('match state', () => {
  it('Bo3 ends at 2-0', () => {
    let m = newMatch(3)
    m = recordRound(m, 1)
    expect(m.winner).toBeNull()
    m = recordRound(m, 1)
    expect(m.winner).toBe(1)
    expect(() => recordRound(m, 0)).toThrow()
  })

  it('Bo5 needs 3 wins and can go the distance', () => {
    let m = newMatch(5)
    for (const w of [0, 1, 0, 1] as const) m = recordRound(m, w)
    expect(m.winner).toBeNull()
    m = recordRound(m, 0)
    expect(m.winner).toBe(0)
    expect(m.wins).toEqual([3, 2])
  })

  it('rejects even best-of', () => expect(() => newMatch(4)).toThrow())
})

describe('file matching', () => {
  it('matches common naming styles', () => {
    expect(matchesFile({ artist: 'Kendrick Lamar', title: 'HUMBLE.' }, '03 Kendrick Lamar - HUMBLE..flac')).toBe(true)
    expect(matchesFile({ artist: 'Sigur Rós', title: 'Hoppípolla' }, 'Sigur Ros - Hoppipolla.wav')).toBe(true)
    expect(matchesFile({ artist: 'Eagles', title: 'Hotel California (live)' }, 'Eagles - Hotel California.mp3')).toBe(true)
    expect(matchesFile({ artist: 'Pink Floyd', title: 'Time' }, 'Hans Zimmer - Time.wav')).toBe(false)
  })

  it('pairs manifest songs and keeps unlisted files as extras', () => {
    const lib = buildLibrary(manifest, [
      fakeFile('Kendrick Lamar - HUMBLE..flac'),
      fakeFile('Tracy Chapman - Fast Car.wav'),
      fakeFile('Some Band - Unknown Song.mp3'),
      fakeFile('cover.jpg'),
    ])
    const ids = lib.songs.map((s) => s.id)
    const idOf = (artist: string, title: string) => manifest.songs.find((s) => s.artist === artist && s.title === title)!.id
    expect(ids).toContain(idOf('Kendrick Lamar', 'HUMBLE.'))
    expect(ids).toContain(idOf('Tracy Chapman', 'Fast Car'))
    expect(lib.songs.find((s) => s.id.startsWith('extra-'))?.title).toBe('Unknown Song')
    expect(lib.songs).toHaveLength(3)
    expect(lib.missing).toHaveLength(manifest.songs.length - 2)
  })
})

describe('pickSongs', () => {
  const library: LibrarySong[] = manifest.songs.map((s) => ({ ...s, file: fakeFile(s.id) }))

  it('Bo5 gets 5 different categories', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickSongs(library, 5)
      expect(new Set(picked.map((s) => s.category)).size).toBe(5)
    }
  })

  it('avoids songs either entrant already heard when possible', () => {
    // 2 of every 3 songs heard, so every category still has unheard ones
    const heardBy = { x: new Set(library.filter((_, i) => i % 3 !== 0).map((s) => s.id)) }
    const picked = pickSongs(library, 3, { heardBy, entrants: ['x', 'y'] })
    for (const s of picked) expect(heardBy.x.has(s.id)).toBe(false)
  })

  const groupShares = (opts: Parameters<typeof pickSongs>[2], n = 12000) => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const g = genreGroup(pickSongs(library, 1, opts)[0].genre)
      counts[g] = (counts[g] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).map(([g, c]) => [g, c / n]))
  }

  it('no genres chosen: every genre group is about equally likely, however many songs it has', () => {
    const shares = groupShares({})
    const groups = new Set(library.map((s) => genreGroup(s.genre)))
    for (const g of groups) expect(shares[g], g).toBeCloseTo(1 / groups.size, 1)
  })

  it('chosen genres get most of the picks, and the others still come up', () => {
    const metal = GENRE_GROUPS.find((g) => g.id === 'metal')!.manifestTags
    const shares = groupShares({ genres: metal })
    expect(shares.metal).toBeGreaterThan(CHOSEN_SHARE - 0.03)
    expect(shares.metal).toBeLessThan(CHOSEN_SHARE + 0.03)
    expect(shares.pop).toBeGreaterThan(0)
  })

  it('favourites come up a bit more often, not overwhelmingly', () => {
    const favorites = new Set(library.slice(0, 10).map((s) => s.id))
    const n = 20000
    const rate = (opts: Parameters<typeof pickSongs>[2]) => {
      let hits = 0
      for (let i = 0; i < n; i++) if (favorites.has(pickSongs(library, 1, opts)[0].id)) hits++
      return hits / n
    }
    const base = rate({})
    const fav = rate({ favorites })
    expect(fav).toBeGreaterThan(base * 1.15)
    expect(fav).toBeLessThan(base * 1.6)
  }, 30_000) // 40,000 picks over the whole song list
})

describe('autoClip', () => {
  it('finds the bass-heavy section for a bass song', () => {
    const sr = 22050
    const len = sr * 180
    const ch = new Float32Array(len)
    // quiet hi-hat noise everywhere, a loud 50 Hz section from 100 s to 150 s
    for (let i = 0; i < len; i++) {
      const t = i / sr
      ch[i] = (Math.random() - 0.5) * 0.05 + (t >= 100 && t < 150 ? 0.5 * Math.sin(2 * Math.PI * 50 * t) : 0)
    }
    const [start, end] = autoClip([ch], sr, 'bass')
    expect(end - start).toBe(CLIP_SECONDS)
    expect(start).toBeGreaterThanOrEqual(100)
    expect(end).toBeLessThanOrEqual(150)
  })

  it('offers each strong bass section, not overlapping, and skips the weak parts', () => {
    const sr = 22050
    const len = sr * 240
    const ch = new Float32Array(len)
    // two equally bassy stretches (20-70 s, 150-200 s) and a faint one (100-140 s)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      const amp = (t >= 20 && t < 70) || (t >= 150 && t < 200) ? 0.5 : t >= 100 && t < 140 ? 0.1 : 0
      ch[i] = (Math.random() - 0.5) * 0.05 + amp * Math.sin(2 * Math.PI * 50 * t)
    }
    const got = clipCandidates([ch], sr, 'bass').sort((a, b) => a[0] - b[0])
    expect(got).toHaveLength(2)
    expect(got[0][0]).toBeGreaterThanOrEqual(20)
    expect(got[0][1]).toBeLessThanOrEqual(70)
    expect(got[1][0]).toBeGreaterThanOrEqual(150)
    expect(got[1][1]).toBeLessThanOrEqual(200)
  })
})

describe('remembered songs folder', () => {
  it('finds the picked folder from a nested file (result uses Windows separators)', () => {
    const sep = String.fromCharCode(92)
    expect(pickedFolder('D:/Music/My Songs/sub/a.flac', 'My Songs/sub/a.flac')).toBe(['D:', 'Music', 'My Songs'].join(sep))
    expect(pickedFolder(['D:', 'Music', 'My Songs', 'a.flac'].join(sep), 'My Songs/a.flac')).toBe(['D:', 'Music', 'My Songs'].join(sep))
    expect(pickedFolder('D:/a.flac', '')).toBeNull()
  })
})

describe('cleanSongName', () => {
  const c = (n: string) => cleanSongName(n)
  it('drops numbers, emoji and upload noise', () => {
    expect(c('17 - Dr. Dre - Still D.R.E. ft. Snoop Dogg 🔥 (lyrics).flac')).toEqual({ artist: 'Dr. Dre', title: 'Still D.R.E. ft. Snoop Dogg' })
    expect(c('107 - Eagles - Hotel California (Live 1977) (Official Video) [HD].flac')).toEqual({ artist: 'Eagles', title: 'Hotel California (Live 1977)' })
    expect(c('173 - YOASOBI - Racing Into The Night Lyrics (JPN_ROM_ENG).flac')).toEqual({ artist: 'YOASOBI', title: 'Racing Into The Night' })
    expect(c('01 - ＂Scarlet Fire＂ - Otis McDonald [Copyright Free].flac')).toEqual({ artist: 'Scarlet Fire', title: 'Otis McDonald' })
  })
  it('understands Japanese upload styles and game sources', () => {
    expect(c('81 - 【Ado】 唱.flac')).toEqual({ artist: 'Ado', title: '唱' })
    expect(c('78 - ビビデバ ⧸ 星街すいせい(official).flac')).toEqual({ artist: '星街すいせい', title: 'ビビデバ' })
    expect(c('88 - HIMEHINA『Hello, Hologram』MV.flac')).toEqual({ artist: 'HIMEHINA', title: 'Hello, Hologram' })
    expect(c('169 - [Official] Team Grimoire - Dantalion [from Arcaea].flac')).toEqual({ artist: 'Team Grimoire', title: 'Dantalion', from: 'Arcaea' })
  })
})

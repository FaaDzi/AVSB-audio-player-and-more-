import { describe, expect, it } from 'vitest'
import { matchOf, merge, missingFields, normalize, providerOrder, type Candidate } from './metadata'
import type { Track } from './library'

const base: Track = {
  id: 'a', path: 'a.flac', folder: '.', title: 'Bohemian Rhapsody', artist: 'Queen', albumArtist: '', album: 'A Night at the Opera',
  track: 0, trackTotal: 0, disc: 0, date: '', year: 0, genre: '', label: '', isrc: '', isrcOk: false, lyrics: false, replayGain: false,
  downloaded: false, format: 'FLAC', lossy: false, bits: 16, rate: 44100, sec: 355, size: 10, kbps: 900, added: 1, cover: '',
}
const t = (o: Partial<Track> = {}): Track => ({ ...base, ...o })
const c = (o: Partial<Candidate> = {}): Candidate => ({ provider: 'musicbrainz', title: 'Bohemian Rhapsody', artists: ['Queen'], seconds: 354, album: 'A Night At The Opera', values: {}, ...o })

describe('normalize', () => {
  it('drops case, accents, punctuation and edition notes', () => {
    expect(normalize('Bohemian Rhapsody (Remastered 2011)')).toBe(normalize('bohemian rhapsody'))
    expect(normalize('Beyoncé')).toBe('beyonce')
    expect(normalize('Song - 2011 Remaster')).toBe('song')
    expect(normalize('Track feat. Someone')).toBe('track')
    expect(normalize('夜に駆ける')).toBe('夜に駆ける')
  })
})

describe('matchOf', () => {
  it('needs the length within 10 seconds', () => {
    expect(matchOf(t(), c())).toBe('strong')
    expect(matchOf(t(), c({ seconds: 370 }))).toBe('none')
  })
  it('is weak when only the title or only an artist agrees', () => {
    expect(matchOf(t(), c({ artists: ['Panic! at the Disco'] }))).toBe('weak')
    expect(matchOf(t(), c({ title: 'Killer Queen' }))).toBe('weak')
    expect(matchOf(t(), c({ title: 'Other', artists: ['Other'] }))).toBe('none')
  })
  it('takes the same ISRC as the same recording, whatever the spelling', () => {
    const song = t({ title: 'Alien Alien', artist: 'Nayutalien', isrc: 'TCJPF1707184', sec: 182 })
    expect(matchOf(song, c({ title: 'エイリアンエイリアン', artists: ['ナユタン星人'], seconds: 182, isrcs: ['tcjpf1707184'] }))).toBe('strong')
    expect(matchOf(song, c({ title: 'エイリアンエイリアン', artists: ['ナユタン星人'], seconds: 230, isrcs: ['TCJPF1707184'] }))).toBe('none')
  })
  it('accepts any one of our split artists', () => {
    expect(matchOf(t({ artist: 'Daft Punk, Pharrell Williams', title: 'Get Lucky' }), c({ title: 'Get Lucky', artists: ['Daft Punk'] }))).toBe('strong')
  })
})

describe('merge', () => {
  it('fills only empty fields, first provider in the order wins', () => {
    const song = t({ genre: 'Rock' })
    const found = merge(song, [
      c({ provider: 'deezer', values: { genre: 'Pop', label: 'Hollywood', track: 11 } }),
      c({ values: { label: 'EMI', composer: 'Freddie Mercury' } }),
    ], ['musicbrainz', 'coverart', 'deezer'])
    expect(found.values).toEqual({ label: 'EMI', composer: 'Freddie Mercury', track: 11 })
    expect(found.from).toEqual({ label: 'musicbrainz', composer: 'musicbrainz', track: 'deezer' })
  })
  it('takes edition fields only from a release with our album name', () => {
    const found = merge(t(), [c({ album: 'Greatest Hits', values: { track: 1, label: 'Parlophone', composer: 'Freddie Mercury', isrc: 'GBUM71029604' }, cover: 'data:x' })], ['musicbrainz'])
    expect(found.values).toEqual({ composer: 'Freddie Mercury', isrc: 'GBUM71029604' })
    expect(found.cover).toBeUndefined()
  })
  it('takes any release when the song has no album', () => {
    const found = merge(t({ album: '' }), [c({ album: 'Greatest Hits', values: { album: 'Greatest Hits', track: 1 }, cover: 'data:x' })], ['musicbrainz'])
    expect(found.values).toEqual({ album: 'Greatest Hits', track: 1 })
    expect(found.cover).toBe('data:x')
  })
  it('never replaces a cover the file has', () => {
    expect(merge(t({ cover: 'abc' }), [c({ cover: 'data:x' })], ['musicbrainz']).cover).toBeUndefined()
  })
})

describe('missingFields', () => {
  it('counts a year as a release date', () => {
    expect(missingFields(t({ year: 1975 }))).not.toContain('date')
    expect(missingFields(t())).toContain('date')
  })
})

describe('providerOrder', () => {
  it('defaults to MusicBrainz, Cover Art Archive, Deezer, and iTunes, all on', () => {
    const { order, off } = providerOrder()
    expect(order).toEqual(['musicbrainz', 'coverart', 'deezer', 'itunes'])
    expect(off.size).toBe(0)
  })
})

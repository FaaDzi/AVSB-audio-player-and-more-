import { describe, expect, it } from 'vitest'
import { getSpecialtyColor, resolveGenre, UNKNOWN_COVER } from './ui'
import { setCuratedSongs, withArtistGenres, withCuratedInfo, type Track } from './library'

const idOf = (speciality: string | undefined, genre: string) => getSpecialtyColor(speciality, genre).item?.id

describe('genre covers (plan §76 G)', () => {
  it('never invents a genre for an untagged song', () => {
    expect(resolveGenre(undefined, undefined, 'Untitled demo 3')).toBe('')
    // the singer's name in a Vocaloid rip's title is a genre word in all but name
    expect(resolveGenre(undefined, undefined, 'THE END OF HATSUNE MIKU - cosMo@Bousou-P')).toBe('vocaloid')
    expect(resolveGenre(undefined, undefined, '[IA] A Tale of Six Trillion Years and a Night')).toBe('vocaloid')
    expect(resolveGenre(undefined, undefined, 'Gumball Machine')).toBe('') // whole words only
    expect(resolveGenre('', undefined, 'Wrap me up')).toBe('') // "rap" inside a word is not a genre
    expect(resolveGenre(undefined, undefined, 'Lo-fi beats to study to')).toBe('lo-fi')
  })
  it('reads whole words in the genre tag', () => {
    expect(resolveGenre('Hip Hop/Rap')).toBe('hip-hop')
    expect(resolveGenre('Vocaloid')).toBe('vocaloid')
    expect(resolveGenre('Cinematic Classical')).toBe('cinematic')
  })
  it('maps genres to the right speciality, the most specific rule first', () => {
    expect(idOf(undefined, 'post-rock')).toBe('stage') // used to be "stage" only by accident, via "ost"
    expect(idOf(undefined, 'drum & bass')).toBe('speed')
    expect(idOf(undefined, 'synthpop')).toBe('treble')
    expect(idOf(undefined, 'vocaloid')).toBe('vocals')
    expect(idOf(undefined, 'pop rap')).toBe('bass')
    expect(idOf(undefined, 'midnight city')).toBeUndefined() // no "mid" → vocals by accident
    expect(idOf('Bass & Energy', 'pop')).toBe('bass') // a curated speciality wins over the genre
  })
  it('reads the owner’s real tag styles (follow-up)', () => {
    expect(idOf(undefined, resolveGenre('Films/Games; Film Scores'))).toBe('stage')
    expect(idOf(undefined, resolveGenre('Vgm'))).toBe('stage')
    expect(idOf(undefined, resolveGenre('Électronique'))).toBe('treble')
  })
  it('takes the curated list’s category ("what it tests") for its songs', () => {
    setCuratedSongs([{ title: 'Aegleseeker', artist: 'Silentroom', category: 'busy', genre: 'electronic' }, { title: 'Scarlet Fire', artist: 'Otis McDonald', category: 'bass' }])
    const t = (title: string, artist: string, genre = '') => ({ id: title, title, artist, genre }) as Track
    const [a, b, c] = withCuratedInfo([t('Aegleseeker - "Afterworld" Full Version', 'Silentroom, Frums'), t('Scarlet Fire', 'Otis McDonald', 'funk'), t('Scarlet Fire', 'Someone Else')])
    expect([a.category, a.genre]).toEqual(['busy', 'electronic'])
    expect([b.category, b.genre]).toEqual(['bass', 'funk']) // its own tag stays
    expect(c.category).toBeUndefined() // same title, another artist: not that song
    expect(idOf(a.category, resolveGenre(a.genre))).toBe('speed') // "busy" is the speed colour
    setCuratedSongs([])
  })
  it('gives songs with nothing to go on the neutral cover', () => {
    expect(getSpecialtyColor(undefined, '')).toEqual(UNKNOWN_COVER)
  })
  it("fills an untagged song with the artist's usual genre", () => {
    const t = (id: string, artist: string, genre = '') => ({ id, artist, genre }) as Track
    const out = withArtistGenres([t('1', 'Nas', 'hip-hop'), t('2', 'Nas', 'hip-hop'), t('3', 'Nas, AZ'), t('4', 'Unknown')])
    expect(out.map((x) => x.genre)).toEqual(['hip-hop', 'hip-hop', 'hip-hop', ''])
  })
  it('gives a rip with no artist the genre of an artist named in its title, and Unknown Artist songs nothing', () => {
    const t = (id: string, artist: string, title: string, genre = '') => ({ id, artist, title, genre }) as Track
    const out = withArtistGenres([
      t('1', 'Nas', 'Halftime', 'hip-hop'),
      t('2', 'Unknown Artist', 'NAS - The World Is Yours (Official Audio)'),
      t('3', 'Unknown Artist', 'Some Song', 'rock'),
      t('4', 'Unknown Artist', 'Another Song'),
    ])
    expect(out.map((x) => x.genre)).toEqual(['hip-hop', 'hip-hop', 'rock', ''])
  })
})

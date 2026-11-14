import { describe, expect, it } from 'vitest'
import { activeLine, parseLyrics, gapBefore, censorProfanity, uncensorProfanity, maskProfanityWord } from './lyrics'

describe('singers and word timing', () => {
  it('takes the singer label off the text', () => {
    const [line] = parseLyrics('[00:01.00]v1:Hello there')
    expect(line).toMatchObject({ at: 1, text: 'Hello there', voice: 'v1' })
  })
  it('reads words with an end mark', () => {
    const [line] = parseLyrics('[00:46.3]v2:<00:46.3>Hi <00:47.0><00:47.0>you<00:48.5>')
    expect(line.voice).toBe('v2')
    expect(line.text).toBe('Hi you')
    expect(line.words?.map((w) => w.text)).toEqual(['Hi ', 'you'])
    expect(line.words?.[1]).toMatchObject({ at: 47, end: 48.5 })
  })
  it('reads words with only start marks', () => {
    const [line] = parseLyrics('[00:20.0]<00:20.0>one <00:20.5>two')
    expect(line.voice).toBeUndefined()
    expect(line.text).toBe('one two')
    expect(line.words?.[0].end).toBe(20.5)
    expect(line.words?.[1].end).toBeNull()
  })
  it('finds silences before the first line and between word-timed lines', () => {
    const lines = parseLyrics('[00:10.0]<00:10.0>a<00:11.0>\n[00:30.0]<00:30.0>b<00:31.0>\n[00:32.0]<00:32.0>c<00:33.0>')
    expect(gapBefore(lines, 0)).toEqual({ start: 0, end: 10 })
    expect(gapBefore(lines, 1)).toEqual({ start: 11, end: 30 })
    expect(gapBefore(lines, 2)).toBeNull()
  })
})

describe('lyrics', () => {
  it('reads timestamps and sorts by time', () => {
    const lines = parseLyrics('[ar:Someone]\n[00:10.50]second\n[00:02.00]first')
    expect(lines.map((l) => l.text)).toEqual(['first', 'second'])
    expect(lines[1].at).toBeCloseTo(10.5)
  })

  it('repeats a line with two timestamps and strips word timing', () => {
    expect(parseLyrics('[00:01.00][00:05.00]again').map((l) => l.at)).toEqual([1, 5])
    expect(parseLyrics('[00:01.00]<00:01.00>one <00:02.00>two')[0].text).toBe('one two')
  })

  it('keeps plain lyrics unsynced', () => {
    const lines = parseLyrics('just words\nmore words')
    expect(lines.map((l) => l.at)).toEqual([null, null])
    expect(activeLine(lines, 30)).toBe(-1)
  })

  it('follows the position', () => {
    const lines = parseLyrics('[00:02.00]a\n[00:04.00]b')
    expect(activeLine(lines, 1)).toBe(-1)
    expect(activeLine(lines, 2)).toBe(0)
    expect(activeLine(lines, 99)).toBe(1)
  })
})

describe('background vocals', () => {
  it('attach to the line they follow, without their timings', () => {
    const lines = parseLyrics('[00:44.00]Main line\n[bg:<00:44.544>(Huh, <00:45.149>huh)<00:46.225>]\n[00:50.00]Next')
    expect(lines).toHaveLength(2)
    expect(lines[0].background).toBe('(Huh, huh)')
    expect(lines[1].background).toBeUndefined()
  })
})

describe('censor explicit lyrics', () => {
  it('masks profanity with asterisks while preserving first letter and length', () => {
    expect(maskProfanityWord('fuck')).toBe('f***')
    expect(maskProfanityWord('Fucking')).toBe('F******')
  })

  it('censors swear words in sentences while preserving casing and punctuation', () => {
    expect(censorProfanity('Fuck that shit!')).toBe('F*** that s***!')
    expect(censorProfanity('She is a bad bitch, yeah.')).toBe('She is a bad b****, yeah.')
    expect(censorProfanity('Get out, you asshole.')).toBe('Get out, you a******.')
  })

  it('does not censor non-profane words with similar substrings', () => {
    expect(censorProfanity('This classic bass pass is great.')).toBe('This classic bass pass is great.')
    expect(censorProfanity('Cocktail party.')).toBe('Cocktail party.')
  })

  it('restores any masked word the visible letters and length pin down (plan §76 B)', () => {
    expect(uncensorProfanity('Some b**ches and p****')).toBe('Some bitches and pussy')
    expect(uncensorProfanity('N****, what?')).toBe('Nigga, what?')
    expect(uncensorProfanity('That d**n thing')).toBe('That damn thing')
    // nothing to go on, or not a swear word: left as it is
    expect(uncensorProfanity('I told you **** quit')).toBe('I told you **** quit')
    expect(uncensorProfanity('An x-ray of a well-known mid-tempo song')).toBe('An x-ray of a well-known mid-tempo song')
    expect(uncensorProfanity('Madman never go *pop* like snot')).toBe('Madman never go *pop* like snot')
  })

  it('unmasks pre-censored words from radio/clean edits when censorship is off', () => {
    expect(uncensorProfanity('F*** that s***!')).toBe('Fuck that shit!')
    expect(uncensorProfanity('She is a bad b****, yeah.')).toBe('She is a bad bitch, yeah.')
    expect(uncensorProfanity('Get out, you a******.')).toBe('Get out, you asshole.')
    expect(uncensorProfanity('What the f***ing hell')).toBe('What the fucking hell')
    expect(uncensorProfanity('Straight bullshit')).toBe('Straight bullshit')
    expect(uncensorProfanity('f#ck this sh!t and that b!tch')).toBe('fuck this shit and that bitch')
    expect(uncensorProfanity('All my n****s and h*es')).toBe('All my niggas and hoes')
    expect(uncensorProfanity('Stop being a d*ckhead and a b*stard')).toBe('Stop being a dickhead and a bastard')
    expect(uncensorProfanity('Quit p*ssing me off')).toBe('Quit pissing me off')
    expect(uncensorProfanity('You dumb*** jack***')).toBe('You dumbass jackass')
    expect(uncensorProfanity('f--- that s---')).toBe('fuck that shit')
    expect(uncensorProfanity('f***in\' right')).toBe('fuckin\' right')
    expect(uncensorProfanity('You muthaf***a and mothaf***er')).toBe('You muthafucka and mothafucker')
    expect(uncensorProfanity('Shout out to my n*ggaz')).toBe('Shout out to my niggaz')
    expect(uncensorProfanity('Bust your a**es')).toBe('Bust your asses')
    expect(uncensorProfanity('What the h*ll')).toBe('What the hell')
    expect(uncensorProfanity('g*ddammit')).toBe('goddammit')
  })
})

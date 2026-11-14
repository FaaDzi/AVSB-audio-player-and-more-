import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeIemData, type IemData } from '../audio/data'
import { mergeDuplicates, setFamilies, splitName } from '../data/catalog'
import { tidyCatalog } from '../data/tidy'
import { searchIems } from './iemSearch'

const load = (f: string): IemData => decodeIemData(JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf-8')))
const aliases = JSON.parse(readFileSync(new URL('../../public/data/aliases.json', import.meta.url), 'utf-8'))
setFamilies(aliases.families)
const iems = load('iems.json')
const hp = load('headphones.json')
const byId = new Map(iems.iems.map((i) => [i.id, i]))
const hpById = new Map(hp.iems.map((i) => [i.id, i]))
mergeDuplicates(iems, byId, aliases.merge, [])
tidyCatalog(iems, byId, 'iems', [])
mergeDuplicates(hp, hpById, aliases.merge, [])
tidyCatalog(hp, hpById, 'headphones', [])
const all = [...iems.iems, ...hp.iems]

/** The top suggestion's model, as the picker shows it. */
const top = (q: string) => splitName(searchIems(all, q)[0]?.name ?? '').model

describe('search on the real catalog', () => {
  it.each([
    ['hd 600', /^Sennheiser HD ?600$/],
    ['hd600', /^Sennheiser HD ?600$/],
    ['chu 2', /^Moondrop Chu 2/],
    ['airpods pro 2', /^Apple AirPods Pro 2$/i],
    ['truthear zero', /^Truthear Zero$/i],
    ['ie 600', /^Sennheiser IE ?600$/i],
    ['kato', /^Moondrop Kato$/i],
    ['blessing 3', /^Moondrop Blessing 3$/i],
    ['xm5', /^Sony W[FH]-1000XM5$/i],
    ['crinear daybreak', /^CrinEar Daybreak$/i],
  ])('"%s" → %s', (q, want) => {
    expect(top(q)).toMatch(want)
  })

  it('shows one brand spelling per model after the tidy (IEMs, TWS, and Headphones)', () => {
    const spellings = (re: RegExp) => new Set(all.filter((i) => re.test(splitName(i.name).model)).map((i) => splitName(i.name).model))
    expect(spellings(/^final( audio)? a5000$/i).size).toBe(1)
    expect(spellings(/^cvj( audio)? assassin$/i).size).toBe(1)
    expect(spellings(/^aful( acoustics| audio)? performer 8s$/i).size).toBe(1)
    expect(spellings(/^crinears? daybreak$/i).size).toBe(1)
    expect(spellings(/^crinears? meta$/i).size).toBe(1)
    expect(spellings(/^moondrop ultrasonic(\s+tws)?$/i).size).toBe(1)
    expect(spellings(/^moondrop moca(\s+tws)?$/i).size).toBe(1)
    expect(spellings(/^audio[ -]technica (?:ath-)?r50x$/i).size).toBe(1)
    expect(spellings(/^focal clear mg pro(?:fessional)?$/i).size).toBe(1)
    expect(spellings(/^moondrop cosmo(?:\s+[12]\/2)?$/i).size).toBe(1)
  })
})

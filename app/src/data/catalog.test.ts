import { afterEach, describe, expect, it } from 'vitest'
import type { Iem } from '../audio/data'
import { bracketCatalog, gearWords, graphOf, groupVariants, kindOfIem, mergeDuplicates, modelKey, setFamilies, splitName, type Catalog } from './catalog'

afterEach(() => setFamilies({}))

describe('splitName', () => {
  it('splits a trailing variant off the model', () => {
    expect(splitName('64 Audio A12t (m15 Apex module)')).toEqual({ model: '64 Audio A12t', variant: 'm15 Apex module' })
  })
  it('leaves names without a trailing variant whole', () => {
    expect(splitName('AFUL Performer 5+2')).toEqual({ model: 'AFUL Performer 5+2', variant: null })
    expect(splitName('(Airline Ear Earbuds) Delta Airlines Earbuds').variant).toBeNull()
  })
  it('treats a family prefix as the model', () => {
    setFamilies({ 'ZIIGAAT x JAY ESTRELLA': 'ZiiGaat Estrella' })
    expect(splitName('ZIIGAAT x JAY ESTRELLA KBear KT01 CLEAR')).toEqual({ model: 'ZiiGaat Estrella', variant: 'KBear KT01 CLEAR' })
    expect(modelKey('ZIIGAAT x JAY ESTRELLA Spinfit Omni')).toBe(modelKey('ZiiGaat Estrella'))
  })
})

describe('groupVariants', () => {
  it('puts variants of one model together, plain model first', () => {
    const rows = ['Kato (gold nozzle)', 'Aria', 'Kato', 'Kato (silver nozzle)'].map((name) => ({ iem: { name } }))
    const groups = groupVariants(rows).map((g) => g.map((r) => r.iem.name))
    expect(groups).toEqual([['Kato', 'Kato (gold nozzle)', 'Kato (silver nozzle)'], ['Aria']])
  })
})

describe('mergeDuplicates', () => {
  const iem = (id: string, sources: string[]): Iem => ({ id, name: id, source: sources[0], sources, fr: [], metrics: {} as Iem['metrics'] })
  it('hides the duplicate, keeps its id resolving, and moves its extras over', () => {
    const data = { iems: [iem('p52', ['Jay']), iem('aful-acoustics-p52', ['Super Review']), iem('aria', ['Jay'])] }
    const byId = new Map(data.iems.map((i) => [i.id, i]))
    const images: Record<string, unknown> = { 'aful-acoustics-p52': 'photo' }
    mergeDuplicates(data, byId, { 'aful-acoustics-p52': 'p52', ghost: 'p52' }, [images])
    expect(data.iems.map((i) => i.id)).toEqual(['p52', 'aria'])
    expect(byId.get('aful-acoustics-p52')?.id).toBe('p52')
    expect(byId.get('p52')?.sources).toEqual(['Jay', 'Super Review'])
    expect(images.p52).toBe('photo')
  })
})

describe('bracket kinds', () => {
  const row = (id: string, name: string) => ({ id, name }) as Iem
  it('tells wired IEMs, TWS and headphones apart', () => {
    expect(kindOfIem(row('moondrop-aria', 'Moondrop Aria'))).toBe('iems')
    expect(kindOfIem(row('apple-airpods-pro', 'Apple AirPods Pro'))).toBe('tws')
    expect(kindOfIem(row('hp-sennheiser-hd-600', 'Sennheiser HD 600'))).toBe('headphones')
    expect(gearWords('headphones').upper).toBe('HEADPHONE')
  })
  it('keeps one in-ear kind per bracket, with duplicate ids still resolving', () => {
    const aria = row('moondrop-aria', 'Moondrop Aria')
    const pods = row('apple-airpods-pro', 'Apple AirPods Pro')
    const inEars = {
      kind: 'iems',
      data: { iems: [aria, pods] },
      byId: new Map([['moondrop-aria', aria], ['aria-dup', aria], ['apple-airpods-pro', pods]]),
    } as unknown as Catalog
    const wired = bracketCatalog(inEars, 'iems')
    expect(wired.data.iems).toEqual([aria])
    expect([...wired.byId.keys()]).toEqual(['moondrop-aria', 'aria-dup'])
    const tws = bracketCatalog(inEars, 'tws')
    expect(tws.kind).toBe('tws')
    expect(tws.byId.has('moondrop-aria')).toBe(false)
  })
})

describe('graphOf', () => {
  const iem = { id: 'a', name: 'IEM', fr: [10, 20] } as unknown as Iem
  const hpA = { id: 'hp-a', name: 'HP A', fr: [10, 20] } as unknown as Iem
  const hpB = { id: 'hp-b', name: 'HP B', fr: [0, 0] } as unknown as Iem
  const inEar = [{ name: 'Harman in-ear 2019', note: '', values: [0, 0] }]
  const overEar = [{ name: 'Harman over-ear 2018', note: '', values: [5, -5] }]
  const c = {
    data: { frScale: 0.1 },
    targets: inEar,
    headphones: { targets: overEar, toNative: Float64Array.from([3, -3]) },
  } as unknown as Catalog
  it('graphs headphones alone in their over-ear shape against over-ear targets', () => {
    const g = graphOf(c, [hpA, hpB])
    expect(g.targets).toBe(overEar)
    expect([...g.fr(hpA)]).toEqual([4, -1])
  })
  it('keeps a headphone next to an in-ear on the in-ear baseline', () => {
    const g = graphOf(c, [hpA, iem])
    expect(g.targets).toBe(inEar)
    expect([...g.fr(hpA)]).toEqual([1, 2])
  })
  it('leaves in-ears alone', () => {
    expect(graphOf(c, [iem]).targets).toBe(inEar)
  })
})

import { describe, expect, it } from 'vitest'
import { kindOfLabel, MEASURED, pickersFor, rowForChoice, splitConfig, type ConfigRow } from './configs'

const row = (id: string, variant: string | null, source = 'Jay (squig.link)'): ConfigRow => ({ id, variant, source })

describe('sorting config labels', () => {
  it('tells kinds apart by their words', () => {
    expect(kindOfLabel('Foam Tips')).toBe('Tips')
    expect(kindOfLabel('gold nozzle')).toBe('Nozzle')
    expect(kindOfLabel('Treble Filter')).toBe('Filter')
    expect(kindOfLabel('on-on-off')).toBe('Switch')
    expect(kindOfLabel('UDDU')).toBe('Switch')
    expect(kindOfLabel('ANC ON')).toBe('Mode')
    expect(kindOfLabel('15 Ohm')).toBe('Adapter')
    expect(kindOfLabel('Limited Edition')).toBe('Version')
  })
  it('splits a label holding several choices', () => {
    expect(splitConfig('Foam Tips, ANC OFF, EQ OFF')).toEqual({ Tips: 'Foam Tips', Mode: 'ANC OFF EQ OFF' })
    expect(splitConfig('black tips + no mesh')).toEqual({ Tips: 'black tips', Filter: 'no mesh' })
    expect(splitConfig(null)).toEqual({})
  })
})

describe('config pickers', () => {
  const rows = [
    row('a', null),
    row('b', 'Foam Tips'),
    row('c', 'gold nozzle'),
    row('d', 'Foam Tips, gold nozzle'),
  ]
  it('offers one picker per kind that varies', () => {
    const pickers = pickersFor(rows, 'a')
    expect(pickers.map((p) => p.kind)).toEqual(['Tips', 'Nozzle'])
    expect(pickers[0]).toEqual({ kind: 'Tips', value: 'Standard', options: ['Standard', 'Foam Tips'] })
  })
  it('nothing to pick on a model with one row', () => {
    expect(pickersFor([row('a', null)], 'a')).toEqual([])
    expect(pickersFor([row('a', 'Foam Tips')], 'a')).toEqual([])
  })
  it('keeps the other choices when one changes', () => {
    expect(rowForChoice(rows, 'c', 'Tips', 'Foam Tips')).toBe('d')
    expect(rowForChoice(rows, 'b', 'Tips', 'Standard')).toBe('a')
  })
  it('moves as little as it can when an exact match is missing', () => {
    expect(rowForChoice(rows.slice(0, 3), 'c', 'Tips', 'Foam Tips')).toBe('b')
  })
  it('treats who measured it as a choice of its own', () => {
    const two = [row('a', null, 'Jay (squig.link)'), row('b', null, 'Crinacle (squig.link)')]
    const [picker] = pickersFor(two, 'a')
    expect(picker.kind).toBe(MEASURED)
    expect(picker.options).toEqual(['Crinacle', 'Jay'])
    expect(rowForChoice(two, 'a', MEASURED, 'Crinacle')).toBe('b')
  })
})

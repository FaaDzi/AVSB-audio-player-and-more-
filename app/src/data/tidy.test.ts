import { describe, expect, it } from 'vitest'
import type { Iem } from '../audio/data'
import { splitName } from './catalog'
import { brandKey, cleanName, cleanVariant, tidyCatalog } from './tidy'

const grid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000]
const flat = grid.map(() => 0)
const iem = (id: string, name: string, fr: number[] = flat, sources = ['A']): Iem => ({
  id,
  name,
  source: sources[0],
  sources,
  fr,
  metrics: {} as Iem['metrics'],
})
function tidy(rows: Iem[], kind: 'iems' | 'headphones' = 'iems') {
  const data = { iems: rows, grid, frScale: 1 }
  const byId = new Map(rows.map((i) => [i.id, i]))
  tidyCatalog(data, byId, kind, [])
  return { names: data.iems.map((i) => i.name), byId }
}

describe('cleanName / brandKey', () => {
  it('drops source leftovers and consecutive doubled brand words', () => {
    expect(cleanName("Campfire Audio ['Andromeda']")).toBe('Campfire Audio Andromeda')
    expect(cleanName("<Mod> 'Moondrop Chu II Modded'")).toBe('Moondrop Chu II Modded')
    expect(cleanName('MYER-AUDIO  SLIIVO SL41')).toBe('MYER-AUDIO SLIIVO SL41')
    expect(cleanName('Head(amame) Head(amame) Closed')).toBe('Head(amame) Closed')
    expect(cleanName('Beats Beats Fit Pro')).toBe('Beats Fit Pro')
    expect(cleanName('Moondrop MOONDROP x HSR Robin')).toBe('Moondrop x HSR Robin')
    expect(cleanName('Alpha Omega Omega')).toBe('Alpha Omega Omega')
  })
  it('gives brand spellings of one model the same key', () => {
    expect(brandKey('Final Audio A5000')).toBe(brandKey('Final A5000'))
    expect(brandKey('MYER-AUDIO SLIIVO SL41')).toBe(brandKey('Myer SLIIVO SL41'))
    expect(brandKey('Moondrop Chu II')).toBe(brandKey('Moondrop Chu 2'))
    expect(brandKey('CrinEar Daybreak')).toBe(brandKey('CrinEars Daybreak'))
    expect(brandKey('RØDE NTH-100')).toBe(brandKey('Rode NTH-100'))
    expect(brandKey('Moondrop Ultrasonic TWS')).toBe(brandKey('Moondrop Ultrasonic'))
    expect(brandKey('Audio-Technica ATH-R50x')).toBe(brandKey('Audio Technica R50x'))
    expect(brandKey('Focal Clear Mg Professional')).toBe(brandKey('Focal Clear Mg Pro'))
    expect(brandKey('ASUS ROG x Hifiman Kithara')).toBe(brandKey('ASUS ROG Kithara'))
    expect(brandKey('Audio-Technica ATH-M50x')).not.toBe(brandKey('Technica ATH-M50x'))
  })
})

describe('splitName / cleanVariant', () => {
  it('handles nested parentheses in variant labels', () => {
    expect(splitName('CrinEar Daybreak (CrinEar Daybreak (Coffee Tips))')).toEqual({
      model: 'CrinEar Daybreak',
      variant: 'CrinEar Daybreak (Coffee Tips)',
    })
  })
  it('drops the repeated model name and reviewer bookkeeping', () => {
    expect(cleanVariant('64 Audio Aspire 1', '64 Audio Aspire 1 deep')).toBe('deep')
    expect(cleanVariant('Final E4000', 'E4000 S1 (by 냥냐냥) (9k Peak)')).toBe('')
    expect(cleanVariant('Kiwi Ears Cadenza', 'Cadenza S1 (by ㅇㅇ, Final E Tips)')).toBe('Final E Tips')
    expect(cleanVariant('AFUL Performer 5', 'Aful Acoustics Performer5 (15 ohm)', { dropOhm: true })).toBe('')
    expect(cleanVariant('Aiderlot M5', 'Treble + 80ohm', { dropOhm: true })).toBe('Treble')
    expect(cleanVariant('CrinEar Daybreak', 'CrinEars Daybreak (Coffee Tips)', { dropOhm: true })).toBe('Coffee Tips')
  })
})

describe('tidyCatalog', () => {
  it('merges brand spellings into one model with the most used spelling', () => {
    const { names } = tidy([iem('a', 'Final A5000'), iem('b', 'Final Audio A5000 (foam)', grid.map((_, i) => i)), iem('c', 'Final A5000 (deep)', grid.map((_, i) => -i))])
    expect(names).toEqual(['Final A5000', 'Final A5000 (foam)', 'Final A5000 (deep)'])
  })

  it('merges CrinEar Daybreak and CrinEars Daybreak, nested parens, bare ohms, and duplicate fit/tip labels', () => {
    const { names } = tidy([
      iem('d1', 'CrinEar Daybreak'),
      iem('d2', 'CrinEars Daybreak'),
      iem('d3', 'CrinEar Daybreak (CrinEar Daybreak 75)', grid.map((_, i) => i * 2)),
      iem('d4', 'CrinEar Daybreak (CrinEar Daybreak deep)', grid.map((_, i) => i)),
      iem('d5', 'CrinEar Daybreak (CrinEar Daybreak (Deep Fit))', grid.map((_, i) => -i)),
      iem('d6', 'CrinEar Daybreak (CrinEar Daybreak (Coffee Tips))', grid.map((_, i) => (i % 2 ? 4 : 0))),
      iem('d7', 'CrinEars Daybreak (CrinEars Daybreak Coffee)', grid.map((_, i) => (i % 2 ? 0 : 4))),
    ])
    expect(names).toEqual(['CrinEar Daybreak', 'CrinEar Daybreak (deep)', 'CrinEar Daybreak (Coffee Tips)'])
  })

  it('hides IEM impedance and adapter rows when the model has another row, ids still resolve', () => {
    const bumpy = grid.map((_, i) => (i % 2 ? 3 : 0))
    const { names, byId } = tidy([
      iem('p', 'AFUL Explorer'),
      iem('p15', 'AFUL Explorer (AFUL Explorer 15 Ohm)', bumpy),
      iem('p75', 'AFUL Explorer 75 Ohm', bumpy),
      iem('pa', 'AFUL Explorer (with 50ohm resistor)', bumpy.map((v) => -v)),
    ])
    expect(names).toEqual(['AFUL Explorer'])
    expect(byId.get('p15')?.id).toBe('p')
    expect(byId.get('pa')?.id).toBe('p')
  })

  it('keeps the lowest-ohm row as the plain model when every row is ohm-tagged', () => {
    const { names, byId } = tidy([iem('h', '7Hz Elua (7Hz Elua 30 Ohm)', grid.map((_, i) => i)), iem('l', '7Hz Elua (7Hz Elua 15 Ohm)')])
    expect(names).toEqual(['7Hz Elua'])
    expect(byId.get('h')?.id).toBe('l')
  })

  it('keeps headphone ohm models', () => {
    const { names } = tidy([iem('hp-1', 'Beyerdynamic DT 770 (32 Ohm)', grid.map((_, i) => i)), iem('hp-2', 'Beyerdynamic DT 770 (250 Ohm)')], 'headphones')
    expect(names).toHaveLength(2)
  })

  it('folds re-measurements with the same curve, never switch settings or a low-end change', () => {
    const bass = grid.map((f) => (f <= 50 ? 4 : 0))
    const { names } = tidy([
      iem('k', 'KZ Duonic'),
      iem('k2', 'KZ Duonic (Sample 2)', flat.map((v) => v + 0.3)),
      iem('k3', 'KZ Duonic (foam tips)', flat.map((v) => v + 0.5)),
      iem('kb', 'KZ Duonic (bass mode)', bass),
      iem('s1', 'KZ Duonic (UDUD)'),
      iem('s2', 'KZ Duonic (DUDU)'),
    ])
    expect(names).toEqual(['KZ Duonic', 'KZ Duonic (bass mode)', 'KZ Duonic (UDUD)', 'KZ Duonic (DUDU)'])
  })
})

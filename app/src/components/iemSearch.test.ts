import { describe, expect, it } from 'vitest'
import type { Iem } from '../audio/data'
import { loudnessMatchDb } from '../audio/loudness'
import { searchIems } from './iemSearch'

const iem = (name: string) => ({ id: name, name, source: 'x', sources: ['x'], fr: [], metrics: {} }) as unknown as Iem

describe('searchIems', () => {
  const list = ['Moondrop Blessing 3', 'Truthear Hexa', 'Moondrop Aria', 'Kiwi Ears Aria Clone'].map(iem)
  it('matches every word, the closest model first', () => {
    expect(searchIems(list, 'aria').map((i) => i.name)).toEqual(['Moondrop Aria', 'Kiwi Ears Aria Clone'])
    expect(searchIems(list, 'moon').map((i) => i.name)).toEqual(['Moondrop Aria', 'Moondrop Blessing 3'])
    expect(searchIems(list, 'drop bless').map((i) => i.name)).toEqual(['Moondrop Blessing 3'])
    expect(searchIems(list, '  ')).toEqual([])
  })
  it('matches word starts only for short words, joins letters and digits, reads II as 2', () => {
    const more = ['Moondrop Chu 2', 'Audio Technica ATH-R50x (with Chux x2 mod)', 'Sennheiser HD 600', 'Capra Satyr 2 (HD600 pads)', 'Apple AirPods Pro 2', 'Airoha AirPods Pro 1562A'].map(iem)
    expect(searchIems(more, 'chu ii')[0].name).toBe('Moondrop Chu 2')
    expect(searchIems(more, 'chu 2')[0].name).toBe('Moondrop Chu 2')
    expect(searchIems(more, 'hd600')[0].name).toBe('Sennheiser HD 600')
    expect(searchIems(more, 'airpods pro 2').map((i) => i.name)).toEqual(['Apple AirPods Pro 2'])
  })
  it('lets brand filler words go unmatched', () => {
    expect(searchIems([iem('Final A5000')], 'final audio a5000').map((i) => i.name)).toEqual(['Final A5000'])
  })
})

describe('loudnessMatchDb', () => {
  const grid = [20, 100, 1000, 10000, 20000]
  it('is 0 for no EQ and undoes a flat boost or cut', () => {
    expect(loudnessMatchDb(grid, [0, 0, 0, 0, 0])).toBeCloseTo(0, 6)
    expect(loudnessMatchDb(grid, [6, 6, 6, 6, 6])).toBeCloseTo(-6, 6)
    expect(loudnessMatchDb(grid, [-4, -4, -4, -4, -4])).toBeCloseTo(4, 6)
  })
  it('turns a bass-only boost down far less than its peak', () => {
    const g = loudnessMatchDb(grid, [10, 8, 0, 0, 0])
    expect(g).toBeLessThan(0)
    expect(g).toBeGreaterThan(-5)
  })
})

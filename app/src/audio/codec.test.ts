import { describe, expect, it } from 'vitest'
import { decodeIemData, type IemData } from './data'

// strings made by scripts/frcodec.py
const wrap = (fr: string) => ({ grid: [], frScale: 0.1, target: { name: 't', fr: [] }, bands: {}, calibration: {}, iems: [{ id: 'a', name: 'a', source: 's', sources: ['s'], fr, metrics: {} }] }) as unknown as IemData

describe('packed curves', () => {
  it('reads the step form', () => {
    expect([...decodeIemData(wrap('~CgAKCg==')).iems[0].fr]).toEqual([10, 20, 30])
  })
  it('reads the int16 form (a step too big for 8 bits)', () => {
    // encode([0, 5, -3, 130, -200])
    expect([...decodeIemData(wrap('AAAFAP3/ggA4/w==')).iems[0].fr]).toEqual([0, 5, -3, 130, -200])
  })
})

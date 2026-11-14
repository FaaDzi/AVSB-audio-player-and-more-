import { describe, expect, it } from 'vitest'
import { trebleDetail } from './trebleDetail'

const agree = { lowerTreble: 1.5, air: 2 }
const noisy = { lowerTreble: 1.5, air: 4 }

describe('trebleDetail', () => {
  it('keeps full detail for a same-kind pair whose graphs agree', () => {
    expect(trebleDetail('auto', 'hp-hd600', 'hp-he600', agree, agree)).toBe('full')
    expect(trebleDetail('auto', 'starfield', 'aria', agree, agree)).toBe('full')
  })
  it('treats a model measured once like one with the typical spread', () => {
    expect(trebleDetail('auto', 'hp-hd600', 'hp-he600', agree, null)).toBe('full')
    expect(trebleDetail('auto', 'hp-hd600', 'hp-he600', undefined, undefined)).toBe('full')
  })
  it('smooths across kinds, for noisy data, and for targets', () => {
    expect(trebleDetail('auto', 'starfield', 'hp-hd600', agree, agree)).toBe('held')
    expect(trebleDetail('auto', 'hp-hd600', 'hp-he600', agree, noisy)).toBe('held')
    expect(trebleDetail('auto', 'hp-hd600', null, agree, null)).toBe('held')
    expect(trebleDetail('auto', null, 'hp-he600', null, agree)).toBe('held')
  })
  it('follows the Settings override', () => {
    expect(trebleDetail('held', 'hp-hd600', 'hp-he600', agree, agree)).toBe('held')
    expect(trebleDetail('measured', 'starfield', 'hp-hd600', null, null)).toBe('full')
  })
})

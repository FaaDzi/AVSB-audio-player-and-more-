import { describe, expect, it } from 'vitest'
import { roomLimit, roomTargets } from './soundCurve'
import { kindOfIem } from '../../data/catalog'

const grid = [50, 100, 200, 250, 315, 1000, 2000, 8000]

describe('speakers and soundbars (§78 B)', () => {
  it('in-room targets fall by their slope per octave through 1 kHz', () => {
    const harman = roomTargets(grid).find((t) => t.name === 'In-room −0.8 dB/oct')!
    expect(harman.values[grid.indexOf(1000)]).toBeCloseTo(0)
    expect(harman.values[grid.indexOf(2000)]).toBeCloseTo(-0.8)
    expect(harman.values[grid.indexOf(250)]).toBeCloseTo(1.6)
  })

  it('caps bass boost at +3 dB below 200 Hz, opens by 315 Hz, and leaves cuts alone', () => {
    const out = roomLimit(grid, Float64Array.from([8, -6, 8, 8, 8, 8, 8, 8]), 10)
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(-6)
    expect(out[2]).toBe(3)
    expect(out[3]).toBeGreaterThan(3)
    expect(out[3]).toBeLessThan(8)
    expect(out[4]).toBe(8)
    expect(out[5]).toBe(8)
  })

  it('knows speakers and soundbars by id', () => {
    expect(kindOfIem({ id: 'spk-jbl-104', name: 'JBL 104' })).toBe('speakers')
    expect(kindOfIem({ id: 'spk-generic-soundbar', name: 'Generic soundbar (rough)' })).toBe('soundbar')
    expect(kindOfIem({ id: 'generic-tws', name: 'Generic TWS earbuds (≤ Rp 800k)' })).toBe('tws')
    expect(kindOfIem({ id: 'hp-generic', name: 'Generic headphones (≤ $50)' })).toBe('headphones')
  })
})

describe('soundbars (§80 D)', () => {
  it('get no bass boost below 200 Hz', () => {
    const out = roomLimit(grid, Float64Array.from([8, -6, 8, 8, 8, 8, 8, 8]), 10, 0)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(-6)
    expect(out[4]).toBe(8)
  })
})

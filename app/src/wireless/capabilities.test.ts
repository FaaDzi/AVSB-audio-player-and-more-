import { describe, expect, it } from 'vitest'
import { capsFor, earbudsPlan, nearestStop, noiseStops, placeholderPositions, stopIndex, stopPositions } from './capabilities'

describe('universal wireless control (§117)', () => {
  it('each pair gets its own stops: Buds2 cancelling, off, ambient; Sony ambient 1-20; open-ear none', () => {
    const buds2 = noiseStops(capsFor('samsung', 'Galaxy Buds2').noise!)
    expect(buds2.map((s) => `${s.mode}${s.level ?? ''}`)).toEqual(['1', '0', '20', '21', '22'])
    expect(stopIndex(buds2, { mode: 2, level: 1 })).toBe(3)
    expect(noiseStops(capsFor('sony', 'WH-1000XM4').noise!)).toHaveLength(22)
    expect(capsFor('tanchjim-revo', 'TANCHJIM-REVO')).toMatchObject({ noise: null, noiseWhy: 'open-ear', game: true, connection: true })
    expect(capsFor('gaia', 'AZ09 Pro')).toMatchObject({ noise: null, game: false, gameWhy: 'buttons' })
    expect(capsFor('gaia', 'AZ09 Pro').gestures?.[0].does).toMatch(/Game mode/)
  })

  it('a state finds its stop', () => {
    const stops = noiseStops(capsFor('sony', 'WH-1000XM4').noise!)
    expect(stopIndex(stops, { mode: 1 })).toBe(0)
    expect(stopIndex(stops, { mode: 0 })).toBe(1)
    expect(stopIndex(stops, { mode: 2, level: 10 })).toBe(11)
    expect(stopIndex(stops, { mode: 2, level: 0 })).toBe(2)
  })

  it('the earbud part of a preset only uses what a pair has', () => {
    expect(earbudsPlan({ noise: 'anc', game: 1 }, capsFor('tanchjim-revo', 'TANCHJIM-REVO'))).toEqual({ noise: undefined, game: 1 })
    expect(earbudsPlan({ noise: 'ambient-mid', game: 0 }, capsFor('sony', 'WH-1000XM4'))).toEqual({ noise: { mode: 2, level: 11, voice: false }, game: undefined })
    expect(earbudsPlan({ noise: 'ambient-mid', game: 1 }, capsFor('samsung', 'Galaxy Buds2'))).toEqual({ noise: { mode: 2, level: 1, voice: false }, game: undefined })
    expect(earbudsPlan({ noise: 'off', game: 0 }, capsFor('gaia', 'AZ09 Pro'))).toEqual({ noise: undefined, game: undefined })
  })

  it('nodes are evenly spaced; a missing side keeps a grey reference node (§120)', () => {
    expect(stopPositions(noiseStops(capsFor('samsung', 'Galaxy Buds2').noise!))).toEqual([0, 0.25, 0.5, 0.75, 1])
    // A30: cancelling, Off, and a grey Ambient placeholder at the end, so Off is the middle node
    expect(stopPositions(noiseStops(capsFor('soundcore-d1301', 'soundcore Sleep A30').noise!))).toEqual([0, 0.5])
    expect(placeholderPositions(noiseStops(capsFor('soundcore-d1301', 'soundcore Sleep A30').noise!))).toEqual([1])
    const sony = stopPositions(noiseStops(capsFor('sony', 'WH-1000XM4').noise!))
    expect(sony[1]).toBeCloseTo(1 / 21)
    expect(sony[21]).toBe(1)
    expect(nearestStop([0, 0.5, 1], 0.7)).toBe(1)
  })
})

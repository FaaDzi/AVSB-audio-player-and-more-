import { describe, expect, it } from 'vitest'
import { isListeningName, listening, listeningName, presetFilters } from './listeningPresets'

const grid = Array.from({ length: 121 }, (_, i) => 20 * 1000 ** (i / 120))
const flat = grid.map(() => 0)
// a WH-1000XM4-like response: bass about +6 dB over neutral below 200 Hz
const bassy = grid.map((f) => (f < 200 ? 6 : 0))
const thin = grid.map((f) => (f < 200 ? -3 : 0))

describe('listening presets (§118): no blind adds', () => {
  it('a neutral gear gets the full table values', () => {
    expect(presetFilters(listening('street'), grid, flat)[0]).toMatchObject({ kind: 'lowshelf', gain: 4 })
    expect(presetFilters(listening('fps'), grid, flat).map((f) => f.gain)).toEqual([-4, 4, -2])
  })

  it('bass the gear already has is not added again; a cut the gear already has is not cut again', () => {
    expect(presetFilters(listening('street'), grid, bassy)[0].gain).toBe(0)
    expect(presetFilters(listening('fps'), grid, thin)[0].gain).toBe(-1)
  })

  it('never boosts past what the preset wants, even on thin gear (fixing the gear is AutoEQ’s job)', () => {
    expect(presetFilters(listening('street'), grid, thin)[0].gain).toBe(4)
  })

  it('no measurement: half the table values', () => {
    expect(presetFilters(listening('fps'), null, null).map((f) => f.gain)).toEqual([-2, 2, -1])
  })

  it('names', () => {
    expect(listeningName(listening('fps'))).toBe('Gaming · FPS')
    expect(isListeningName('Focus')).toBe(true)
    expect(isListeningName('My warm EQ')).toBe(false)
  })
})

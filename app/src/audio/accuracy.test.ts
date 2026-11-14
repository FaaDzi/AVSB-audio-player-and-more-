import { describe, expect, it } from 'vitest'
import { simAccuracy } from './accuracy'
import type { Band } from './data'

// 1/24-octave grid, 20 Hz–20 kHz
const grid = Array.from({ length: 240 }, (_, i) => 20 * 2 ** (i / 24))
const bands: Record<Band, [number, number]> = {
  subBass: [20, 60], midBass: [60, 250], lowerMids: [250, 1000], upperMids: [1000, 4000], lowerTreble: [4000, 10000], air: [10000, 20000],
}
const zeros = grid.map(() => 0)
const spread = { subBass: 0.2, midBass: 0.2, lowerMids: 0.2, upperMids: 0.2, lowerTreble: 0.2, air: 0.2 }

describe('simAccuracy', () => {
  it('a reachable difference on a well-measured device is accurate', () => {
    const candidate = grid.map((f) => (f < 200 ? 4 : 0))
    const a = simAccuracy({ grid, bands, candidate, reference: zeros, spread })
    expect(a.label).toBe('accurate')
    expect(a.limit).toBeNull()
  })

  it('sub-bass beyond the boost limit is blamed on the device', () => {
    const reference = grid.map((f) => (f < 60 ? -20 : 0)) // rolls off hard below 60 Hz
    const a = simAccuracy({ grid, bands, candidate: zeros, reference, spread })
    expect(a.limit).toBe('subBass')
    expect(a.why).toBe('device')
    expect(a.label).not.toBe('accurate')
  })

  it('disagreeing measurements of the device are blamed on the measurements', () => {
    const a = simAccuracy({ grid, bands, candidate: zeros, reference: zeros, spread: { ...spread, midBass: 3 } })
    expect(a.limit).toBe('midBass')
    expect(a.why).toBe('measurement')
  })
})

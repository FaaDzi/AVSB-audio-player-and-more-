import { describe, expect, it } from 'vitest'
import { designFir, firResponseDb, linearPhaseFir, minPhaseFir } from './filter'

const grid = Array.from({ length: 241 }, (_, i) => 20 * 1000 ** (i / 240))
// a 6 dB bump at 1 kHz and a 4 dB treble dip: a typical sim curve
const curve = grid.map((f) => 6 * Math.exp(-((Math.log2(f / 1000) / 0.5) ** 2)) - 4 * Math.exp(-((Math.log2(f / 8000) / 0.4) ** 2)))
const check = [100, 500, 1000, 3000, 8000]
const at = (f: number) => curve[grid.findIndex((g) => g >= f)]

describe('linearPhaseFir', () => {
  const taps = linearPhaseFir(grid, curve, 48000, 4096)
  it('follows the curve like the minimum-phase filter does', () => {
    const lin = firResponseDb(taps, 48000, check)
    const min = firResponseDb(minPhaseFir(grid, curve, 48000, 4096), 48000, check)
    check.forEach((f, i) => {
      expect(lin[i]).toBeCloseTo(at(f), 0)
      expect(Math.abs(lin[i] - min[i])).toBeLessThan(0.5)
    })
  })
  it('is symmetric around its centre (no phase shift), which is its delay', () => {
    const c = taps.length / 2
    let peak = 0
    for (let i = 1; i < taps.length; i++) if (Math.abs(taps[i]) > Math.abs(taps[peak])) peak = i
    expect(peak).toBe(c)
    for (const d of [1, 5, 50, 500]) expect(taps[c + d]).toBeCloseTo(taps[c - d], 6)
  })
  it('designFir picks the phase', () => {
    expect(designFir(grid, curve, 48000, 4096, 'linear')).toEqual(taps)
    expect(designFir(grid, curve, 48000, 4096, 'minimum')).toEqual(minPhaseFir(grid, curve, 48000, 4096))
  })
})

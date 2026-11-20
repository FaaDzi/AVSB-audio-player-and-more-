import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeIemData, frDb } from '../audio/data'
import { chainDb, type Biquad } from './biquad'
import { fitParametric, PARAMETRIC_DEFAULTS } from './parametric'
import { autoEqOptions, autoEqWant } from '../shell/eqStudio'

const data = decodeIemData(JSON.parse(readFileSync(new URL('../../public/data/iems.json', import.meta.url), 'utf-8')))
const grid = data.grid
const target = frDb(data, data.iems.find((i) => i.name === 'Moondrop Blessing 3')!.fr)

/** How far the filters miss the wanted curve between lo and hi (dB rms, level-free). */
function miss(want: ArrayLike<number>, filters: Biquad[], lo: number, hi: number) {
  const idx = Array.from(grid.keys()).filter((i) => grid[i] >= lo && grid[i] <= hi)
  const s = chainDb(filters, idx.map((i) => grid[i]))
  const d = idx.map((i, k) => want[i] - s[k])
  const o = d.reduce((a, b) => a + b, 0) / d.length
  return Math.sqrt(d.reduce((a, b) => a + (b - o) ** 2, 0) / d.length)
}

// §91 E1–E2. Measured on 2026-11-20 against the fitter before it (60 IEMs, 10 filters, aimed at Blessing 3):
// 20 Hz–16 kHz miss 0.97 dB → Precise 0.34, worse on none; the old settings alone 0.248 → 0.230 below 10 kHz.
describe('AutoEQ on real measurements', () => {
  const step = Math.floor(data.iems.length / 20)
  const sample = Array.from({ length: 20 }, (_, n) => data.iems[n * step])

  it('Precise follows the whole range closer than the 10 kHz fit, on every IEM', () => {
    for (const iem of sample) {
      const dev = frDb(data, iem.fr)
      const want = Float64Array.from(target, (v, i) => v - dev[i])
      const before = fitParametric(grid, want, { ...PARAMETRIC_DEFAULTS, maxFilters: 10 })
      const precise = fitParametric(grid, want, autoEqOptions('precise', 10))
      expect(miss(want, precise.filters, 20, 16000), iem.name).toBeLessThanOrEqual(miss(want, before.filters, 20, 16000) + 0.05)
    }
  })

  it('Standard keeps peaks below 7.5 kHz and leaves the treble to a shelf', () => {
    for (const iem of sample.slice(0, 8)) {
      const dev = frDb(data, iem.fr)
      const want = Float64Array.from(target, (v, i) => v - dev[i])
      const std = fitParametric(grid, autoEqWant(grid, want, 'standard', true), autoEqOptions('standard', 10))
      for (const f of std.filters) if (f.kind === 'peak') expect(f.fc, iem.name).toBeLessThanOrEqual(7500)
      expect(std.filters.filter((f) => f.kind === 'highshelf').length).toBeLessThanOrEqual(1)
    }
  })
})

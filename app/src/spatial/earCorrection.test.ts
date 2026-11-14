import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chainDb } from '../eq/biquad'
import { earCorrectionFilters, type EarCorrection } from './earCorrection'

const c: EarCorrection = JSON.parse(readFileSync(new URL('../../public/data/hrir/ear_correction.json', import.meta.url), 'utf-8'))
const at = (f: number) => {
  const i = c.freqs.findIndex((x) => x >= f)
  return c.db[i]
}

describe('ear-gain correction for the virtual speakers', () => {
  it('takes the bass shelf out, adds a little presence, nothing above 12 kHz, within ±8 dB', () => {
    expect(at(40)).toBeLessThan(-5)
    expect(Math.abs(at(1000))).toBeLessThan(0.3)
    expect(at(3000)).toBeGreaterThan(1)
    expect(at(13000)).toBe(0)
    for (const v of c.db) expect(Math.abs(v)).toBeLessThanOrEqual(8)
  })
  it('the fitted filters follow the curve within 1.5 dB rms (shape; level is matched by the stage)', () => {
    const f = earCorrectionFilters(c)
    expect(f.length).toBeLessThanOrEqual(5)
    const got = chainDb(f, c.freqs)
    const idx = c.freqs.map((_, i) => i).filter((i) => c.freqs[i] <= 12000)
    const off = idx.reduce((s, i) => s + (c.db[i] - got[i]), 0) / idx.length
    const rms = Math.sqrt(idx.reduce((s, i) => s + (c.db[i] - got[i] - off) ** 2, 0) / idx.length)
    expect(rms).toBeLessThan(1.5)
  })
})

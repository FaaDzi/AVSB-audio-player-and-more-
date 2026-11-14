import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeIemData, frDb, type IemData } from './data'
import { correctionCurve, firResponseDb, IEM_OPTIONS, interpLog, minPhaseFir } from './filter'
import { tameTreble } from '../eq/curves'
import { fitParametric } from '../eq/parametric'
import { longTermSpectrum } from './loudness'
import { prepareMatch } from './match'

const data: IemData = decodeIemData(JSON.parse(readFileSync(new URL('../../public/data/iems.json', import.meta.url), 'utf-8')))
const byName = (n: string) => data.iems.find((i) => i.name === n)!

describe('real measurement data', () => {
  it('has a consistent grid and unique ids', () => {
    expect(data.iems.length).toBeGreaterThan(1000)
    for (const i of data.iems) expect(i.fr.length).toBe(data.grid.length)
    expect(new Set(data.iems.map((i) => i.id)).size).toBe(data.iems.length)
  })

  it('simulating Chu 2 on Blessing 3: FIR tracks the difference curve within 1 dB (40 Hz - 14 kHz)', () => {
    const noise = Float32Array.from({ length: 48000 }, () => Math.random() * 2 - 1)
    const m = prepareMatch({
      grid: data.grid,
      candidates: [frDb(data, byName('Moondrop Chu 2').fr), frDb(data, byName('Sennheiser IE 900').fr)],
      reference: frDb(data, byName('Moondrop Blessing 3').fr),
      options: IEM_OPTIONS,
      spectrum: longTermSpectrum([noise], 48000),
      sampleRate: 48000,
    })
    const idx = data.grid.map((f, i) => [f, i]).filter(([f]) => f >= 40 && f <= 14000)
    const got = firResponseDb(m.sides[0].taps, 48000, idx.map(([f]) => f))
    idx.forEach(([f, i], k) => expect(Math.abs(got[k] - m.sides[0].curveDb[i]), `${f.toFixed(0)} Hz`).toBeLessThan(1))
  })
})

describe('gallery simulation on real data', () => {
  const opts = { ...IEM_OPTIONS, maxBoostDb: 10 }
  const freqs = Array.from({ length: 60 }, (_, i) => 20 * 1000 ** (i / 59))

  // the error between the FIR's response and the curve it was built from, at `freqs`
  const firError = (iem: (typeof data.iems)[number], ref: Float64Array | number[]) => {
    const curve = tameTreble(data.grid, correctionCurve(data.grid, frDb(data, iem.fr), ref, opts))
    const got = firResponseDb(minPhaseFir(data.grid, curve, 48000), 48000, freqs)
    const want = interpLog(data.grid, curve, freqs)
    return freqs.map((_, i) => Math.abs(got[i] - want[i]))
  }
  // a row is sampled by a hash of its own id, so adding or removing other rows never changes the sample
  const hashed = (id: string, every: number) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) % every === 0

  it('FIR tracks the simulation curve: 0.5 dB from 30 Hz to 20 kHz, 1 dB below (4096 taps), on ~60 IEMs', () => {
    const ref = frDb(data, byName('Moondrop Blessing 3').fr)
    const sample = data.iems.filter((i) => hashed(i.id, 240))
    expect(sample.length).toBeGreaterThan(40)
    for (const iem of sample) {
      firError(iem, ref).forEach((e, i) => expect(e, `${iem.name} @ ${freqs[i].toFixed(0)} Hz`).toBeLessThan(freqs[i] < 30 ? 1 : 0.5))
    }
  })

  it('across the catalog, FIR misses stay rare and small (catches drift the fixed sample would not)', () => {
    const ref = frDb(data, byName('Moondrop Blessing 3').fr)
    const sample = data.iems.filter((i) => hashed(i.id, 25))
    const worst = sample.map((iem) => Math.max(...firError(iem, ref)))
    // today (bass smoothed to the FIR's ~12 Hz resolution, soft-knee caps): 1 in 2,000 over 0.5 dB, worst 0.55 dB
    expect(worst.filter((w) => w >= 0.5).length / sample.length).toBeLessThan(0.01)
    expect(Math.max(...worst)).toBeLessThan(0.8)
  }, 120_000)

  it('simulating the IEM you are wearing changes nothing: a flat curve and a unit impulse', () => {
    const own = frDb(data, byName('Moondrop Blessing 3').fr)
    const curve = tameTreble(data.grid, correctionCurve(data.grid, own, own, opts))
    expect(Math.max(...curve.map(Math.abs))).toBe(0)
    const taps = minPhaseFir(data.grid, curve, 48000)
    expect(taps[0]).toBeCloseTo(1, 6)
    expect(Math.max(...taps.subarray(1).map(Math.abs))).toBeLessThan(1e-6)
  })
})

describe('parametric export on real data', () => {
  it('KZ x Crinacle CRN EQ\'d to Harman: 10 filters land within 1.5 dB rms (20 Hz - 10 kHz)', async () => {
    const crn = frDb(data, byName('KZ x Crinacle CRN').fr)
    const curve = tameTreble(data.grid, correctionCurve(data.grid, frDb(data, data.target.fr), crn, IEM_OPTIONS))
    const eq = fitParametric(data.grid, curve)
    expect(eq.filters.length).toBeLessThanOrEqual(10)
    expect(eq.errorDb).toBeLessThan(1.5)
  })
})

// How faithful is the tournament's simulation on a real device? (§66, owner's Ziigaat Odyssey felt "eh")
// Prints, for the Odyssey as the device: how far the "not set" reference is from it, how the averaged measurement differs
// from the single listing graph, what the boost/cut limits cost, and how closely the FIR follows the correction.
// Also checks for a calibration offset between refs.json medians and the listing graphs across every averaged model.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFr, decodeIemData, frDb, type IemData } from './data'
import { correctionCurve, firResponseDb, IEM_OPTIONS, minPhaseFir, smoothLog } from './filter'

const data: IemData = decodeIemData(JSON.parse(readFileSync(new URL('../../public/data/iems.json', import.meta.url), 'utf-8')))
const refsRaw = JSON.parse(readFileSync(new URL('../../public/data/refs.json', import.meta.url), 'utf-8')) as Record<string, { fr: number[]; n: number }>
const grid = data.grid
const byId = new Map(data.iems.map((i) => [i.id, i]))
const ref = (id: string) => frDb(data, decodeFr(refsRaw[id].fr))
const level = (c: ArrayLike<number>) => {
  const idx = grid.flatMap((f, i) => (f >= 300 && f <= 3000 ? [i] : []))
  return idx.reduce((s, i) => s + c[i], 0) / idx.length
}
const BANDS: [string, number, number][] = [['sub 20-60', 20, 60], ['bass 60-250', 60, 250], ['low-mid 250-1k', 250, 1000], ['upper-mid 1-4k', 1000, 4000], ['treble 4-10k', 4000, 10000], ['air 10-16k', 10000, 16000]]
const rmsBands = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const off = level(a) - level(b)
  return BANDS.map(([, lo, hi]) => {
    let s = 0
    let n = 0
    grid.forEach((f, i) => {
      if (f >= lo && f < hi) {
        s += (a[i] - b[i] - off) ** 2
        n++
      }
    })
    return Math.sqrt(s / n)
  })
}
const fmt = (xs: number[]) => xs.map((x) => x.toFixed(1).padStart(5)).join(' ')

describe('simulation fidelity on a Ziigaat Odyssey', { timeout: 60_000 }, () => {
  const device = ref('ziigaat-odyssey')
  const listing = frDb(data, byId.get('ziigaat-odyssey')!.fr)
  const target = frDb(data, data.target.fr)

  it('reports the reference choices', () => {
    console.log(`bands (dB rms):              ${BANDS.map((b) => b[0]).join(' | ')}`)
    console.log(`target vs Odyssey avg:       ${fmt(rmsBands(target, device))}   <- device not set in setup`)
    console.log(`listing graph vs Odyssey avg:${fmt(rmsBands(listing, device))}   <- single graph vs ${refsRaw['ziigaat-odyssey'].n}-measurement median`)
    for (const v of ['ziigaat-odyssey-2', 'ziigaat-odyssey-ziigaat-odyssey-s2']) if (refsRaw[v]) console.log(`${v.padEnd(28)}${fmt(rmsBands(ref(v), device))}   <- wrong variant picked`)
    expect(device.length).toBe(grid.length)
  })

  it('FIR follows the correction and the limits rarely bite', () => {
    const names = ['Moondrop Blessing 3', 'Sennheiser IE 900', 'Moondrop Chu 2', 'Truthear HEXA', 'Simgot EA500', '7Hz Timeless', 'Letshuoer S12', 'Thieaudio Monarch MKIII', 'Moondrop Variations', 'Kiwi Ears Orchestra Lite']
    const sr = 48000
    console.log(`candidate                     | limits cost (wanted vs applied)        | FIR vs applied                        | heard vs candidate`)
    let worstFir = 0
    let worstHeard = 0
    for (const name of names) {
      const iem = data.iems.find((i) => i.name.toLowerCase() === name.toLowerCase())
      if (!iem) continue
      const cand = frDb(data, iem.fr)
      const applied = correctionCurve(grid, cand, device, { ...IEM_OPTIONS, holdAir: false })
      const pointsPerOctave = Math.round(1 / Math.log2(grid[1] / grid[0]))
      const wanted = smoothLog(Float64Array.from(grid, (_, i) => cand[i] - device[i]), pointsPerOctave, IEM_OPTIONS.smoothingOct)
      const taps = minPhaseFir(grid, applied, sr, 4096)
      const fir = firResponseDb(taps, sr, grid)
      const heard = Float64Array.from(grid, (_, i) => device[i] + fir[i])
      const firErr = rmsBands(fir, applied)
      worstFir = Math.max(worstFir, ...firErr.slice(1, 5))
      worstHeard = Math.max(worstHeard, ...rmsBands(heard, cand).slice(0, 5))
      console.log(`${name.slice(0, 29).padEnd(29)} | ${fmt(rmsBands(wanted, applied))} | ${fmt(firErr)} | ${fmt(rmsBands(heard, cand))}`)
    }
    expect(worstFir).toBeLessThan(1.5)
    // measured 2026-11-06: at most 0.3 dB rms per band from 20 Hz to 10 kHz
    expect(worstHeard).toBeLessThan(1)
  })

  it('refs.json medians and listing graphs share one calibration', () => {
    const ids = Object.keys(refsRaw).filter((id) => byId.has(id) && refsRaw[id].n >= 3)
    const mean = new Float64Array(grid.length)
    for (const id of ids) {
      const r = ref(id)
      const l = frDb(data, byId.get(id)!.fr)
      const off = level(r) - level(l)
      grid.forEach((_, i) => (mean[i] += (r[i] - l[i] - off) / ids.length))
    }
    const at = (hz: number) => mean[grid.findIndex((f) => f >= hz)].toFixed(2)
    console.log(`median - listing over ${ids.length} models (dB): 30Hz ${at(30)}, 100Hz ${at(100)}, 1k ${at(1000)}, 3k ${at(3000)}, 6k ${at(6000)}, 8k ${at(8000)}, 12k ${at(12000)}`)
    expect(ids.length).toBeGreaterThan(10)
    for (const hz of [30, 100, 1000, 3000, 6000, 8000, 12000]) expect(Math.abs(Number(at(hz)))).toBeLessThan(0.5)
  })
})

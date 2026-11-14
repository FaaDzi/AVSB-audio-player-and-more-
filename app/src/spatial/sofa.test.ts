import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseHrirFile } from './hrir'
import {
  buildHrirSet,
  convolve,
  diffuseFieldEq,
  earHeightRing,
  interpolateRing,
  largestGap,
  magnitude,
  minPhase,
  readSofa,
  trimRing,
  type Measurement,
} from './sofa'

const imp = (at: number, len = 8, v = 1) => {
  const x = new Float32Array(len)
  x[at] = v
  return x
}
const m = (az: number, el: number, l: Float32Array = imp(0), r: Float32Array = imp(1)): Measurement => ({ az, el, left: l, right: r })

describe('SOFA ring', () => {
  it('takes the elevation-0 directions, sorted, wrapped to 0–360 and without duplicates', () => {
    const ring = earHeightRing([m(-90, 0), m(0, 0), m(90, 0), m(180, 0), m(45, 30), m(0, 0.2), m(360, 0)])
    expect(ring.map((x) => x.az)).toEqual([0, 90, 180, 270])
  })
  it('falls back to the elevation nearest 0 when there is none at 0, but not beyond 10°', () => {
    expect(earHeightRing([m(0, -5), m(120, -5), m(240, -5), m(0, 20)]).map((x) => x.az)).toEqual([0, 120, 240])
    expect(earHeightRing([m(0, 15), m(180, 15)])).toEqual([])
  })
  it('measures the largest gap around the circle', () => {
    expect(largestGap([{ az: 0 }, { az: 90 }, { az: 180 }, { az: 270 }])).toBe(90)
    expect(largestGap([{ az: 10 }, { az: 30 }])).toBe(340)
  })
  it('interpolates linearly to a 5° ring, keeping measured steps and wrapping past 360°', () => {
    const ring = earHeightRing([0, 10, 350].map((az) => m(az, 0, Float32Array.of(az), Float32Array.of(-az))))
    const out = interpolateRing(ring, 5)
    expect(out.length).toBe(72)
    expect(out[0].left[0]).toBe(0)
    expect(out[1].left[0]).toBeCloseTo(5) // halfway 0 → 10
    expect(out[2].left[0]).toBe(10)
    expect(out[70].left[0]).toBe(350)
    expect(out[71].left[0]).toBeCloseTo(175) // halfway 350 → 0 (wrapping): 0.5·350 + 0.5·0
    expect(out[36].left[0]).toBeCloseTo(10 + (350 - 10) * (170 / 340)) // 180° between 10° and 350°
    expect(out[1].right[0]).toBeCloseTo(-5)
  })
})

describe('diffuse-field equalisation', () => {
  it('builds a minimum-phase filter with the asked-for magnitude', () => {
    const n = 256
    const mag = Float64Array.from({ length: n / 2 + 1 }, (_, i) => 1 + 0.5 * Math.cos((i / (n / 2)) * Math.PI))
    const h = minPhase(mag)
    const got = magnitude(h, n)
    for (let i = 0; i < mag.length; i++) expect(got[i]).toBeCloseTo(mag[i], 3)
    // minimum phase: the energy is up front
    const e = (a: number, b: number) => h.slice(a, b).reduce((s, v) => s + v * v, 0)
    expect(e(0, 16)).toBeGreaterThan(0.9 * e(0, n))
  })
  it('convolves', () => {
    expect([...convolve([1, 2], [1, 0, -1])].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 2, -1, -2])
  })
  it('undoes a colouration shared by every direction, within the ±15 dB limit', () => {
    const fs = 48000
    // every direction shares a resonance-ish two-tap colour (a comb: +6 dB / −∞ dB, clipped by the EQ limit)
    const colour = Float32Array.of(1, 0, 0.5)
    const ms = [0, 90, 180, 270].map((az) => m(az, 0, colour, colour))
    const nfft = 1024
    const eq = diffuseFieldEq(ms, fs, nfft)
    const flat = convolve(colour, eq)
    const mag = magnitude(flat, 4096)
    const db = (hz: number) => 20 * Math.log10(mag[Math.round((hz / fs) * 4096)])
    // 2·1/3-octave smoothing blurs things a little; mid-band stays within a couple of dB of 0
    for (const hz of [300, 1000, 3000]) expect(Math.abs(db(hz))).toBeLessThan(2.5)
  })
  it('trims to the earliest onset across the ring, keeping the interaural delay', () => {
    const ring = [{ left: imp(20, 400), right: imp(30, 400) }, { left: imp(25, 400), right: imp(22, 400) }]
    const t = trimRing(ring, 256)
    expect(t[0].left.length).toBe(256)
    expect(t[0].left.indexOf(1)).toBe(4)
    expect(t[0].right.indexOf(1)).toBe(14)
    expect(t[1].right.indexOf(1)).toBe(6)
  })
  it('refuses a set without an ear-height ring', () => {
    expect(() => buildHrirSet({ sampleRate: 48000, measurements: [m(0, 0), m(90, 0)] }, { name: 'x', source: 'y' })).toThrow(/ear height/)
  })
})

const RAW = new URL('../../../data/raw/hrtf/hutubs_pp1_HRIRs_measured.sofa', import.meta.url)

describe.skipIf(!existsSync(RAW))('importing a real SOFA file (HUTUBS pp1, when downloaded)', () => {
  it('matches the bundled generic set that build_hrirs.py made from the same file', async () => {
    const buf = readFileSync(RAW)
    const data = await readSofa(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'pp1.sofa')
    expect(data.sampleRate).toBe(44100)
    expect(data.measurements.length).toBe(440)
    const set = buildHrirSet(data, { name: 'pp1', source: 'test' })
    const ref = parseHrirFile(JSON.parse(readFileSync(new URL('../../public/data/hrir/generic.json', import.meta.url), 'utf-8')))
    expect(set.ring.length).toBe(72)
    expect(set.sampleRate).toBe(48000)
    // same pipeline, different resamplers: the responses should line up closely
    for (const i of [0, 6, 18, 36, 54, 66]) {
      for (const ear of ['left', 'right'] as const) {
        const a = set.ring[i][ear]
        const b = ref.ring[i][ear]
        let ab = 0
        let aa = 0
        let bb = 0
        for (let j = 0; j < 256; j++) {
          ab += a[j] * b[j]
          aa += a[j] * a[j]
          bb += b[j] * b[j]
        }
        expect(ab / Math.sqrt(aa * bb)).toBeGreaterThan(0.95)
        expect(Math.abs(10 * Math.log10(aa / bb))).toBeLessThan(1.5)
      }
    }
  })
  it('gives a readable error for a file that is not HDF5', async () => {
    await expect(readSofa(new TextEncoder().encode('hello, not a sofa file').buffer, 'x.sofa')).rejects.toThrow(/SOFA/)
  })
})

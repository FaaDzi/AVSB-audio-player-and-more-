import { describe, expect, it } from 'vitest'
import {
  bs2bCoefficients,
  crossfeedMatchGain,
  crossfeedParams,
  firResponse,
  levelMatchGain,
  matchBands,
  onePoleResponse,
  resample,
  ringIndex,
  roomResponse,
  speakerIndices,
  speakerMatchGains,
} from './stage'
import type { HrirSet } from './types'

const mag = ([re, im]: [number, number]) => Math.hypot(re, im)

describe('bs2b crossfeed', () => {
  const c = bs2bCoefficients(44100)
  it('matches bs2b.c for the default level (700 Hz, 4.5 dB) at 44.1 kHz', () => {
    expect(c.lo.b1).toBeCloseTo(Math.exp((-2 * Math.PI * 700) / 44100), 12)
    expect(c.lo.a0).toBeCloseTo(10 ** (-6.75 / 20) * (1 - c.lo.b1), 12)
    expect(c.hi.a1).toBeCloseTo(-c.hi.b1, 12)
    expect(c.gain).toBeCloseTo(0.812, 3)
  })
  it('keeps a mono signal at its level at DC and feeds less of the opposite side as frequency rises', () => {
    const g = c.gain
    const dc = (mag(onePoleResponse(c.hi.a0, c.hi.a1, c.hi.b1, 0, 44100)) + mag(onePoleResponse(c.lo.a0, 0, c.lo.b1, 0, 44100))) * g
    expect(dc).toBeCloseTo(1, 9)
    const lo = (f: number) => mag(onePoleResponse(c.lo.a0, 0, c.lo.b1, f, 44100))
    expect(lo(5000)).toBeLessThan(lo(200) / 3)
    // the opposite ear gets the feed level (−4.5 dB) below the direct one in the bass
    const hi = mag(onePoleResponse(c.hi.a0, c.hi.a1, c.hi.b1, 0, 44100))
    expect(20 * Math.log10(lo(0) / hi)).toBeCloseTo(-4.5, 1)
  })
  it('needs only a small level correction on top', () => {
    const g = crossfeedMatchGain(48000)
    expect(Math.abs(20 * Math.log10(g))).toBeLessThan(3)
  })
})

describe('level match', () => {
  it('is 1 for a straight wire', () => {
    const wire = { a: (): [number, number] => [1, 0], b: (): [number, number] => [0, 0] }
    expect(levelMatchGain([wire, wire], matchBands(48000))).toBeCloseTo(1, 9)
  })
  it('evaluates an FIR like a DFT', () => {
    expect(mag(firResponse([0.5, 0.5], 0, 48000))).toBeCloseTo(1, 9)
    expect(mag(firResponse([0.5, 0.5], 24000, 48000))).toBeCloseTo(0, 9)
  })
})

describe('HRIR ring selection', () => {
  it('rounds to the nearest measured azimuth and wraps around', () => {
    expect(ringIndex(0, 5, 72)).toBe(0)
    expect(ringIndex(32, 5, 72)).toBe(6)
    expect(ringIndex(-30, 5, 72)).toBe(66)
    expect(ringIndex(358, 5, 72)).toBe(0)
    expect(ringIndex(720 + 90, 5, 72)).toBe(18)
  })
  it('puts the speakers at ±30° and turns them the other way from the head', () => {
    expect(speakerIndices(0, 5, 72)).toEqual([6, 66])
    // head 20° to the left: the speakers are now at +10° and −50° relative to the nose
    expect(speakerIndices(20, 5, 72)).toEqual([2, 62])
    expect(speakerIndices(-45, 5, 72)).toEqual([15, 3])
    expect(speakerIndices(0, 10, 36)).toEqual([3, 33])
  })
})

describe('resample', () => {
  it('keeps a low tone and its level when changing rate', () => {
    const n = 960
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000))
    const y = resample(x, 48000, 44100)
    expect(y.length).toBe(882)
    for (let i = 100; i < 700; i += 37) expect(y[i]).toBeCloseTo(Math.sin((2 * Math.PI * 1000 * i) / 44100), 2)
  })
  it('passes the same rate through untouched', () => {
    const x = new Float32Array([1, 2, 3])
    expect(resample(x, 48000, 48000)).toBe(x)
  })
})

describe('virtual speakers and room', () => {
  // a toy ring: an impulse per ear, the far ear later and quieter
  const fs = 48000
  const set: HrirSet = {
    id: 't',
    name: 't',
    source: 't',
    sampleRate: fs,
    stepDeg: 30,
    ring: Array.from({ length: 12 }, (_, i) => {
      const left = new Float32Array(32)
      const right = new Float32Array(32)
      const az = (i * 30 * Math.PI) / 180
      left[Math.round(4 - 3 * Math.sin(az))] = 0.7 + 0.3 * Math.sin(az)
      right[Math.round(4 + 3 * Math.sin(az))] = 0.7 - 0.3 * Math.sin(az)
      return { left, right }
    }),
  }
  it('builds a room that starts after the direct sound and decays', () => {
    const r = roomResponse(set, 0)
    expect(r.left.length).toBe(Math.round(0.32 * fs))
    expect(r.left.slice(0, 100).every((v) => v === 0)).toBe(true)
    const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v * v, 0)
    expect(energy(r.left, 1000, 3000)).toBeGreaterThan(energy(r.left, 12000, 14000) * 10)
    // decorrelated ears and speakers
    const other = roomResponse(set, 1)
    expect(r.left[5000]).not.toBe(r.right[5000])
    expect(r.left[5000]).not.toBe(other.right[5000])
  })
  it('turns the room down to keep the level', () => {
    const g = speakerMatchGains(set, [roomResponse(set, 0), roomResponse(set, 1)])
    expect(g.speakers).toBeGreaterThan(0.3)
    expect(g.room).toBeLessThan(g.speakers)
  })
})

describe('crossfeedParams (CanOpener-style amount and angle)', () => {
  it('is off at 0 % and bs2b default at 100 %', () => {
    expect(crossfeedParams(0, 30)).toBeNull()
    expect(crossfeedParams(100, 30)!.feedDb).toBeCloseTo(4.5)
  })
  it('more amount = lower feed dB (more crossfeed), within bs2b range', () => {
    expect(crossfeedParams(150, 30)!.feedDb).toBeLessThan(4.5)
    expect(crossfeedParams(50, 30)!.feedDb).toBeGreaterThan(4.5)
    expect(crossfeedParams(1, 30)!.feedDb).toBe(15)
  })
  it('a wider angle delays the crossfed path more (Woodworth ITD)', () => {
    const d30 = crossfeedParams(100, 30)!.delayS
    const d60 = crossfeedParams(100, 60)!.delayS
    const d90 = crossfeedParams(100, 90)!.delayS
    expect(d60).toBeGreaterThan(d30)
    expect(d90).toBeGreaterThan(d60)
    expect(d90).toBeLessThan(0.0007)
  })
})

describe('head yaw steps (§104: no jumps on fast turns)', () => {
  it('walks toward the head at most YAW_STEP_DEG per crossfade, the short way round', async () => {
    const { nextYaw, YAW_STEP_DEG } = await import('./stage')
    expect(nextYaw(0, 4)).toBe(4)
    expect(nextYaw(0, 45)).toBe(YAW_STEP_DEG)
    expect(nextYaw(0, -45)).toBe(-YAW_STEP_DEG)
    // 170° → -170° is 20° the short way (through 180), not 340° back through the front
    expect(nextYaw(170, -170)).toBe(170 + YAW_STEP_DEG)
    let y = 0
    for (let i = 0; i < 12; i++) y = nextYaw(y, 100)
    expect(y).toBe(100)
  })
})

describe('head yaw deadband (§107 B: wobble keeps one bank)', () => {
  it('holds the aimed step until the head is half a step plus 1° away, then snaps to the nearest step', async () => {
    const { aimYaw } = await import('./stage')
    expect(aimYaw(0, 3, 5)).toBe(0)
    expect(aimYaw(0, -3.4, 5)).toBe(0)
    expect(aimYaw(0, 3.6, 5)).toBe(5)
    expect(aimYaw(5, 2, 5)).toBe(5)
    expect(aimYaw(0, 47, 5)).toBe(45)
    expect(aimYaw(180, -178, 5)).toBe(180)
    expect(aimYaw(5, 0, 5)).toBe(0)
  })
})

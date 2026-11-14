import { describe, expect, it } from 'vitest'
import { easeInOutCubic, easeOutCubic, lyricLag, lyricScrollAt, springAt } from './motion'
import { WAVE, waveY } from './WaveTrack'

describe('springAt', () => {
  it('starts at 0 and settles on 1', () => {
    expect(springAt(0, 380, 0.8)).toBeCloseTo(0, 6)
    expect(springAt(2, 380, 0.8)).toBeCloseTo(1, 3)
    expect(springAt(2, 196, 1)).toBeCloseTo(1, 3)
  })
  it('overshoots only when under-damped', () => {
    const peak = (k: number, z: number) => Math.max(...Array.from({ length: 200 }, (_, i) => springAt(i / 200, k, z)))
    expect(peak(380, 0.8)).toBeGreaterThan(1.01)
    expect(peak(380, 0.8)).toBeLessThan(1.02)
    expect(peak(196, 1)).toBeLessThanOrEqual(1)
  })
})

describe('curves', () => {
  it('run from 0 to 1', () => {
    for (const f of [easeOutCubic, easeInOutCubic]) {
      expect(f(0)).toBe(0)
      expect(f(1)).toBe(1)
    }
  })
})

describe('lyric motion', () => {
  it('lands the list exactly at 550ms', () => {
    expect(lyricScrollAt(0)).toBeCloseTo(0, 6)
    expect(lyricScrollAt(550)).toBe(1)
    expect(lyricScrollAt(700)).toBe(1)
  })
  it('makes later rows trail further, then rejoin', () => {
    expect(lyricLag(200, 6)).toBeGreaterThan(lyricLag(200, 1))
    expect(lyricLag(200, 6)).toBeGreaterThan(0)
    expect(lyricLag(200, 12)).toBe(lyricLag(200, 6))
    expect(lyricLag(800, 3)).toBe(0)
    expect(lyricLag(100, 0)).toBe(0)
  })
})

describe('seek wave', () => {
  it('is flat at no amplitude and bounded by the amplitude', () => {
    expect(waveY(13, 1.2, 0)).toBeCloseTo(0, 9)
    for (let x = 0; x < 80; x++) expect(Math.abs(waveY(x, 0.7, 1))).toBeLessThanOrEqual(WAVE.amplitude + 1e-9)
  })
  it('repeats every wavelength', () => {
    expect(waveY(5, 0.3, 1)).toBeCloseTo(waveY(5 + WAVE.wavelength, 0.3, 1), 9)
  })
  it('travels left as the phase rises', () => {
    const quarter = (Math.PI * 2) / 4
    expect(waveY(0, quarter, 1)).toBeCloseTo(waveY(WAVE.wavelength / 4, 0, 1), 9)
  })
})

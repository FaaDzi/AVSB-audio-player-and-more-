import { describe, expect, it } from 'vitest'
import { easeInOutCubic, easeOutCubic, lyricLag, lyricScrollAt, springAt } from './motion'
import { SQUIGGLE, WAVE, bounceScale, calmAt, edgeFade, glideAt, humpAt, levelStep, runAt, waveY } from './WaveTrack'

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

describe('seek wave (§95)', () => {
  it('humps never dip below the bar and repeat every length', () => {
    for (let x = 0; x < 300; x += 7) expect(humpAt(x, 100, 13)).toBeGreaterThanOrEqual(0)
    expect(humpAt(40, 100, 13)).toBeCloseTo(humpAt(140, 100, 13), 9)
  })
  it('fade to nothing at both ends of the played part', () => {
    expect(edgeFade(0, 0, 200)).toBe(0)
    expect(edgeFade(200, 0, 200)).toBe(0)
    expect(edgeFade(100, 0, 200)).toBe(1)
  })
  it('follow the level against the song average, rising fast and falling slowly, never flat', () => {
    const s = { mean: -18, amount: 0.5 }
    levelStep(s, -12, 80)
    const risen = s.amount
    expect(risen).toBeGreaterThan(0.9)
    const fall = { mean: -18, amount: 1 }
    levelStep(fall, -40, 80)
    expect(1 - fall.amount).toBeLessThan(risen - 0.5)
    for (let i = 0; i < 100; i++) levelStep(fall, -60, 100)
    expect(fall.amount).toBeCloseTo(WAVE.floor, 2)
  })
  it('ease down softly under the buttons, with no edge', () => {
    expect(calmAt(500, 400, 600)).toBeCloseTo(WAVE.calm, 9)
    expect(calmAt(100, 400, 600)).toBe(1)
    const near = [calmAt(399, 400, 600), calmAt(380, 400, 600), calmAt(360, 400, 600)]
    expect(near[0]).toBeLessThan(near[1])
    expect(near[1]).toBeLessThan(near[2])
    expect(calmAt(500, 0, 0)).toBe(1)
  })
})

describe('squiggly seek line', () => {
  it('is flat at no amplitude and bounded by the amplitude', () => {
    expect(waveY(13, 1.2, 0)).toBeCloseTo(0, 9)
    for (let x = 0; x < 80; x++) expect(Math.abs(waveY(x, 0.7, 1))).toBeLessThanOrEqual(SQUIGGLE.amplitude + 1e-9)
  })
  it('repeats every wavelength', () => {
    expect(waveY(5, 0.3, 1)).toBeCloseTo(waveY(5 + SQUIGGLE.wavelength, 0.3, 1), 9)
  })
})

describe('seek glide and party bounce', () => {
  it('glides between position steps instead of jumping, then holds', () => {
    const g = { from: 0.1, to: 0.2, t0: 1000 }
    expect(glideAt(g, 1000)).toBeCloseTo(0.1)
    expect(glideAt(g, 1000 + WAVE.glideMs / 2)).toBeCloseTo(0.15)
    expect(glideAt(g, 1000 + WAVE.glideMs * 3)).toBeCloseTo(0.2)
  })
  it('rests at full height in quiet parts and stretches with loud bass', () => {
    expect(bounceScale(WAVE.floor)).toBe(1)
    expect(bounceScale(1)).toBeCloseTo(1.8)
  })
  it('runs at the song speed and eases a late report in without stepping', () => {
    const perMs = 1 / 200_000 // a 200 s song
    const a = { base: 0.5, err: 0.001, t0: 0 }
    expect(runAt(a, perMs, 0)).toBeCloseTo(0.5)
    expect(runAt(a, perMs, WAVE.correctMs)).toBeCloseTo(0.5 + WAVE.correctMs * perMs + 0.001, 6)
    // never past the end
    expect(runAt({ base: 0.999, err: 0, t0: 0 }, perMs, 10_000)).toBe(1)
  })
})

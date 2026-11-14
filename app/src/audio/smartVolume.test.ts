import { describe, expect, it } from 'vitest'
import { measureLoudness, SMART_TARGET_LUFS, songGainDb } from './smartVolume'

const sine = (fs: number, seconds: number, dbfs: number, freq = 1000) => {
  const a = 10 ** (dbfs / 20)
  return Float32Array.from({ length: Math.round(fs * seconds) }, (_, i) => a * Math.sin((2 * Math.PI * freq * i) / fs))
}

describe('Smart volume loudness', () => {
  // EBU Tech 3341 case 1: a stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS
  it.each([48000, 44100])('reads the EBU reference tone at %i Hz as −23 LUFS', (fs) => {
    const ch = sine(fs, 10, -23)
    const { lufs, peak } = measureLoudness([ch, ch], fs)
    expect(lufs).toBeCloseTo(-23, 1)
    expect(20 * Math.log10(peak)).toBeCloseTo(-23, 1)
  })

  it('gates out silence', () => {
    const fs = 48000
    const tone = sine(fs, 10, -20)
    const withGap = new Float32Array(tone.length * 2)
    withGap.set(tone)
    // within 0.1 LU: only the few blocks straddling the edge count part-silent, as BS.1770 specifies
    const diff = measureLoudness([withGap, withGap], fs).lufs - measureLoudness([tone, tone], fs).lufs
    expect(Math.abs(diff)).toBeLessThan(0.1)
  })

  it('counts a mono file in both ears', () => {
    const ch = sine(48000, 5, -23)
    expect(measureLoudness([ch], 48000).lufs).toBeCloseTo(-23, 1)
  })

  it('turns loud songs down to the target and quiet ones up only to their peak', () => {
    expect(songGainDb({ lufs: -7, peak: 1 }, true)).toBeCloseTo(SMART_TARGET_LUFS + 7)
    // quiet, peaks at −2 dBFS: comes up 2 dB, not 6
    expect(songGainDb({ lufs: -22, peak: 10 ** (-2 / 20) }, true)).toBeCloseTo(2)
    // off: only overs come off
    expect(songGainDb({ lufs: -7, peak: 1.2 }, false)).toBeCloseTo(-20 * Math.log10(1.2))
    expect(songGainDb({ lufs: -7, peak: 0.9 }, false)).toBe(0)
    expect(songGainDb({ lufs: -Infinity, peak: 0 }, true)).toBe(0)
  })
})

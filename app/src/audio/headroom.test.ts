import { describe, expect, it } from 'vitest'
import { firPeak, headroomDb, loudWindows, peakingPeak, rawPeak } from './headroom'

const SR = 48000
const sine = (f: number, amp: number, seconds: number) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR))

describe('headroom', () => {
  it('finds the loudest stretch of a song', () => {
    const quiet = sine(440, 0.1, 3)
    quiet.set(sine(440, 0.9, 0.2), SR) // one loud burst at 1 s
    const w = loudWindows([quiet, quiet], 4)
    expect(rawPeak(w)).toBeCloseTo(0.9, 2)
  })

  it('an FIR gain of 2 doubles the measured peak; a delay changes nothing', () => {
    const w = loudWindows([sine(1000, 0.5, 1)], 8)
    const gain2 = new Float32Array(64)
    gain2[0] = 2
    const delayed = new Float32Array(64)
    delayed[40] = 1
    expect(firPeak(w, gain2)).toBeCloseTo(1, 2)
    expect(firPeak(w, delayed)).toBeCloseTo(0.5, 2)
  })

  it('a +6 dB peaking band at the tone doubles its peak; one far away leaves it', () => {
    const w = loudWindows([sine(1000, 0.25, 1)], 8)
    expect(peakingPeak(w, [{ freq: 1000, gainDb: 6, q: 1.41 }], SR)).toBeCloseTo(0.25 * 10 ** (6 / 20), 2)
    expect(peakingPeak(w, [{ freq: 16000, gainDb: 6, q: 1.41 }], SR)).toBeCloseTo(0.25, 2)
  })

  it('headroom keeps peak × preamp × volume within the allowance of the threshold', () => {
    const g = headroomDb(0.9, 0.8, -1, 1.5)
    expect(20 * Math.log10(0.9 * 0.8) + g).toBeCloseTo(0.5, 6)
    expect(headroomDb(0, 0.8)).toBe(Infinity)
  })
})

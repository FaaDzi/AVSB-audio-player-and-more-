import { describe, expect, it } from 'vitest'
import { CROSSFEED_DB, CROSSFEED_DELAY_S, CROSSFEED_HZ, firstOrder } from './backSpace'

// The open-back space must keep centred sound at its level, so loudness matching between an open-back and a
// closed-back contender stays fair. Its response for a mono signal, from the same filter coefficients the app uses.
type C = [number, number]
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const response = ([b, a]: [number[], number[]], f: number, sr: number): C => {
  const z: C = [Math.cos((-2 * Math.PI * f) / sr), Math.sin((-2 * Math.PI * f) / sr)]
  return div([b[0] + b[1] * z[0], b[1] * z[1]], [a[0] + a[1] * z[0], a[1] * z[1]])
}

describe('open-back space', () => {
  for (const sr of [44100, 48000, 96000]) {
    it(`keeps centred sound within 1 dB from 20 Hz to 20 kHz at ${sr} Hz`, () => {
      const x = 10 ** (CROSSFEED_DB / 20)
      const shelf = firstOrder(sr, CROSSFEED_HZ, 1 - x)
      const lp = firstOrder(sr, CROSSFEED_HZ, 'lowpass')
      let worst = 0
      for (let f = 20; f <= 20000; f *= 1.03) {
        const w = -2 * Math.PI * f * CROSSFEED_DELAY_S
        const cross = mul(response(lp, f, sr), [x * Math.cos(w), x * Math.sin(w)])
        const direct = response(shelf, f, sr)
        worst = Math.max(worst, Math.abs(20 * Math.log10(Math.hypot(direct[0] + cross[0], direct[1] + cross[1]))))
      }
      // the faint reflections (−20 and −23 dB, spread in time) add well under 0.1 dB of energy on top
      expect(worst).toBeLessThan(1)
    })
  }

  it('is flat for centred sound without the delay (the shelf and the crossfeed are complementary)', () => {
    const x = 10 ** (CROSSFEED_DB / 20)
    const shelf = firstOrder(48000, CROSSFEED_HZ, 1 - x)
    const lp = firstOrder(48000, CROSSFEED_HZ, 'lowpass')
    for (const f of [20, 100, 350, 1000, 5000, 15000]) {
      const d = response(shelf, f, 48000)
      const c = response(lp, f, 48000)
      expect(Math.hypot(d[0] + x * c[0], d[1] + x * c[1])).toBeCloseTo(1, 6)
    }
  })
})

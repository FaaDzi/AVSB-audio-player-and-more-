import { describe, expect, it } from 'vitest'
import { analyzeSong, classify, FEATURE_KEYS, fitModel, inputs, type SongFeatures } from './analyze'

const SR = 22050
function signal(seconds: number, fn: (t: number, ch: number) => number): Float32Array[] {
  return [0, 1].map((ch) => Float32Array.from({ length: SR * seconds }, (_, i) => fn(i / SR, ch)))
}
let seed = 1
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

describe('analyzeSong', () => {
  it('sees a 50 Hz rumble as bass and a hiss as treble', () => {
    const bass = analyzeSong(signal(10, (t) => 0.5 * Math.sin(2 * Math.PI * 50 * t) + 0.01 * Math.sin(2 * Math.PI * 1000 * t)), SR)
    const hiss = analyzeSong(signal(10, (t) => 0.3 * Math.sin(2 * Math.PI * 7000 * t) + 0.01 * Math.sin(2 * Math.PI * 1000 * t)), SR)
    expect(bass.bass).toBeGreaterThan(0.9)
    expect(hiss.treble).toBeGreaterThan(0.9)
    expect(bass.treble).toBeLessThan(0.05)
  })
  it('measures stereo width: mono ≈ 0, independent channels ≈ 0.5', () => {
    const mono = signal(6, () => 0)
    const n = Float32Array.from({ length: SR * 6 }, noise)
    mono[0] = n
    mono[1] = n
    const wide = signal(6, () => 0.3 * noise())
    expect(analyzeSong(mono, SR).width).toBeLessThan(0.01)
    expect(analyzeSong(wide, SR).width).toBeGreaterThan(0.4)
  })
  it('counts onsets: clicks twice a second ≈ 2/s', () => {
    const clicks = analyzeSong(signal(20, (t) => ((t * 2) % 1 < 0.01 ? 0.8 * noise() : 0.001 * noise())), SR)
    expect(clicks.onsets).toBeGreaterThan(1.5)
    expect(clicks.onsets).toBeLessThan(2.5)
  })
})

describe('classify', () => {
  const f = (o: Partial<SongFeatures>): SongFeatures => ({
    sub: 0.1, bass: 0.3, lowMid: 0.2, vocal: 0.3, treble: 0.05, sibilance: 0.05, width: 0.1, flatness: 0.1, dynamics: 10, crest: 12, onsets: 2, density: 0.5, ...o,
  })
  it('puts a song with the bass songs, and the scores add up to 1', () => {
    const keys = [...FEATURE_KEYS, 't1']
    const row = (o: Partial<SongFeatures>, t: number | null, c: 'bass' | 'busy') => ({ x: inputs(f(o), t === null ? null : [t], 1), c })
    const model = fitModel(
      [row({ bass: 0.6, sub: 0.3 }, 0.9, 'bass'), row({ bass: 0.55, sub: 0.25 }, null, 'bass'), row({ onsets: 6, density: 0.8 }, 0.1, 'busy'), row({ onsets: 5, density: 0.75 }, 0.2, 'busy')],
      keys,
    )
    const r = classify(model, inputs(f({ bass: 0.58, sub: 0.28 }), null, 1)) // no tags: sound alone decides
    expect(r[0].category).toBe('bass')
    expect(classify(model, inputs(f({}), [0.9], 1))[0].category).toBe('bass') // a neutral song with bass-ish tags
    expect(r.reduce((s, x) => s + x.score, 0)).toBeCloseTo(1)
  })
})

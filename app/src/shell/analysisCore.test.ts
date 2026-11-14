import { describe, expect, it } from 'vitest'
import { analyseSamples } from './analysisCore'
import { albumLevel } from './level'

function clicks(bpm: number, seconds = 30, rate = 44100) {
  const out = new Float32Array(seconds * rate)
  const every = Math.round((rate * 60) / bpm)
  for (let i = 0; i < out.length; i += every) {
    for (let j = 0; j < 800 && i + j < out.length; j++) out[i + j] = Math.sin(j * 0.3) * (1 - j / 800)
  }
  return out
}

describe('song analysis', () => {
  it('finds the tempo of a click track', () => {
    const { tempo } = analyseSamples(clicks(120), 44100)
    expect(tempo).toBeGreaterThan(117)
    expect(tempo).toBeLessThan(123)
  })
  it('rates noise brighter than a low tone', () => {
    const noise = Float32Array.from({ length: 44100 }, () => Math.random() * 2 - 1)
    const tone = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((i * 2 * Math.PI * 100) / 44100))
    expect(analyseSamples(noise, 44100).brightness).toBeGreaterThan(analyseSamples(tone, 44100).brightness * 5)
  })
  it('survives silence', () => {
    const quiet = analyseSamples(new Float32Array(44100), 44100)
    expect(quiet.brightness).toBe(0)
    expect(quiet.energy).toBeLessThan(-90)
  })
})

describe('album level', () => {
  it('uses the loudest peak and averages energy', () => {
    const level = albumLevel([{ lufs: -10, peak: 0.9 }, { lufs: -10, peak: 0.5 }, null])
    expect(level?.lufs).toBeCloseTo(-10, 5)
    expect(level?.peak).toBe(0.9)
  })
  it('is null until a song is measured', () => {
    expect(albumLevel([null, undefined])).toBeNull()
  })
})

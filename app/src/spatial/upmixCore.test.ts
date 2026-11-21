import { describe, expect, it } from 'vitest'
import { Fft, FRAME, PanSplitter, UPMIX_OUTPUTS } from './upmixCore'

const FS = 48000
const BLOCK = 128

/** Runs `seconds` of stereo through a splitter; returns each output's energy after the first half second. */
function energies(gen: (i: number) => [number, number], seconds = 1.5) {
  const sp = new PanSplitter()
  const e = new Array(UPMIX_OUTPUTS).fill(0)
  let eIn = 0
  const outs = Array.from({ length: UPMIX_OUTPUTS }, () => new Float32Array(BLOCK))
  const total = Math.floor((FS * seconds) / BLOCK) * BLOCK
  const inL = new Float32Array(BLOCK)
  const inR = new Float32Array(BLOCK)
  for (let at = 0; at < total; at += BLOCK) {
    for (let i = 0; i < BLOCK; i++) [inL[i], inR[i]] = gen(at + i)
    sp.process(inL, inR, outs)
    if (at < FS / 2) continue
    for (let i = 0; i < BLOCK; i++) {
      eIn += inL[i] * inL[i] + inR[i] * inR[i]
      for (let k = 0; k < UPMIX_OUTPUTS; k++) e[k] += outs[k][i] * outs[k][i]
    }
  }
  const sum = e.reduce((a, b) => a + b, 0)
  return { share: e.map((v) => v / sum), sum, eIn }
}

// a few tones so every frame has energy across the spectrum
const tone = (i: number) => Math.sin((2 * Math.PI * 440 * i) / FS) * 0.3 + Math.sin((2 * Math.PI * 1234 * i) / FS) * 0.2 + Math.sin((2 * Math.PI * 3100 * i) / FS) * 0.1
let seed = 1
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff - 0.5
}

describe('360 upmix: pan split (§104 D)', () => {
  it('the FFT goes there and back', () => {
    const f = new Fft(FRAME)
    const re = Float64Array.from({ length: FRAME }, (_, i) => Math.sin(i / 7) + (i % 5))
    const im = new Float64Array(FRAME)
    const orig = re.slice()
    f.run(re, im)
    f.run(re, im, true)
    for (let i = 0; i < FRAME; i++) expect(re[i]).toBeCloseTo(orig[i], 9)
  })

  it('a sound only on the left goes to the hard-left source', () => {
    const { share } = energies((i) => [tone(i), 0])
    expect(share[0]).toBeGreaterThan(0.9)
  })

  it('a sound in the middle goes to the centre source', () => {
    const { share } = energies((i) => [tone(i), tone(i)])
    expect(share[2]).toBeGreaterThan(0.9)
  })

  it('half right sits between centre and right', () => {
    const { share } = energies((i) => [tone(i) * 0.33, tone(i)])
    expect(share[2] + share[3]).toBeGreaterThan(0.85)
    expect(share[3]).toBeGreaterThan(share[2])
  })

  it('unrelated sound in each channel (reverb, room) goes to the ambience pair', () => {
    const { share } = energies(() => [noise(), noise()])
    expect(share[5] + share[6]).toBeGreaterThan(0.6)
  })

  it('keeps the loudness (within 1.5 dB) for a mix of everything', () => {
    const { sum, eIn } = energies((i) => [tone(i) + noise() * 0.3, tone(i) * 0.5 + noise() * 0.3])
    expect(Math.abs(10 * Math.log10(sum / eIn))).toBeLessThan(1.5)
  })
})

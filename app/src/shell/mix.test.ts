import { describe, expect, it } from 'vitest'
import { ceilingCurve } from '../audio/galleryPlayer'
import { mixEffectFrom, mixSeconds } from './mix'

const settings = (values: Record<string, unknown>) => (id: string) => values[id]

describe('mix transitions', () => {
  it('Auto and Crossfade add no effect', () => {
    for (const transition of ['Auto', 'Crossfade']) expect(mixEffectFrom(settings({ transition, mixpitch: 3 }))).toEqual({ lowPass: false, echo: false, rate: 1 })
  })
  it('Pitch moves the rate by semitones', () => {
    expect(mixEffectFrom(settings({ transition: 'Pitch', mixpitch: 12 })).rate).toBeCloseTo(2)
    expect(mixEffectFrom(settings({ transition: 'Pitch', mixpitch: -12 })).rate).toBeCloseTo(0.5)
  })
  it('Custom combines its own choices', () => {
    const effect = mixEffectFrom(settings({ transition: 'Custom', mixpitch: 0, mixspeed: 1.2, mixecho: true, mixlowpass: false }))
    expect(effect).toEqual({ lowPass: false, echo: true, rate: 1.2 })
  })
  it('a transition left over from another setting falls back to a crossfade', () => {
    expect(mixEffectFrom(settings({ transition: 'Gone' }))).toEqual({ lowPass: false, echo: false, rate: 1 })
  })
})

describe('mix length', () => {
  it('is automatic up to six seconds, and none for very short songs', () => {
    expect(mixSeconds(200, 200)).toBe(6)
    expect(mixSeconds(30, 200)).toBe(3)
    expect(mixSeconds(19, 200, 10)).toBe(0)
  })
  it('a chosen length holds, up to half the shorter song', () => {
    expect(mixSeconds(200, 200, 60)).toBe(60)
    expect(mixSeconds(60, 200, 60)).toBe(30)
  })
})

describe('the ceiling after the limiter', () => {
  const curve = ceilingCurve()
  const at = (input: number) => {
    const index = Math.round(((input / 2 + 1) / 2) * (curve.length - 1))
    return curve[index] * 2
  }
  it('changes nothing below -1.5 dBFS', () => {
    for (const level of [0, 0.1, 0.5, 0.8]) expect(at(level)).toBeCloseTo(level, 3)
  })
  it('never passes -0.5 dBFS, however hard it is pushed', () => {
    const limit = 10 ** (-0.5 / 20)
    for (const level of [0.95, 1, 1.5, 2]) expect(at(level)).toBeLessThanOrEqual(limit + 1e-6)
    expect(Math.abs(at(-2))).toBeLessThanOrEqual(limit + 1e-6)
  })
  it('only ever goes up', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1])
  })
})

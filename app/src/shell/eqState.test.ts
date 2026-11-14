import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { balanceDb, BANDS, carryOver, DEFAULT_SHAPER, EQ_DEFAULT, eqFilters, presetFrom, readPreset, withPreset } = await import('./eqState')
const { chainDb } = await import('../eq/biquad')

describe('carryOver (plan §76 F, every direction since §81 E)', () => {
  const grid = Array.from({ length: 31 }, (_, i) => 20 * 1000 ** (i / 30))
  const sound = (s: typeof EQ_DEFAULT) => chainDb(eqFilters(s), grid)
  const worst = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])))
  const basic = { ...EQ_DEFAULT, mode: 'basic' as const, subMode: 'shaper' as const, shaper: { ...DEFAULT_SHAPER, bassGain: 6, trebleGain: -4 } }
  const go = (s: typeof EQ_DEFAULT, next: typeof EQ_DEFAULT['mode']) => ({ ...s, ...carryOver(s, next), mode: next })

  it('Basic to Advanced reproduces the curve at the band centres; Advanced+ takes the filters as they are', () => {
    const hz = BANDS[10]
    const adv = go(basic, 'advanced')
    expect(worst(chainDb(eqFilters(adv), hz), chainDb(eqFilters(basic), hz))).toBeLessThan(0.6)
    expect(carryOver(basic, 'advanced+')).toEqual({ filters: eqFilters(basic) })
  })
  it('Advanced and Advanced+ keep the sound both ways', () => {
    const adv = { ...EQ_DEFAULT, mode: 'advanced' as const, gains: BANDS[10].map((_, i) => (i === 2 ? 4 : i === 7 ? -3 : 0)) }
    const plus = go(adv, 'advanced+')
    expect(worst(sound(plus), sound(adv))).toBeLessThan(0.01)
    const back = go({ ...plus, gains: BANDS[10].map(() => 0) }, 'advanced')
    expect(worst(chainDb(eqFilters(back), BANDS[10]), chainDb(eqFilters(adv), BANDS[10]))).toBeLessThan(0.6)
  })
  it('going to Basic finds the three knobs: exact for a sound Basic can make, closest otherwise', () => {
    const plus = go(basic, 'advanced+')
    const home = go({ ...plus, shaper: DEFAULT_SHAPER }, 'basic')
    expect(worst(sound(home), sound(basic))).toBeLessThan(0.3)
    const smile = { ...EQ_DEFAULT, mode: 'advanced' as const, gains: [6, 5, 3, 1, 0, 0, 1, 3, 5, 6] }
    const near = go(smile, 'basic')
    expect(near.shaper!.bassGain).toBeGreaterThan(2)
    expect(near.shaper!.trebleGain).toBeGreaterThan(2)
    expect(worst(sound(near), sound(smile))).toBeLessThan(worst(sound({ ...smile, mode: 'basic' }), sound(smile)))
  })
  it('leaves the next mode alone when this one is flat, or when the next already sounds the same', () => {
    expect(carryOver({ ...EQ_DEFAULT, mode: 'basic', gains: BANDS[10].map(() => 6) }, 'advanced')).toBeNull()
    const plus = go(basic, 'advanced+')
    expect(carryOver(plus, 'basic')).toBeNull()
  })
})

describe('eqFilters', () => {
  it('is empty when everything is flat', () => {
    expect(eqFilters(EQ_DEFAULT)).toEqual([])
  })
  it('shapes bass/mid/treble in Basic mode', () => {
    const shaper = { ...DEFAULT_SHAPER, bassGain: 3, bassFreq: 120 }
    expect(eqFilters({ ...EQ_DEFAULT, mode: 'basic', shaper })).toEqual([{ kind: 'lowshelf', fc: 120, gain: 3, q: 0.71 }])
  })
  it('makes a peak per moved band in Advanced', () => {
    const gains = BANDS[10].map((_, i) => (i === 2 ? 4 : 0))
    expect(eqFilters({ ...EQ_DEFAULT, mode: 'advanced', gains })).toEqual([{ kind: 'peak', fc: 125, gain: 4, q: 1.41 }])
  })
  it('plays the filter list in Advanced+, ignoring the bands', () => {
    const filter = { kind: 'peak' as const, fc: 1000, gain: -3, q: 2 }
    expect(eqFilters({ ...EQ_DEFAULT, mode: 'advanced+', gains: BANDS[10].map(() => 6), filters: [filter] })).toEqual([filter])
  })
  it('adds tone shelves in either mode', () => {
    const kinds = eqFilters({ ...EQ_DEFAULT, bass: 3, treble: -2 }).map((f) => f.kind)
    expect(kinds).toEqual(['lowshelf', 'highshelf'])
  })
})

describe('balanceDb', () => {
  it('is centred at zero and signed', () => {
    expect(balanceDb(0)).toBe(0)
    expect(balanceDb(100)).toBe(24)
    expect(balanceDb(-50)).toBe(-12)
  })
})

describe('saved presets', () => {
  const eq = { ...EQ_DEFAULT, preamp: -3, gains: BANDS[10].map(() => 2), compressor: true }

  it('carry the sound and leave the dynamics out', () => {
    const preset = presetFrom(eq, 'Mine')
    expect(preset.preamp).toBe(-3)
    expect(preset.gains).toEqual(eq.gains)
    expect(preset).not.toHaveProperty('compressor')
    expect(preset).not.toHaveProperty('balance')
  })
  it('survive a trip through a file', () => {
    const preset = presetFrom(eq, 'Mine')
    expect(readPreset(JSON.stringify(preset))).toEqual(preset)
  })
  it('refuse anything else', () => {
    expect(() => readPreset('nope')).toThrow()
    expect(() => readPreset('{}')).toThrow()
    expect(() => readPreset(JSON.stringify({ ...presetFrom(eq, 'Mine'), count: 7 }))).toThrow()
    expect(() => readPreset(JSON.stringify({ ...presetFrom(eq, 'Mine'), gains: [1] }))).toThrow()
    expect(() => readPreset(' '.repeat(70000))).toThrow()
  })
  it('replace one with the same name', () => {
    const one = presetFrom(eq, 'Mine')
    const two = { ...one, preamp: 1 }
    expect(withPreset([one], two)).toEqual([two])
  })
})

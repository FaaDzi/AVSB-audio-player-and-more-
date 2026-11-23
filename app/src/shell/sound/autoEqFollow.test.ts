import { describe, expect, it } from 'vitest'
import { EQ_DEFAULT, type EqState } from '../eqState'
import { untouched, type AppliedAutoEq } from './autoEqFollow'

const filters = [{ kind: 'peaking' as const, fc: 3000, gain: -2, q: 1.4 }]
const last: AppliedAutoEq = { device: 'az09', hrirId: 'generic', filters, preamp: -3 }
const eq: EqState = { ...EQ_DEFAULT, on: true, mode: 'advanced+', preset: 'Custom EQ 1 (Autosaved)', filters, preamp: -3 }

describe('AutoEQ follows the HRTF only while untouched (§110)', () => {
  it('is untouched right after AutoEQ', () => expect(untouched(last, eq, 'az09')).toBe(true))
  it('an edited filter makes it yours', () => expect(untouched(last, { ...eq, filters: [{ ...filters[0], gain: -1 }] }, 'az09')).toBe(false))
  it('a changed preamp, a preset, EQ off or other gear too', () => {
    expect(untouched(last, { ...eq, preamp: -2 }, 'az09')).toBe(false)
    expect(untouched(last, { ...eq, preset: 'Mine' }, 'az09')).toBe(false)
    expect(untouched(last, { ...eq, on: false }, 'az09')).toBe(false)
    expect(untouched(last, eq, 'other')).toBe(false)
    expect(untouched(null, eq, 'az09')).toBe(false)
  })
})

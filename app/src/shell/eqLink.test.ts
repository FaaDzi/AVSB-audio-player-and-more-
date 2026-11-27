import { describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } })
const { freeName, receiveEq } = await import('./eqLink')
const { EQ_DEFAULT, getPresets, presetFrom } = await import('./eqState')

describe('EQs over the link (§114 G)', () => {
  it('a name clash gets a number; built-in names count as taken', () => {
    expect(freeName('Warm', [])).toBe('Warm')
    expect(freeName('Warm', ['Warm', 'Warm (2)'])).toBe('Warm (3)')
    expect(freeName('Flat', [])).toBe('Flat (2)')
  })

  it('an EQ that arrives is checked and saved; the same one twice is not copied; junk is refused', () => {
    const p = presetFrom({ ...EQ_DEFAULT, mode: 'advanced+', filters: [{ kind: 'peak', fc: 1000, gain: 3, q: 1 }] }, 'Mid lift', 'moondrop-chu')
    expect(receiveEq(p)).toBe('Mid lift')
    expect(receiveEq(p)).toBe('Mid lift')
    expect(receiveEq({ ...p, preamp: -2 })).toBe('Mid lift (2)')
    expect(getPresets().map((x) => x.name)).toEqual(['Mid lift', 'Mid lift (2)'])
    expect(receiveEq({ name: 'x', mode: 'nope' })).toBeNull()
  })
})

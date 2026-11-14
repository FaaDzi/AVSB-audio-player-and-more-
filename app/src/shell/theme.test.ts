// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'

let themeVars: typeof import('./theme').themeVars

beforeAll(async () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), addEventListener() {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  ;({ themeVars } = await import('./theme'))
})

const hexLight = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)

describe('themeVars', () => {
  it('uses Mornye\'s neutral ladder over pure black when AMOLED is on', () => {
    const v = themeVars({ dark: true, amoled: true, seed: '#0063c4' })
    expect(v['--page']).toBe('#000000')
    expect(v['--chrome']).toBe('#161616')
    expect(v['--player']).toBe('#1f1f1f')
    expect(v['--text-strong']).toBe('#ffffff')
  })
  it('makes the page lighter than black when AMOLED is off', () => {
    const v = themeVars({ dark: true, amoled: false, seed: '#0063c4' })
    expect(v['--page']).not.toBe('#000000')
    expect(hexLight(v['--page'])).toBeGreaterThan(0)
    expect(hexLight(v['--chrome'])).toBeGreaterThan(hexLight(v['--page']))
  })
  it('ignores AMOLED in the light theme and flips the ink', () => {
    const on = themeVars({ dark: false, amoled: true, seed: '#0063c4' })
    const off = themeVars({ dark: false, amoled: false, seed: '#0063c4' })
    expect(on).toEqual(off)
    expect(on['--ink']).toBe('0 0 0')
    expect(hexLight(on['--page'])).toBeGreaterThan(hexLight(on['--text']))
  })
  it('follows the seed', () => {
    const blue = themeVars({ dark: true, amoled: true, seed: '#0063c4' })['--accent']
    const red = themeVars({ dark: true, amoled: true, seed: '#ba1a1a' })['--accent']
    expect(blue).not.toBe(red)
    expect(parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(parseInt(blue.slice(1, 3), 16))
  })
})

import { describe, expect, it } from 'vitest'
import { argbFromRgb, Hct } from '@material/material-color-utilities'
import { coverColorsFromPixels, NEUTRAL } from './cover'

const fill = (r: number, g: number, b: number, n = 400) => Array.from({ length: n }, () => argbFromRgb(r, g, b))
const hue = (hex: string) => Hct.fromInt(parseInt(hex.slice(1), 16) | 0xff000000).hue

describe('coverColorsFromPixels', () => {
  it('stays neutral for grey covers and for no pixels', () => {
    expect(coverColorsFromPixels(fill(120, 120, 120))).toEqual(NEUTRAL)
    expect(coverColorsFromPixels([])).toEqual(NEUTRAL)
  })
  it('tints a dark cover that has one clear colour on part of it', () => {
    expect(coverColorsFromPixels([...fill(5, 5, 8, 700), ...fill(40, 80, 190, 300)])).not.toEqual(NEUTRAL)
    expect(coverColorsFromPixels([...fill(5, 5, 8, 950), ...fill(40, 80, 190, 50)])).toEqual(NEUTRAL)
  })
  it('follows the hue of a coloured cover', () => {
    const blue = coverColorsFromPixels(fill(30, 60, 200))
    const red = coverColorsFromPixels(fill(200, 40, 40))
    expect(blue).not.toEqual(NEUTRAL)
    expect(Math.abs(hue(blue.primary) - Hct.fromInt(argbFromRgb(30, 60, 200)).hue)).toBeLessThan(25)
    expect(blue.primary).not.toEqual(red.primary)
  })
})

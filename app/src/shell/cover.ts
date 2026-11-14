import { useEffect, useState, type CSSProperties } from 'react'
import { argbFromRgb, Hct, hexFromArgb, MaterialDynamicColors as C, QuantizerCelebi, SchemeTonalSpot, Score } from '@material/material-color-utilities'
import { coverUrl } from './library'
import { useIsDark } from './theme'

export interface CoverColors {
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
  secondaryContainer: string
  onSecondaryContainer: string
  /** Player bar: surfaceContainerHigh at 72% over the chrome colour. */
  bar: string
}

/** Black and white covers get no tint, like the white controls on the reference. */
export const NEUTRAL: CoverColors = {
  primary: '#ffffff',
  onPrimary: '#000000',
  primaryContainer: '#474747',
  onPrimaryContainer: '#ffffff',
  secondaryContainer: '#474747',
  onSecondaryContainer: '#ffffff',
  bar: 'var(--player)',
}

const NEUTRAL_LIGHT: CoverColors = {
  primary: '#000000',
  onPrimary: '#ffffff',
  primaryContainer: '#dcdcdc',
  onPrimaryContainer: '#000000',
  secondaryContainer: '#dcdcdc',
  onSecondaryContainer: '#000000',
  bar: 'var(--player)',
}

/**
 * The colour a cover reads as. A plain average would turn a dark cover with one clear colour grey, so when at least
 * 12% of the pixels show a visible hue, the strongest hue range (24 bins, weighted by colourfulness) wins.
 */
function readsAs(pixels: number[]): number {
  const BINS = 24
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let red = 0, green = 0, blue = 0, chromatic = 0
  for (const p of pixels) {
    const r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
    red += r
    green += g
    blue += b
    const high = Math.max(r, g, b)
    const chroma = high - Math.min(r, g, b)
    if (chroma < 20 || high < 48) continue // dark pixels have unstable hues
    chromatic++
    const hue = high === r ? ((g - b) / chroma + 6) % 6 : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
    const bin = bins[Math.floor((hue * 60) / (360 / BINS)) % BINS]
    bin.weight += chroma
    bin.r += r * chroma
    bin.g += g * chroma
    bin.b += b * chroma
  }
  if (chromatic / pixels.length >= 0.12) {
    const around = (i: number) => [bins[(i + BINS - 1) % BINS], bins[i], bins[(i + 1) % BINS]]
    const total = (i: number) => around(i).reduce((sum, x) => sum + x.weight, 0)
    let best = 0
    for (let i = 1; i < BINS; i++) if (total(i) > total(best)) best = i
    const w = total(best)
    const mix = (channel: 'r' | 'g' | 'b') => Math.round(around(best).reduce((sum, x) => sum + x[channel], 0) / w)
    return argbFromRgb(mix('r'), mix('g'), mix('b'))
  }
  return argbFromRgb(Math.round(red / pixels.length), Math.round(green / pixels.length), Math.round(blue / pixels.length))
}

function mixOverChrome(argb: number): string {
  const over = (channel: number) => Math.round(((argb >> channel) & 255) * 0.72 + 0x16 * 0.28)
  return hexFromArgb(argbFromRgb(over(16), over(8), over(0)))
}

/**
 * Same steps as Mornye's cover_palette.dart: Celebi quantizer, Material Score for the seed, tonal-spot dark scheme.
 * A cover whose colour reads as grey (HCT chroma 12 or less) stays neutral.
 */
export function coverColorsFromPixels(pixels: number[], dark = true): CoverColors {
  const neutral = dark ? NEUTRAL : NEUTRAL_LIGHT
  if (!pixels.length) return neutral
  if (Hct.fromInt(readsAs(pixels)).chroma <= 12) return neutral
  const seed = Score.score(QuantizerCelebi.quantize(pixels, 128), { desired: 1 })[0]
  const scheme = new SchemeTonalSpot(Hct.fromInt(seed), dark, 0)
  const hex = (color: { getArgb: (s: SchemeTonalSpot) => number }) => hexFromArgb(color.getArgb(scheme))
  return {
    primary: hex(C.primary),
    onPrimary: hex(C.onPrimary),
    primaryContainer: hex(C.primaryContainer),
    onPrimaryContainer: hex(C.onPrimaryContainer),
    secondaryContainer: hex(C.secondaryContainer),
    onSecondaryContainer: hex(C.onSecondaryContainer),
    bar: dark ? mixOverChrome(C.surfaceContainerHigh.getArgb(scheme)) : hex(C.surfaceContainerHigh),
  }
}

const KNOWN_MAX = 80
const known = new Map<string, Promise<CoverColors>>()

function colorsOfCover(id: string, dark: boolean): Promise<CoverColors> {
  const key = `${id}|${dark}`
  let found = known.get(key)
  if (found) {
    known.delete(key)
    known.set(key, found)
    return found
  }
  found = new Promise((done) => {
      const image = new Image()
      image.onerror = () => done(dark ? NEUTRAL : NEUTRAL_LIGHT)
      image.onload = () => {
        const size = 112
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return done(dark ? NEUTRAL : NEUTRAL_LIGHT)
        context.drawImage(image, 0, 0, size, size)
        const data = context.getImageData(0, 0, size, size).data
        const pixels: number[] = []
        for (let i = 0; i + 3 < data.length; i += 4) if (data[i + 3] === 255) pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]))
        done(coverColorsFromPixels(pixels, dark))
      }
      image.src = coverUrl(id)
  })
  known.set(key, found)
  while (known.size > KNOWN_MAX) {
    const oldest = known.keys().next().value
    if (oldest === undefined) break
    known.delete(oldest)
  }
  return found
}

/** The `--cover-*` variables for a cover. Keeps the previous colours until the new ones are ready. */
export function useCoverStyle(id: string | undefined, alwaysDark = false): CSSProperties {
  const themeDark = useIsDark()
  const dark = alwaysDark || themeDark
  const [colors, setColors] = useState(NEUTRAL)
  useEffect(() => {
    if (!id) {
      setColors(dark ? NEUTRAL : NEUTRAL_LIGHT)
      return
    }
    let live = true
    void colorsOfCover(id, dark).then((c) => { if (live) setColors(c) })
    return () => { live = false }
  }, [id, dark])
  return {
    '--cover-primary': colors.primary,
    '--cover-on-primary': colors.onPrimary,
    '--cover-container': colors.primaryContainer,
    '--cover-on-container': colors.onPrimaryContainer,
    '--cover-tile': colors.secondaryContainer,
    '--cover-on-tile': colors.onSecondaryContainer,
    '--cover-bar': colors.bar,
  } as CSSProperties
}

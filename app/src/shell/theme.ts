import { useSyncExternalStore } from 'react'
import { argbFromHex, Hct, hexFromArgb, MaterialDynamicColors as C, SchemeTonalSpot } from '@material/material-color-utilities'
import { setSystemAppearance } from '../platform'
import { getSetting, setSetting, subscribeSettings } from './settings/store'

/** Mornye's fallback seed, used when Dynamic Color is off and nothing was picked, or no system colour is available. */
export const DEFAULT_SEED = '#1db954'
export const SEED_COLORS = ['#1db954', '#6750a4', '#0061a4', '#006e1c', '#ba1a1a', '#984061', '#7d5260', '#006874']

export interface ThemeInput {
  dark: boolean
  amoled: boolean
  seed: string
}

const mix = (a: string, b: string, share: number) => {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const part = (at: number) => Math.round(channel(a, at) * (1 - share) + channel(b, at) * share).toString(16).padStart(2, '0')
  return `#${part(1)}${part(3)}${part(5)}`
}

/** Every colour token, from a Material tonal-spot scheme. AMOLED swaps in Mornye's neutral ladder over pure black. */
export function themeVars({ dark, amoled, seed }: ThemeInput): Record<string, string> {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0)
  const hex = (color: { getArgb: (s: SchemeTonalSpot) => number }) => hexFromArgb(color.getArgb(scheme))
  const black = dark && amoled
  const surface = black ? '#000000' : hex(C.surface)
  const low = black ? '#111111' : hex(C.surfaceContainerLow)
  const container = black ? '#161616' : hex(C.surfaceContainer)
  const high = black ? '#1f1f1f' : hex(C.surfaceContainerHigh)
  const highest = black ? '#2a2a2a' : hex(C.surfaceContainerHighest)
  const onSurface = hex(C.onSurface)
  const primary = hex(C.primary)
  return {
    '--ink': dark ? '255 255 255' : '0 0 0',
    '--page': surface,
    '--chrome': container,
    '--group': mix(low, container, 0.6),
    '--player': high,
    '--field': high,
    '--control': high,
    '--control-hover': highest,
    '--menu': mix(high, highest, 0.5),
    '--chip': highest,
    '--dialog': highest,
    '--hairline': black ? '#2b2b2b' : hex(C.outlineVariant),
    '--scroll': dark ? '#3a3a3a' : '#bdbdbd',
    '--outline': hex(C.outlineVariant),
    '--outline-strong': hex(C.outline),
    '--text': onSurface,
    '--text-strong': black ? '#ffffff' : onSurface,
    '--text-dim': hex(C.onSurfaceVariant),
    '--text-faint': hex(C.outline),
    '--accent': primary,
    '--on-accent': hex(C.onPrimary),
    '--accent-container': hex(C.primaryContainer),
    '--on-accent-container': hex(C.onPrimaryContainer),
    '--nav-selected': hex(C.secondaryContainer),
    '--on-nav-selected': hex(C.onSecondaryContainer),
    '--tab-selected': mix(surface, primary, 0.05),
    '--danger': hex(C.error),
    '--inverse-surface': black ? '#ffffff' : hex(C.inverseSurface),
    '--on-inverse-surface': black ? '#000000' : hex(C.inverseOnSurface),
    '--scrim': 'rgba(0, 0, 0, 0.6)',
  }
}

let systemAccent: string | null = null
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)')

export function isDarkNow(): boolean {
  const mode = getSetting('theme')
  return mode === 'Dark' || (mode !== 'Light' && systemDark().matches)
}

function seedNow(): string {
  if (getSetting('dynamic') && systemAccent) return systemAccent
  return String(getSetting('seed') ?? DEFAULT_SEED)
}

const FONT_NAME = 'Shell Custom Font'

function applyFont() {
  const custom = getSetting('customfont') ? `'${FONT_NAME}', ` : ''
  const base = getSetting('sysfont') ? 'system-ui, sans-serif' : "'Google Sans Flex', system-ui, sans-serif"
  document.documentElement.style.setProperty('--font-ui', custom + base)
}

/** Full screen works in a browser too. Borderless needs the Electron window, so here it stays windowed. */
function applyWindowMode() {
  const wanted = getSetting('windowmode') === 'Full screen'
  if (wanted && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {})
  else if (!wanted && document.fullscreenElement) void document.exitFullscreen()
}

export type ThemeStyleScope = 'gameshow' | 'clean'

/** Normalises stored 'style' setting values (labels or canonical tokens) to one of the 2 theme mode scopes ('gameshow' or 'clean'). */
export function resolveStyleScope(raw: unknown = getSetting('style')): ThemeStyleScope {
  const val = String(raw ?? '').trim().toLowerCase()
  if (
    val === 'gameshow' ||
    val === 'game show' ||
    val === 'game show / party (all ui)' ||
    val === 'gameshow-tournament' ||
    val === 'game show (tournament only)' ||
    val === 'gameshow (tournament only)' ||
    val === 'tournament only' ||
    val === 'party'
  ) {
    return 'gameshow'
  }
  return 'clean'
}

export function applyTheme() {
  const dark = isDarkNow()
  const root = document.documentElement
  const vars = themeVars({ dark, amoled: Boolean(getSetting('amoled')), seed: seedNow() })
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.theme = dark ? 'dark' : 'light'
  const scope = resolveStyleScope(getSetting('style'))
  root.dataset.styleScope = scope
  root.dataset.style = scope === 'gameshow' ? 'gameshow' : 'clean'
  // Party draws its dark purple stage in every theme, so its bar icons stay white
  const party = scope === 'gameshow'
  setSystemAppearance(!dark && !party, party ? '#2b0e36' : vars['--page'])
  root.dataset.outlines = getSetting('outlines') === false ? 'off' : 'on'
  // the tournament's own motion follows this switch, not Windows' animation setting (often off on PCs)
  const reduce = Boolean(getSetting('reducemotion'))
  root.dataset.reduceMotion = reduce ? 'on' : 'off'
  try {
    localStorage.setItem('reduce-motion-v1', reduce ? '1' : '0')
  } catch {
    // storage full or blocked: bursts then follow Windows' setting
  }
  root.style.setProperty('--lyric-scale', String(getSetting('lyricsize') ?? 1))
  applyFont()
}

/** Windows' accent colour, which follows the wallpaper when Windows is set to pick it automatically. */
async function readSystemAccent() {
  try {
    const response = await fetch('/shell-host/accent')
    if (!response.ok) return
    const { accent } = await response.json() as { accent?: string }
    if (accent && accent !== systemAccent) {
      systemAccent = accent
      applyTheme()
    }
  } catch {
    // no host to ask: Dynamic Color falls back to the seed, as Mornye does
  }
}

// The custom font lives in IndexedDB: at up to 10 MB it's too big for localStorage.
function fontStore<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((done, fail) => {
    const open = indexedDB.open('shell-fonts', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('fonts')
    open.onerror = () => fail(open.error)
    open.onsuccess = () => {
      const request = run(open.result.transaction('fonts', mode).objectStore('fonts'))
      request.onerror = () => fail(request.error)
      request.onsuccess = () => { open.result.close(); done(request.result) }
    }
  })
}

let loadedFont: FontFace | null = null

async function applyFontData(data: ArrayBuffer) {
  const face = new FontFace(FONT_NAME, data)
  await face.load()
  if (loadedFont) document.fonts.delete(loadedFont)
  document.fonts.add(face)
  loadedFont = face
}

export const FONT_LIMIT_BYTES = 10 * 1024 * 1024

/** Throws if the file isn't a usable font or is over the limit. */
export async function importCustomFont(file: File) {
  if (file.size > FONT_LIMIT_BYTES) throw new Error('The font is over 10 MB')
  const data = await file.arrayBuffer()
  try {
    await applyFontData(data)
  } catch {
    throw new Error('That file is not a font this app can read')
  }
  await fontStore((s) => s.put(data, 'custom'), 'readwrite')
  setSetting('customfont', file.name)
}

export async function removeCustomFont() {
  await fontStore((s) => s.delete('custom'), 'readwrite')
  if (loadedFont) document.fonts.delete(loadedFont)
  loadedFont = null
  setSetting('customfont', '')
}

let started = false

/** Runs once before the first render, so the saved theme shows with no flash. */
export function startTheme() {
  if (started) return
  started = true
  // §64: Glass became Game show; migrate any old Tournament-only value to Game show
  if (getSetting('style') === 'Glass' || getSetting('style') === 'Game show (Tournament only)') {
    setSetting('style', 'Game show')
  }
  applyTheme()
  subscribeSettings(applyTheme)
  subscribeSettings(applyWindowMode)
  systemDark().addEventListener('change', applyTheme)
  void readSystemAccent()
  window.addEventListener('focus', () => { void readSystemAccent() })
  if (getSetting('customfont')) {
    void fontStore<ArrayBuffer>((s) => s.get('custom'), 'readonly').then((data) => (data ? applyFontData(data) : undefined)).catch(() => {})
  }
}

const subscribeDark = (listener: () => void) => {
  const off = subscribeSettings(listener)
  systemDark().addEventListener('change', listener)
  return () => { off(); systemDark().removeEventListener('change', listener) }
}

export function useIsDark() {
  return useSyncExternalStore(subscribeDark, isDarkNow)
}

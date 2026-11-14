import { useState, useEffect } from 'react'
import { NO_TASTE, type Taste } from '../eq/curves'
import type { ProfileBase } from '../eq/userProfiles'
import type { Biquad } from '../eq/biquad'
import { parseFilters } from '../eq/peq'
import type { Catalog, GraphTarget } from '../data/catalog'
import type { Category, SongFile, SongInfo } from '../songs/library'

/** A song in the gallery wheel (always one you have a file for). */
export interface GalleryItem extends SongInfo {
  file: SongFile
}

export type SortKey = 'artist' | 'title' | 'year' | 'genre' | 'speciality'

export interface GalleryFilter {
  query: string
  genre: string | null
  category: Category | 'any' | null
  artist: string | null
  favoritesOnly: boolean
  sort: SortKey
}

const FORMATS: Record<string, { label: string; lossless: boolean }> = {
  flac: { label: 'FLAC', lossless: true },
  wav: { label: 'WAV', lossless: true },
  aif: { label: 'AIFF', lossless: true },
  aiff: { label: 'AIFF', lossless: true },
  opus: { label: 'Opus', lossless: false },
  ogg: { label: 'Ogg', lossless: false },
  mp3: { label: 'MP3', lossless: false },
  m4a: { label: 'AAC/ALAC', lossless: false },
  aac: { label: 'AAC', lossless: false },
}

/**
 * Where to buy a built-in song lossless (§53.5): a Qobuz search for artist + title. Qobuz sells
 * CD-quality and hi-res FLAC of most label releases; its pages refuse automated lookups (403), so
 * the app links the search rather than a checked album page. Nothing is downloaded or re-hosted.
 */
export function losslessSearchUrl(song: { artist: string; title: string }): string {
  return `https://www.qobuz.com/search?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`
}

/** The audio format from a file name, for the now-playing chip (§52.6); null if unknown. */
export function formatOf(fileName: string): { label: string; lossless: boolean } | null {
  return FORMATS[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** A song from your folder that isn't on our list (its id comes from the file name). */
export const isUserSong = (s: { id: string }) => s.id.startsWith('extra-')

export const DEFAULT_FILTER: GalleryFilter = {
  query: '',
  genre: null,
  category: null,
  artist: null,
  favoritesOnly: false,
  sort: 'artist',
}

/** Short speciality names for chips ("Bass", "Vocals", …). */
export const SPECIALITY_LABEL: Record<Category | 'any', string> = {
  bass: 'Bass',
  vocals: 'Vocals',
  treble: 'Treble',
  acoustic: 'Acoustic',
  stage: 'Soundstage',
  busy: 'Busy mix',
  any: 'Your file',
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

function haystack(s: GalleryItem): string {
  return norm([s.artist, s.title, s.album, s.genre, s.from ?? '', SPECIALITY_LABEL[s.category], ...s.also.map((c) => SPECIALITY_LABEL[c]), s.year ?? ''].join(' '))
}

/**
 * osu!-style search: every space-separated word must appear somewhere (artist, title,
 * album, genre, speciality, year). Also understands `artist=`, `title=`, `genre=`,
 * `type=` (speciality), `album=` and `year=`/`year>`/`year<`.
 */
export function matchWords(s: GalleryItem, words: string[]): boolean {
  if (!words.length) return true
  const hay = haystack(s)
  return words.every((w) => {
    const m = /^(artist|title|genre|type|spec|album|year)([=<>])(.+)$/.exec(w)
    if (!m) return hay.includes(w)
    const [, key, op, val] = m
    if (key === 'year') {
      const y = s.year ?? NaN
      const v = Number(val)
      return op === '=' ? y === v : op === '>' ? y > v : y < v
    }
    const field =
      key === 'artist' ? s.artist
      : key === 'title' ? s.title
      : key === 'genre' ? s.genre
      : key === 'album' ? s.album
      : [SPECIALITY_LABEL[s.category], s.category, ...s.also].join(' ')
    return norm(field).includes(val)
  })
}

export function matchesQuery(s: GalleryItem, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean)
  return matchWords(s, words)
}

export function filterSongs(items: GalleryItem[], f: GalleryFilter, favorites: Set<string>): GalleryItem[] {
  const words = norm(f.query).split(/\s+/).filter(Boolean)
  const filtered = items.filter(
    (s) =>
      (!f.genre || s.genre === f.genre) &&
      (!f.category || s.category === f.category || s.also.includes(f.category as Category)) &&
      (!f.artist || s.artist === f.artist) &&
      (!f.favoritesOnly || favorites.has(s.id)) &&
      (words.length === 0 || matchWords(s, words)),
  )

  const getKey = (s: GalleryItem): string | number =>
    f.sort === 'year' ? (s.year ?? 9999)
    : f.sort === 'title' ? norm(s.title)
    : f.sort === 'genre' ? s.genre
    : f.sort === 'speciality' ? s.category
    : norm(s.artist)

  // Precompute sort keys once (O(N) Schwartzian transform) to avoid thousands of norm() calls during sort
  const mapped = filtered.map((item) => ({
    item,
    key: getKey(item),
    titleNorm: f.sort === 'title' ? '' : norm(item.title),
  }))

  mapped.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1
    if (f.sort !== 'title') {
      if (a.titleNorm !== b.titleNorm) return a.titleNorm < b.titleNorm ? -1 : 1
    }
    return 0
  })

  return mapped.map((m) => m.item)
}

// ---- Gallery-only EQ (never touches the tournament) ----

export type GalleryEq =
  | { kind: 'off' }
  | { kind: 'iem'; iemId: string }
  | { kind: 'target'; target: string }
  /** 10 bands; with `base`, on top of an IEM sim or target ("Edit this EQ"), `editing` a saved profile. */
  | { kind: 'custom'; gains: number[]; base?: ProfileBase; editing?: string; filters?: Biquad[]; tier?: PeqTier }
  /** One of your saved EQ profiles (eq/userProfiles.ts). */
  | { kind: 'profile'; id: string }

/** How the target presets are grouped and described (names as in targets.json). */
export const TARGET_GROUPS = ['Research', 'Neutral', 'Warm & bassy'] as const
export const TARGET_INFO: Record<string, { group: (typeof TARGET_GROUPS)[number]; blurb: string }> = {
  'Harman in-ear 2019': { group: 'Research', blurb: 'Punchy sub-bass, forward vocals, bright and lively. Most preferred in blind tests.' },
  'JM-1': { group: 'Neutral', blurb: 'Diffuse-field neutral: flat bass, forward upper mids. Clean, can sound thin.' },
  'IEF Neutral 2023': { group: 'Neutral', blurb: 'Gentle bass lift, smooth relaxed treble. Natural and balanced.' },
  'IEF Neutral 2020': { group: 'Neutral', blurb: 'Almost no bass lift. Leaner and more analytical.' },
  'JM-1 + tilt': { group: 'Warm & bassy', blurb: 'JM-1 tilted warm with a bass shelf (squig.link default). Fuller, darker.' },
  'IEF 2025': { group: 'Warm & bassy', blurb: 'Big clean sub-bass, softer treble. Weighty without muddy mid-bass.' },
  'Harman over-ear 2018': { group: 'Research', blurb: "Harman's headphone research target, for open and closed backs alike. Warm bass shelf, clear mids." },
  'Harman over-ear 2015': { group: 'Research', blurb: 'The earlier Harman over-ear curve: a little less bass, slightly brighter.' },
  'Harman over-ear 2013': { group: 'Research', blurb: "Harman's first over-ear target. Less bass, more treble than 2018." },
  'oratory1990 optimum': { group: 'Research', blurb: "oratory1990's hi-fi take on Harman: smoother treble, popular for EQ presets." },
  'Diffuse field': { group: 'Neutral', blurb: 'The classic neutral headphone baseline: flat bass, forward upper mids.' },
  'Harman OE 2018 no bass': { group: 'Neutral', blurb: 'Harman over-ear 2018 without its bass shelf: lean and open, like many open backs.' },
}

export const CUSTOM_PRESETS: { name: string; gains: number[] }[] = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass boost', gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { name: 'V-shape', gains: [5, 4, 2, 0, -2, -2, 0, 2, 4, 4] },
  { name: 'Warm', gains: [3, 3, 2, 1, 0, 0, -1, -2, -3, -3] },
  { name: 'Vocal', gains: [-2, -2, -1, 0, 2, 3, 3, 1, 0, -1] },
  { name: 'Bright', gains: [0, 0, 0, 0, 0, 1, 2, 3, 4, 5] },
  { name: 'Treble tame', gains: [0, 0, 0, 0, 0, 0, -1, -3, -4, -4] },
]

const EQ_KEY = 'gallery-eq-v1'

export function loadGalleryEq(): GalleryEq {
  try {
    const v = JSON.parse(localStorage.getItem(EQ_KEY) ?? 'null')
    if (v?.kind === 'iem' && typeof v.iemId === 'string') return v
    if (v?.kind === 'target' && typeof v.target === 'string') return v
    if (v?.kind === 'custom' && Array.isArray(v.gains) && v.gains.length === 10) {
      const filters = v.filters === undefined ? undefined : parseFilters(v.filters) ?? undefined
      return { ...v, filters, tier: v.tier === 'advanced+' ? 'advanced+' : undefined }
    }
    if (v?.kind === 'profile' && typeof v.id === 'string') return v
  } catch { /* ignore */ }
  return { kind: 'off' }
}

export function saveGalleryEq(eq: GalleryEq) {
  try { localStorage.setItem(EQ_KEY, JSON.stringify(eq)) } catch { /* ignore */ }
}

const TASTE_KEY = 'gallery-taste-v1'

export function loadTaste(): Taste {
  try {
    const v = JSON.parse(localStorage.getItem(TASTE_KEY) ?? 'null')
    if (v && [v.bass, v.treble, v.tilt].every((x) => typeof x === 'number')) return { bass: v.bass, treble: v.treble, tilt: v.tilt }
  } catch { /* ignore */ }
  return NO_TASTE
}

export function saveTaste(t: Taste) {
  try { localStorage.setItem(TASTE_KEY, JSON.stringify(t)) } catch { /* ignore */ }
}

const LAST_TARGET_KEY = 'gallery-last-target'
const LAST_HP_TARGET_KEY = 'gallery-last-target-hp'

/** The target last EQ'd to for this kind of device, so "A target" brings it back. */
export function loadLastTarget(kind: TargetKind = 'iem'): string | null {
  try { return localStorage.getItem(kind === 'headphone' ? LAST_HP_TARGET_KEY : LAST_TARGET_KEY) } catch { return null }
}

export function saveLastTarget(name: string, kind: TargetKind = 'iem') {
  try { localStorage.setItem(kind === 'headphone' ? LAST_HP_TARGET_KEY : LAST_TARGET_KEY, name) } catch { /* ignore */ }
}

export type TargetKind = 'iem' | 'headphone' | 'room'

/**
 * Custom EQ tiers (§54.2): Basic is the 10 graphic bands; Advanced is a parametric EQ of up to 10
 * filters (what FiiO, HiBy and most players take); Advanced+ up to 20 (Qudelix 5K, Equalizer APO).
 * Stored on the custom EQ as `tier` only for Advanced+; filters without it are Advanced.
 */
export type PeqTier = 'advanced' | 'advanced+'
export type EqTier = 'basic' | PeqTier
export const TIER_MAX_FILTERS: Record<PeqTier, number> = { advanced: 10, 'advanced+': 20 }

/** Which tier a custom EQ is in. */
export function tierOf(eq: { filters?: unknown[]; tier?: PeqTier }): EqTier {
  return !eq.filters ? 'basic' : eq.tier === 'advanced+' ? 'advanced+' : 'advanced'
}
/** A target the gallery can EQ to, in the in-ear frame every curve is stored in, and who it's meant for. */
export interface GalleryTarget extends GraphTarget {
  kind: TargetKind
}

/** The default target per kind: Harman's research targets (Harman OE 2018 is for open and closed backs alike). */
export const DEFAULT_TARGET: Record<TargetKind, string> = { iem: 'Harman in-ear 2019', headphone: 'Harman over-ear 2018', room: 'In-room −0.8 dB/oct' }

/**
 * In-ear targets as they are, plus the over-ear ones moved into the in-ear frame the headphone
 * curves use (data/catalog.ts: native = in-ear-frame + toNative), so EQ'ing a headphone to
 * "Harman over-ear 2018" corrects it to that curve exactly.
 */
export function galleryTargets(c: Pick<Catalog, 'targets' | 'headphones'>): GalleryTarget[] {
  const ie = c.targets.map((t) => ({ ...t, kind: 'iem' as const }))
  const hp = c.headphones
  if (!hp) return ie
  const names = new Set(ie.map((t) => t.name))
  return [
    ...ie,
    ...hp.targets
      .filter((t) => !names.has(t.name))
      .map((t) => ({ name: t.name, note: t.note, values: t.values.map((v, k) => v - hp.toNative[k]), kind: 'headphone' as const })),
  ]
}

/** The target "A target" opens on for this device: the last one picked for its kind, else that kind's default. */
export function startTarget(list: GalleryTarget[], kind: TargetKind, last: string | null): string {
  const ofKind = list.filter((t) => t.kind === kind)
  if (last && ofKind.some((t) => t.name === last)) return last
  return (ofKind.find((t) => t.name === DEFAULT_TARGET[kind]) ?? ofKind[0] ?? list[0])?.name ?? ''
}

const STRENGTH_KEY = 'gallery-sim-strength'

/** How much of a device sim or target correction plays (0–100 %), kept across visits. */
export function loadStrength(): number {
  try {
    const v = Number(localStorage.getItem(STRENGTH_KEY) ?? 100)
    return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100
  } catch { return 100 }
}

export function saveStrength(pct: number) {
  try { localStorage.setItem(STRENGTH_KEY, String(pct)) } catch { /* ignore */ }
}

/** A correction curve at `pct` % (linear in dB: 50 % is half the correction at every frequency). */
export function atStrength(curve: Float64Array, pct: number): Float64Array {
  if (pct >= 100) return curve
  const s = Math.max(0, pct) / 100
  return curve.map((v) => v * s)
}

const LAST_IEM_KEY = 'gallery-last-iem'

/** The IEM last simulated, so Off → "An IEM" brings it back. */
export function loadLastIem(): string | null {
  try { return localStorage.getItem(LAST_IEM_KEY) } catch { return null }
}

export function saveLastIem(id: string) {
  try { localStorage.setItem(LAST_IEM_KEY, id) } catch { /* ignore */ }
}

/** EQ gains shifted down so nothing boosts above 0 dB, rounded to 0.1 dB (for export). */
export function headroomGains(gains: number[]): number[] {
  const peak = Math.max(0, ...gains)
  return gains.map((g) => Math.round((g - peak) * 10) / 10)
}

/** Equalizer APO parametric text for the custom EQ (preamp + one peaking filter per band). */
export function apoParametricText(freqs: number[], gains: number[], q = 1.41): string {
  const peak = Math.max(0, ...gains)
  return [
    `Preamp: ${(-peak).toFixed(1)} dB`,
    ...freqs.map((f, i) => `Filter ${i + 1}: ON PK Fc ${f} Hz Gain ${gains[i].toFixed(1)} dB Q ${q.toFixed(2)}`),
  ].join('\n')
}

// ---- Library scroll lock: keep playing current track while scrolling ----

export const SCROLL_LOCK_KEY = 'iem-song-scroll-lock-v1'

export function loadScrollLock(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    return s?.getItem(SCROLL_LOCK_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveScrollLock(locked: boolean, storage?: Pick<Storage, 'setItem'>) {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    s?.setItem(SCROLL_LOCK_KEY, String(locked))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('iem-scroll-lock-changed', { detail: locked }))
    }
  } catch { /* ignore */ }
}

export function useScrollLock(): [boolean, (locked: boolean) => void] {
  const [locked, setLocked] = useState(loadScrollLock)
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<boolean>
      if (typeof custom.detail === 'boolean') {
        setLocked(custom.detail)
      } else {
        setLocked(loadScrollLock())
      }
    }
    window.addEventListener('iem-scroll-lock-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('iem-scroll-lock-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])
  const update = (next: boolean) => {
    setLocked(next)
    saveScrollLock(next)
  }
  return [locked, update]
}

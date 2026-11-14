import { NO_TASTE, type Taste } from './curves'
import type { Biquad } from './biquad'
import { parseFilters } from './peq'

/** What a profile was edited from: an IEM simulation, a target curve, or nothing (plain custom EQ). */
export type ProfileBase = { kind: 'iem'; iemId: string } | { kind: 'target'; target: string } | null

/**
 * An EQ you made in the gallery ("Edit this EQ" → "Save this EQ"): a base plus your taste
 * and 10 custom bands on top. Kept in its own storage, never in the IEM database: profiles
 * aren't real IEMs, so they stay out of search, tournaments and the catalog, and Settings can
 * delete them all at once.
 */
export interface EqProfile {
  id: string
  name: string
  created: number
  base: ProfileBase
  taste: Taste
  gains: number[]
  /** How much of the base plays (%, gallery Strength); absent = 100. */
  strength?: number
  /** Advanced (parametric) filters; when present they play instead of the 10 bands. */
  filters?: Biquad[]
  /** 'advanced+' for a 20-filter profile (gallery.ts PeqTier); absent otherwise. */
  tier?: 'advanced' | 'advanced+'
}

export const PROFILES_KEY = 'user-eq-profiles-v1'

/** Storage the profiles live in (localStorage in the app; a plain object in tests). */
export interface ProfileStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const store = (): ProfileStore | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

const isTaste = (t: unknown): t is Taste =>
  !!t && typeof t === 'object' && ['bass', 'treble', 'tilt'].every((k) => typeof (t as Record<string, unknown>)[k] === 'number')

const isBase = (b: unknown): b is ProfileBase =>
  b === null ||
  (!!b && typeof b === 'object' &&
    (((b as { kind?: unknown }).kind === 'iem' && typeof (b as { iemId?: unknown }).iemId === 'string') ||
      ((b as { kind?: unknown }).kind === 'target' && typeof (b as { target?: unknown }).target === 'string')))

/** Saved profiles, oldest first; anything malformed is skipped rather than breaking the list. */
export function loadProfiles(s: ProfileStore | null = store()): EqProfile[] {
  try {
    const v: unknown = JSON.parse(s?.getItem(PROFILES_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter(
      (p): p is EqProfile =>
        !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.created === 'number' &&
        isBase(p.base) && isTaste(p.taste) && Array.isArray(p.gains) && p.gains.length === 10 && p.gains.every((g: unknown) => typeof g === 'number'),
    ).map((p) => (p.filters === undefined ? p : { ...p, filters: parseFilters(p.filters) ?? undefined }))
  } catch {
    return []
  }
}

export function saveProfiles(list: EqProfile[], s: ProfileStore | null = store()) {
  try {
    if (list.length) s?.setItem(PROFILES_KEY, JSON.stringify(list))
    else s?.removeItem(PROFILES_KEY)
  } catch {
    /* storage full or unavailable */
  }
}

/** "Custom n" with the lowest n not already used. */
export function defaultProfileName(list: EqProfile[]): string {
  const used = new Set(list.map((p) => p.name.trim().toLowerCase()))
  let n = 1
  while (used.has(`custom ${n}`)) n++
  return `Custom ${n}`
}

/** A new profile appended to `list` (the name falls back to the next "Custom n"). */
export function addProfile(
  list: EqProfile[],
  p: { name?: string; base: ProfileBase; taste?: Taste; gains: number[]; strength?: number; filters?: Biquad[]; tier?: 'advanced' | 'advanced+' },
  now = Date.now(),
): { list: EqProfile[]; profile: EqProfile } {
  const profile: EqProfile = {
    id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: p.name?.trim() || defaultProfileName(list),
    created: now,
    base: p.base,
    taste: p.taste ?? NO_TASTE,
    gains: p.gains.slice(0, 10),
    ...(p.strength !== undefined && p.strength < 100 ? { strength: p.strength } : {}),
    ...(p.filters ? { filters: p.filters } : {}),
    ...(p.filters && p.tier === 'advanced+' ? { tier: p.tier } : {}),
  }
  return { list: [...list, profile], profile }
}

/** `list` with profile `id` changed (its id and creation time stay). */
export function updateProfile(list: EqProfile[], id: string, change: Partial<Omit<EqProfile, 'id' | 'created'>>): EqProfile[] {
  return list.map((p) => (p.id === id ? { ...p, ...change, name: change.name?.trim() || p.name } : p))
}

export function deleteProfile(list: EqProfile[], id: string): EqProfile[] {
  return list.filter((p) => p.id !== id)
}

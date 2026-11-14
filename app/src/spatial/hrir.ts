import { IMPORTED_ID, loadStoredHrir } from './hrirStore'
import type { HrirSet } from './types'

/** public/data/hrir/<id>.json as written by scripts/build_hrirs.py. */
export interface HrirFile {
  id: string
  name: string
  source: string
  sampleRate: number
  stepDeg: number
  taps?: number
  /** Base64 little-endian Float32, left and right ear, one entry per `stepDeg` from straight ahead. */
  ring: { l: string; r: string }[]
}

/** Base64 of little-endian Float32 samples → Float32Array. */
export function decodeFloat32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const out = new Float32Array(bytes.length >> 2)
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

export function parseHrirFile(f: HrirFile): HrirSet {
  if (!f.ring?.length || !(f.sampleRate > 0) || !(f.stepDeg > 0)) throw new Error(`bad HRIR file ${f.id}`)
  return {
    id: f.id,
    name: f.name,
    source: f.source,
    sampleRate: f.sampleRate,
    stepDeg: f.stepDeg,
    ring: f.ring.map((p) => ({ left: decodeFloat32(p.l), right: decodeFloat32(p.r) })),
  }
}

const cache = new Map<string, Promise<HrirSet>>()
const versions = new Map<string, number>()

/**
 * Fetches and decodes public/data/hrir/<id>.json (once per id; a failed fetch is retried next time).
 * 'imported' is the user's own SOFA import, kept in IndexedDB (see sofa.ts, hrirStore.ts).
 */
export function loadHrirSet(id: string): Promise<HrirSet> {
  let p = cache.get(id)
  if (!p) {
    p =
      id === IMPORTED_ID
        ? loadStoredHrir(id).then((s) => s ?? Promise.reject(new Error('No imported HRTF')))
        : fetch(`${import.meta.env.BASE_URL}data/hrir/${encodeURIComponent(id)}.json`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HRIR ${id}: HTTP ${r.status}`))))
            .then((f: HrirFile) => parseHrirFile(f))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

/** Drop a cached set whose contents changed (a new import); players following the settings reload it. */
export function forgetHrirSet(id: string) {
  cache.delete(id)
  versions.set(id, hrirVersion(id) + 1)
}

/** Bumped by forgetHrirSet, so a player knows to reload a set it already has under the same id. */
export function hrirVersion(id: string): number {
  return versions.get(id) ?? 0
}

/** One entry of public/data/hrir/index.json: the sets offered in "Pick your HRTF by ear". */
export interface HrirIndexEntry {
  id: string
  name: string
  source: string
  /** The group head it's compared under in the picker's second round (knockout.ts twoRounds). */
  group?: string
}

let index: Promise<HrirIndexEntry[]> | null = null

export function loadHrirIndex(): Promise<HrirIndexEntry[]> {
  if (!index) {
    index = fetch(`${import.meta.env.BASE_URL}data/hrir/index.json`).then((r) =>
      r.ok ? (r.json() as Promise<HrirIndexEntry[]>) : Promise.reject(new Error(`HRIR index: HTTP ${r.status}`)),
    )
    index.catch(() => (index = null))
  }
  return index
}

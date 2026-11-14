import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPATIAL, loadSpatial, onSpatialChange, sanitizeSpatial, saveSpatial } from './settings'

describe('spatial settings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to off with the generic HRIR and no head tracking', () => {
    expect(DEFAULT_SPATIAL).toEqual({ mode: 'off', hrirId: 'generic', headTracking: 'off', headCm: null, headCmBy: null, xfAmount: 100, xfAngle: 30 })
    expect(sanitizeSpatial(null)).toEqual(DEFAULT_SPATIAL)
  })
  it('drops unknown values from an old or edited save', () => {
    expect(sanitizeSpatial({ mode: 'surround', hrirId: '', headTracking: 'bluetooth' })).toEqual(DEFAULT_SPATIAL)
    expect(sanitizeSpatial({ mode: 'room', hrirId: 'sonicom-p0002' })).toEqual({ ...DEFAULT_SPATIAL, mode: 'room', hrirId: 'sonicom-p0002' })
  })
  it('keeps a head width within range, and who set it only with a width', () => {
    expect(sanitizeSpatial({ headCm: 30, headCmBy: 'camera' })).toMatchObject({ headCm: 18, headCmBy: 'camera' })
    expect(sanitizeSpatial({ headCm: 'big', headCmBy: 'you' })).toMatchObject({ headCm: null, headCmBy: null })
  })
  it('falls back to the defaults when storage is missing or broken', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} })
    expect(loadSpatial()).toEqual(DEFAULT_SPATIAL)
  })
  it('saves and tells subscribers', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    const seen: string[] = []
    const off = onSpatialChange((s) => seen.push(s.mode))
    saveSpatial({ ...DEFAULT_SPATIAL, mode: 'crossfeed' })
    off()
    saveSpatial({ ...DEFAULT_SPATIAL, mode: 'room' })
    expect(seen).toEqual(['crossfeed'])
    expect(loadSpatial().mode).toBe('room')
  })
})

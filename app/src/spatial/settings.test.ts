import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPATIAL, loadSpatial, onSpatialChange, sanitizeSpatial, saveSpatial } from './settings'

describe('spatial settings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to off with the generic HRIR and no head tracking', () => {
    expect(DEFAULT_SPATIAL).toEqual({ mode: 'off', hrirId: 'generic', headTracking: 'off', headCm: null, headCmBy: null, xfAmount: 100, xfAngle: 30, xfCutHz: 700, earPct: 100, frontFollows: true, modeBeforeTracking: null })
    expect(sanitizeSpatial(null)).toEqual(DEFAULT_SPATIAL)
  })
  it('keeps the crossfeed cutoff and ear correction % in range (§113 check)', () => {
    expect(sanitizeSpatial({ xfCutHz: 900, earPct: 60 })).toMatchObject({ xfCutHz: 900, earPct: 60 })
    expect(sanitizeSpatial({ xfCutHz: 5000, earPct: -3 })).toMatchObject({ xfCutHz: 1400, earPct: 0 })
  })
  it('keeps earbuds head tracking, 360 mode and front-follows across a restart (section 104)', () => {
    expect(sanitizeSpatial({ mode: '360', headTracking: 'earbuds', frontFollows: false })).toMatchObject({ mode: '360', headTracking: 'earbuds', frontFollows: false })
    // §106 A: rough estimation is a source, and the mode from before tracking is kept (an unknown one is dropped)
    expect(sanitizeSpatial({ headTracking: 'rough', modeBeforeTracking: 'crossfeed' })).toMatchObject({ headTracking: 'rough', modeBeforeTracking: 'crossfeed' })
    expect(sanitizeSpatial({ modeBeforeTracking: 'loud' }).modeBeforeTracking).toBeNull()
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

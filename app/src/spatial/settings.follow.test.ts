import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPATIAL, followSpatialSettings, saveSpatial } from './settings'

vi.mock('./hrir', () => ({ hrirVersion: () => 0, loadHrirSet: () => new Promise(() => {}) }))
vi.mock('./earCorrection', () => ({ loadEarCorrection: () => Promise.resolve(null) }))

describe('followSpatialSettings', () => {
  it('keeps a no-360 stage (the tournament) at Speakers, and stops after unfollow', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    const modes: string[] = []
    const stage = { setMode: (m: string) => modes.push(m), setHrir: () => {}, setHeadYaw: () => {} }
    saveSpatial({ ...DEFAULT_SPATIAL, mode: '360' })
    const off = followSpatialSettings(stage as never, true)
    saveSpatial({ ...DEFAULT_SPATIAL, mode: 'room' })
    off()
    saveSpatial({ ...DEFAULT_SPATIAL, mode: '360' })
    expect(modes).toEqual(['speakers', 'room'])
    vi.unstubAllGlobals()
  })
})

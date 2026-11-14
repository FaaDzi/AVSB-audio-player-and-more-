import { describe, it, expect, beforeEach } from 'vitest'

// localStorage mock for vitest in node environment
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
}

import {
  addProfileItem,
  applyProfileItem,
  clearSessionAutosave,
  getGearProfile,
  getSessionAutosave,
  removeProfileItem,
  setProfileItemStrength,
  setSessionAutosave,
} from './gearProfiles'
import { setSetting } from '../settings/store'
import type { SavedPreset } from '../eqState'

describe('Gear Profiles Per-Device Scoping', () => {
  beforeEach(() => {
    // Reset test storage
    setSetting('gear.profiles.v1', JSON.stringify({}))
    clearSessionAutosave('iem-1')
    clearSessionAutosave('iem-2')
  })

  it('keeps profiles isolated between different devices', () => {
    // Add target to IEM 1
    addProfileItem(
      { id: 'Harman In-Ear 2019v2', kind: 'target', name: 'Harman In-Ear 2019', strength: 80 },
      'iem-1',
    )
    setProfileItemStrength('Harman In-Ear 2019v2', 78, 'iem-1')

    // Add target to IEM 2
    addProfileItem(
      { id: 'IEF Neutral', kind: 'target', name: 'IEF Neutral', strength: 100 },
      'iem-2',
    )

    const profile1 = getGearProfile('iem-1')
    const profile2 = getGearProfile('iem-2')

    // IEM 1 has Harman at 78%
    const harman = profile1.items.find((i) => i.id === 'Harman In-Ear 2019v2')
    expect(harman?.strength).toBe(78)

    // IEM 2 has IEF Neutral at 100%, and does not have the modified Harman strength from IEM 1
    const ief = profile2.items.find((i) => i.id === 'IEF Neutral')
    expect(ief?.strength).toBe(100)
    const harmanIn2 = profile2.items.find((i) => i.id === 'Harman In-Ear 2019v2')
    expect(harmanIn2?.strength ?? 100).toBe(100)
  })

  it('isolates ephemeral session autosaves per device', () => {
    const dummyPreset: SavedPreset = {
      name: 'Custom EQ 1 (Autosaved)',
      mode: 'basic',
      count: 10,
      gains: [2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      filters: [],
      preamp: -1,
      bass: 2,
      treble: 0,
    }

    setSessionAutosave('iem-1', dummyPreset)

    expect(getSessionAutosave('iem-1')).toEqual(dummyPreset)
    expect(getSessionAutosave('iem-2')).toBeNull()

    clearSessionAutosave('iem-1')
    expect(getSessionAutosave('iem-1')).toBeNull()
  })

  it('allows applying raw sound or target aim', () => {
    addProfileItem(
      { id: 'JM-1 Harman 2024', kind: 'target', name: 'JM-1', strength: 85 },
      'iem-1',
    )

    applyProfileItem('JM-1 Harman 2024', 'iem-1')
    expect(getGearProfile('iem-1').activeItemId).toBe('JM-1 Harman 2024')

    applyProfileItem(null, 'iem-1')
    expect(getGearProfile('iem-1').activeItemId).toBeNull()
  })

  it('newly added device starts with 0 targets selected (Raw audio with no changes)', () => {
    const profile = getGearProfile('iem-brand-new')
    expect(profile.items).toEqual([])
    expect(profile.activeItemId).toBeNull()
  })

  it('quarantines IEM targets from Headphone profiles and cleanses legacy mixes', () => {
    // Simulate legacy storage containing a mixed list of both IEM and Headphone targets
    const contaminatedMap = {
      'hp-sennheiser-hd600': {
        deviceId: 'hp-sennheiser-hd600',
        activeItemId: 'Harman In-Ear 2019',
        items: [
          { id: 'Harman In-Ear 2019', kind: 'target', name: 'Harman In-Ear 2019', color: '#a855f7', strength: 100 },
          { id: 'IEF Neutral', kind: 'target', name: 'IEF Neutral', color: '#06b6d4', strength: 100 },
          { id: 'JM-1 Harman 2024', kind: 'target', name: 'JM-1 Harman 2024', color: '#f59e0b', strength: 100 },
          { id: 'Harman Over-Ear 2018', kind: 'target', name: 'Harman Over-Ear 2018', color: '#ec4899', strength: 100 },
          { id: 'oratory1990 Optimum', kind: 'target', name: 'oratory1990 Optimum', color: '#8b5cf6', strength: 100 },
        ],
      },
      'iem-moondrop-aria': {
        deviceId: 'iem-moondrop-aria',
        activeItemId: 'oratory1990 Optimum',
        items: [
          { id: 'Harman In-Ear 2019', kind: 'target', name: 'Harman In-Ear 2019', color: '#a855f7', strength: 100 },
          { id: 'Harman Over-Ear 2018', kind: 'target', name: 'Harman Over-Ear 2018', color: '#ec4899', strength: 100 },
          { id: 'oratory1990 Optimum', kind: 'target', name: 'oratory1990 Optimum', color: '#8b5cf6', strength: 100 },
        ],
      },
    }
    setSetting('gear.profiles.v1', JSON.stringify(contaminatedMap))

    // Headphone profile must only retain Over-Ear / Headphone targets
    const hpProfile = getGearProfile('hp-sennheiser-hd600')
    expect(hpProfile.items.map((i) => i.id)).toEqual(['Harman Over-Ear 2018', 'oratory1990 Optimum'])
    // Because the active item was Harman In-Ear, it gets reset to null (Raw sound)
    expect(hpProfile.activeItemId).toBeNull()

    // IEM profile must only retain In-Ear targets
    const iemProfile = getGearProfile('iem-moondrop-aria')
    expect(iemProfile.items.map((i) => i.id)).toEqual(['Harman In-Ear 2019'])
    expect(iemProfile.activeItemId).toBeNull()
  })

  it('rejects adding cross-category targets in addProfileItem', () => {
    // Attempt to add In-Ear target to a headphone
    addProfileItem(
      { id: 'Harman In-Ear 2019', kind: 'target', name: 'Harman In-Ear 2019', strength: 100 },
      'hp-sennheiser-hd-600',
    )
    const hp = getGearProfile('hp-sennheiser-hd-600')
    expect(hp.items.some((i) => i.id === 'Harman In-Ear 2019')).toBe(false)

    // Attempt to add Over-Ear target to an IEM
    addProfileItem(
      { id: 'Harman Over-Ear 2018', kind: 'target', name: 'Harman Over-Ear 2018', strength: 100 },
      'iem-xenns-tea',
    )
    const iem = getGearProfile('iem-xenns-tea')
    expect(iem.items.some((i) => i.id === 'Harman Over-Ear 2018')).toBe(false)
  })
})

describe('§80 D/E: speakers, soundbars and their own EQ', () => {
  it('keeps each device its own EQ when switching (speakers vs soundbar)', async () => {
    const { onGearChanged } = await import('./gearProfiles')
    const { getEq, setEq } = await import('../eqState')
    clearSessionAutosave('spk-a')
    clearSessionAutosave('spk-generic-soundbar')
    setEq({ preset: 'Speakers EQ', gains: [1, 2, 3] })
    onGearChanged('spk-generic-soundbar', 'spk-a')
    expect(getSessionAutosave('spk-a')?.name).toBe('Speakers EQ')
    setEq({ preset: 'Soundbar EQ', gains: [-1, -2, -3] })
    onGearChanged('spk-a', 'spk-generic-soundbar')
    expect(getEq().preset).toBe('Speakers EQ')
    expect(getEq().gains).toEqual([1, 2, 3])
    expect(getSessionAutosave('spk-generic-soundbar')?.gains).toEqual([-1, -2, -3])
  })

  it('lets speakers aim only at speakers, in-ears only at ear gear', async () => {
    const { aimKindsFor, isSoundbarDevice } = await import('./gearProfiles')
    expect([...aimKindsFor('spk-jbl-104')]).toEqual(['speakers', 'soundbar'])
    expect(aimKindsFor('iem-1').has('speakers')).toBe(false)
    addProfileItem({ id: 'spk-kef-q150', kind: 'device', name: 'KEF Q150', strength: 100 }, 'spk-jbl-104')
    addProfileItem({ id: 'iem-2', kind: 'device', name: 'Some IEM', strength: 100 }, 'spk-jbl-104')
    expect(getGearProfile('spk-jbl-104').items.map((i) => i.id)).toEqual(['spk-kef-q150'])
    expect(isSoundbarDevice('spk-bose-tv-speaker-soundbar')).toBe(true)
    expect(isSoundbarDevice('spk-jbl-104')).toBe(false)
  })
})

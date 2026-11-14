import { beforeEach, describe, expect, it } from 'vitest'

// localStorage for the settings store (vitest runs in node here)
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
}

describe('My gear', async () => {
  const gear = await import('./gear')
  const sound = await import('./soundState')
  const storage = await import('../../tournament/storage')
  beforeEach(() => {
    for (const d of gear.getGear().owned) gear.removeOwned(d.id)
    for (const id of gear.getGear().starred) gear.toggleStar(id, false)
  })

  it('makes the first device active and shares it with Sound and the tournament', () => {
    gear.addOwned('ziigaat-odyssey')
    expect(gear.getGear().active).toBe('ziigaat-odyssey')
    expect(sound.getSound().deviceId).toBe('ziigaat-odyssey')
    expect(storage.loadPrefs().currentId).toBe('ziigaat-odyssey')
    gear.addOwned('truthear-hexa')
    expect(gear.getGear().active).toBe('ziigaat-odyssey')
    gear.setActive('truthear-hexa')
    expect(sound.getSound().deviceId).toBe('truthear-hexa')
  })

  it('removing the active device falls back to the next one', () => {
    gear.addOwned('a')
    gear.addOwned('b')
    gear.removeOwned('a')
    expect(gear.getGear().active).toBe('b')
    gear.removeOwned('b')
    expect(gear.getGear().active).toBeNull()
  })

  it('hearing a device stars it and aims Sound at it at full strength', () => {
    sound.setSound({ strength: 40 })
    gear.hearDevice('hp-sennheiser-hd-600-2020')
    expect(gear.getGear().starred).toContain('hp-sennheiser-hd-600-2020')
    expect(sound.getSound().aim).toEqual({ kind: 'device', id: 'hp-sennheiser-hd-600-2020' })
    expect(sound.getSound().strength).toBe(100)
    gear.toggleStar('hp-sennheiser-hd-600-2020')
    expect(gear.getGear().starred).not.toContain('hp-sennheiser-hd-600-2020')
  })
})

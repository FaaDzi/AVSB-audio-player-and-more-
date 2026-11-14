import { describe, expect, it } from 'vitest'
import { addProfile, defaultProfileName, deleteProfile, loadProfiles, PROFILES_KEY, saveProfiles, updateProfile, type ProfileStore } from './userProfiles'

const memory = (): ProfileStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  }
}
const flat = new Array(10).fill(0)

describe('user EQ profiles', () => {
  it('saves and loads, in their own key', () => {
    const s = memory()
    const { list } = addProfile([], { base: { kind: 'iem', iemId: 'moondrop-aria' }, taste: { bass: 3, treble: 0, tilt: 0 }, gains: flat.map((_, i) => i) })
    saveProfiles(list, s)
    expect(Object.keys(s.data)).toEqual([PROFILES_KEY])
    expect(loadProfiles(s)).toEqual(list)
  })

  it('names default to the lowest free "Custom n"', () => {
    let list = addProfile([], { base: null, gains: flat }).list
    list = addProfile(list, { base: null, gains: flat }).list
    expect(list.map((p) => p.name)).toEqual(['Custom 1', 'Custom 2'])
    list = deleteProfile(list, list[0].id)
    expect(defaultProfileName(list)).toBe('Custom 1')
    expect(addProfile(list, { name: '  Aria + bass ', base: null, gains: flat }).profile.name).toBe('Aria + bass')
  })

  it('rename keeps the id; a blank name is ignored', () => {
    const { list, profile } = addProfile([], { base: null, gains: flat })
    const renamed = updateProfile(list, profile.id, { name: 'Late night' })
    expect(renamed[0]).toMatchObject({ id: profile.id, name: 'Late night', created: profile.created })
    expect(updateProfile(renamed, profile.id, { name: '   ' })[0].name).toBe('Late night')
  })

  it('deleting the last one clears the key; malformed rows are skipped', () => {
    const s = memory()
    const { list, profile } = addProfile([], { base: { kind: 'target', target: 'JM-1' }, gains: flat })
    saveProfiles(list, s)
    saveProfiles(deleteProfile(list, profile.id), s)
    expect(s.data[PROFILES_KEY]).toBeUndefined()
    s.setItem(PROFILES_KEY, JSON.stringify([{ id: 'x' }, list[0], { ...list[0], gains: [1, 2] }]))
    expect(loadProfiles(s)).toEqual(list)
    s.setItem(PROFILES_KEY, 'not json')
    expect(loadProfiles(s)).toEqual([])
  })
})

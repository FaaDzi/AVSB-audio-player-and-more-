import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { buildBackup, parseBackup } = await import('./backup')

describe('buildBackup', () => {
  const values = { theme: 'Dark', playlists: '[{"id":"p"}]' }
  it('holds only the chosen categories', () => {
    expect(buildBackup(values, true, false, 't')).toEqual({ app: 'music-preferences', version: 1, created: 't', settings: { theme: 'Dark' } })
    expect(buildBackup(values, false, true, 't')).toEqual({ app: 'music-preferences', version: 1, created: 't', playlists: '[{"id":"p"}]' })
  })
  it('round-trips through its own file format', () => {
    const b = buildBackup(values, true, true, 't')
    expect(parseBackup(JSON.stringify(b))).toEqual(b)
  })
})

describe('parseBackup', () => {
  it('refuses files that are not ours', () => {
    expect(() => parseBackup('not json')).toThrow('not a backup')
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow('not a backup')
    expect(() => parseBackup('null')).toThrow('not a backup')
  })
})

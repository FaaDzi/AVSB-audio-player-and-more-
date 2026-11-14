import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, ownedOf, withCurrent, withOwned, withoutOwned } from './types'

describe('My IEMs', () => {
  const crin = withCurrent(DEFAULT_PREFS, 'kz-crin')

  it('an old save with only a current IEM owns that IEM', () => {
    expect(ownedOf({ currentId: 'kz-crin' })).toEqual(['kz-crin'])
  })

  it('switching keeps the old IEM in the collection', () => {
    const p = withCurrent(crin, 'aria')
    expect(p.currentId).toBe('aria')
    expect(ownedOf(p).sort()).toEqual(['aria', 'kz-crin'])
  })

  it('adding does not switch, and never duplicates', () => {
    const p = withOwned(withOwned(crin, 'aria'), 'aria')
    expect(p.currentId).toBe('kz-crin')
    expect(ownedOf(p)).toEqual(['kz-crin', 'aria'])
  })

  it('removing the worn IEM switches to the next one owned, or none', () => {
    const p = withoutOwned(withOwned(crin, 'aria'), 'kz-crin')
    expect(p.currentId).toBe('aria')
    expect(withoutOwned(p, 'aria').currentId).toBeNull()
    expect(ownedOf(withoutOwned(p, 'aria'))).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { isJapaneseSong, tidyRomaji } from './romaji'

describe('romaji', () => {
  it('only takes songs with kana as Japanese', () => {
    expect(isJapaneseSong(['夢に描かれるのを待ってた'])).toBe(true)
    expect(isJapaneseSong(['月亮代表我的心'])).toBe(false)
    expect(isJapaneseSong(['Hello', 'world'])).toBe(false)
  })
  it('tidies the converter\'s spacing', () => {
    expect(tidyRomaji('  kimi ga   hitori " namida " shi teru ?  ')).toBe('kimi ga hitori "namida" shi teru?')
    expect(tidyRomaji('ashita yo ! ashita yo !')).toBe('ashita yo! ashita yo!')
  })
})

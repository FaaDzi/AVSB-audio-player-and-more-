import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibrarySong } from './library'
import { pickSongs } from './picker'
import {
  getStoredOwnMusicMix,
  isSongHidden,
  OWN_MUSIC_MIX_KEY,
  setOwnMusicMix,
  type OwnMusicMix,
} from './phoneLibrary'

describe('phoneLibrary & ownMusicMix settings', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    })
  })

  it('defaults to 0 (No) when nothing is stored', () => {
    expect(getStoredOwnMusicMix()).toBe(0)
  })

  it('migrates legacy phone-in-matches-v1 = 1 to 0.5 (Half)', () => {
    store.set('phone-in-matches-v1', '1')
    expect(getStoredOwnMusicMix()).toBe(0.5)
  })

  it('migrates legacy phone-in-matches-v1 = 0 to 0 (No)', () => {
    store.set('phone-in-matches-v1', '0')
    expect(getStoredOwnMusicMix()).toBe(0)
  })

  it('reads stored ownMusicMix values correctly', () => {
    const values: OwnMusicMix[] = [0, 0.25, 0.5, 0.75, 1]
    for (const v of values) {
      store.set(OWN_MUSIC_MIX_KEY, String(v))
      expect(getStoredOwnMusicMix()).toBe(v)
    }
  })

  it('sets ownMusicMix and keeps phone-in-matches-v1 synchronized', () => {
    setOwnMusicMix(0.75)
    expect(store.get(OWN_MUSIC_MIX_KEY)).toBe('0.75')
    expect(store.get('phone-in-matches-v1')).toBe('1')

    setOwnMusicMix(0)
    expect(store.get(OWN_MUSIC_MIX_KEY)).toBe('0')
    expect(store.get('phone-in-matches-v1')).toBe('0')

    setOwnMusicMix(1)
    expect(store.get(OWN_MUSIC_MIX_KEY)).toBe('1')
    expect(store.get('phone-in-matches-v1')).toBe('1')
  })
})

describe('pickSongs with 1,000 mock songs & mix ratios', () => {
  // 30 benchmark "our" songs
  const ourSongs: LibrarySong[] = Array.from({ length: 30 }, (_, i) => ({
    id: `our-${i}`,
    artist: `Curated Artist ${i % 5}`,
    title: `Benchmark Track ${i}`,
    album: 'Audiophile Vol 1',
    year: 2020 + (i % 4),
    category: (['bass', 'vocals', 'treble', 'acoustic', 'stage', 'busy'] as const)[i % 6],
    also: [],
    genre: (['pop', 'rock', 'electronic', 'jazz', 'classical'] as const)[i % 5],
    clip: { start: 10, end: 30 },
    file: { name: `our-${i}.flac`, size: 1000000, arrayBuffer: async () => new ArrayBuffer(0) },
  }))

  // 1,000 phone "own" songs across 10 folders (100 songs per folder)
  const phoneSongs: LibrarySong[] = Array.from({ length: 1000 }, (_, i) => {
    const folderIdx = Math.floor(i / 100)
    const folderKey = `external_primary:Music/Folder_${folderIdx}/`
    return {
      id: `extra-phone-${i}`,
      artist: `Local Artist ${i % 20}`,
      title: `Phone Track ${i}`,
      album: `Album ${folderIdx}`,
      year: null,
      category: 'any',
      also: [],
      genre: 'unknown',
      clip: { start: null, end: null },
      phone: { folder: folderKey, added: 1700000000 + i },
      file: { name: `track_${i}.mp3`, size: 500000, arrayBuffer: async () => new ArrayBuffer(0) },
    }
  })

  const combined1030 = [...ourSongs, ...phoneSongs]

  it('strictly excludes songs from hidden folders even under 100% own music mix', () => {
    // Hide folders 0, 1, 2 (first 300 phone songs)
    const hidden = new Set([
      'external_primary:Music/Folder_0/',
      'external_primary:Music/Folder_1/',
      'external_primary:Music/Folder_2/',
    ])

    // Verify helper isSongHidden
    expect(isSongHidden({ ...phoneSongs[0], phone: { folder: 'external_primary:Music/Folder_0/', added: 0 } })).toBe(false) // not in global state yet
    // Pass hiddenFolders directly to pickSongs
    const picked = pickSongs(combined1030, 200, {
      ownMusicMix: 1,
      hiddenFolders: hidden,
    })

    expect(picked.length).toBeGreaterThan(0)
    for (const song of picked) {
      expect(song.phone).toBeDefined()
      expect(hidden.has(song.phone!.folder)).toBe(false)
    }
  })

  it('picks 100% our music (0% own music) when ownMusicMix is 0', () => {
    const picked = pickSongs(combined1030, 30, {
      ownMusicMix: 0,
    })

    expect(picked.length).toBe(30)
    for (const song of picked) {
      expect(song.phone).toBeUndefined()
      expect(song.id.startsWith('our-')).toBe(true)
    }
  })

  it('picks 100% own music when ownMusicMix is 1', () => {
    const picked = pickSongs(combined1030, 50, {
      ownMusicMix: 1,
    })

    expect(picked.length).toBe(50)
    for (const song of picked) {
      expect(song.phone).toBeDefined()
      expect(song.id.startsWith('extra-phone-')).toBe(true)
    }
  })

  it('accurately produces ~25%, ~50%, and ~75% mix ratios across 1,000 picks', () => {
    const testRatio = (mix: OwnMusicMix, expectedPct: number) => {
      let ownCount = 0
      const totalRounds = 1000

      // Simple deterministic LCG pseudo-random generator
      let seed = 42
      const pseudoRng = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
      }

      for (let i = 0; i < totalRounds; i++) {
        const picked = pickSongs(combined1030, 1, {
          ownMusicMix: mix,
          rng: pseudoRng,
        })
        if (picked[0]?.phone) ownCount++
      }

      const actualPct = ownCount / totalRounds
      // Assert within ±4% tolerance of target
      expect(actualPct).toBeGreaterThanOrEqual(expectedPct - 0.04)
      expect(actualPct).toBeLessThanOrEqual(expectedPct + 0.04)
    }

    testRatio(0.25, 0.25)
    testRatio(0.5, 0.5)
    testRatio(0.75, 0.75)
  })

  it('handles empty pool fallbacks gracefully', () => {
    // When ourSongs is empty, mix 0 returns empty (strictly 0% own music)
    const emptyOur = pickSongs(phoneSongs, 5, { ownMusicMix: 0 })
    expect(emptyOur).toEqual([])

    // When ourSongs is empty, mix 0.5 falls back to own songs
    const fallbackOwn = pickSongs(phoneSongs, 5, { ownMusicMix: 0.5 })
    expect(fallbackOwn.length).toBe(5)
    expect(fallbackOwn.every((s) => !!s.phone)).toBe(true)

    // When phoneSongs is empty, mix 0.5 falls back to our songs
    const fallbackOur = pickSongs(ourSongs, 5, { ownMusicMix: 0.5 })
    expect(fallbackOur.length).toBe(5)
    expect(fallbackOur.every((s) => !s.phone)).toBe(true)
  })
})

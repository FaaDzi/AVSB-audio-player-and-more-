import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(join(__dirname, '../../../songs/manifest.json'), 'utf-8')) as {
  categories: Record<string, string>
  songs: { id: string; artist: string; title: string; category: string; also: string[]; fileName?: string }[]
}

describe('songs/manifest.json (the benchmark list, §54)', () => {
  const songs = manifest.songs
  it('has 350 songs with unique ids and file names', () => {
    expect(songs).toHaveLength(350)
    expect(new Set(songs.map((s) => s.id)).size).toBe(songs.length)
    const files = songs.map((s) => s.fileName).filter(Boolean)
    expect(new Set(files).size).toBe(files.length)
  })
  it('uses only known categories, and file names safe on Windows and Android', () => {
    const cats = new Set(Object.keys(manifest.categories))
    for (const s of songs) {
      expect(cats.has(s.category), `${s.id} ${s.category}`).toBe(true)
      for (const a of s.also) expect(cats.has(a), `${s.id} also ${a}`).toBe(true)
      if (s.fileName) expect(s.fileName, s.id).not.toMatch(/[\\/:*?"<>|]/)
    }
  })
  it('lists each artist + title once', () => {
    const keys = songs.map((s) => `${s.artist}|${s.title}`.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })
})

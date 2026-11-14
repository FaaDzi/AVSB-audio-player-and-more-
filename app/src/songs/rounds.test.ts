import { describe, expect, it } from 'vitest'
import type { LibrarySong, SongManifest } from './library'
import { createRoundSource } from './rounds'

// a fake AudioContext: "decodes" any file into 60 s of silence and counts the decodes
function fakeCtx() {
  const ctx = {
    sampleRate: 1000,
    decodes: 0,
    createBuffer: (ch: number, len: number, sr: number) => fakeBuffer(ch, len, sr),
    decodeAudioData: async () => {
      ctx.decodes++
      return fakeBuffer(2, 60_000, 1000)
    },
  }
  return ctx
}
function fakeBuffer(ch: number, len: number, sr: number) {
  const data = Array.from({ length: ch }, () => new Float32Array(len))
  return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i: number) => data[i], copyToChannel: (d: Float32Array, i: number) => data[i].set(d) }
}

const cats = ['bass', 'vocals', 'treble', 'acoustic', 'stage', 'busy'] as const
const library: LibrarySong[] = cats.map((c, i) => ({
  id: `song-${i}`, artist: 'A', title: `T${i}`, album: '', year: null, category: c, also: [], genre: 'pop',
  clip: { start: 0, end: 40 }, file: { name: `t${i}.flac`, size: 1000 + i, arrayBuffer: async () => new ArrayBuffer(8) },
}))
const manifest = { categories: Object.fromEntries(cats.map((c) => [c, c])), songs: [] } as unknown as SongManifest

describe('round source', () => {
  it('prepares the next round while the current one plays, and reuses it', async () => {
    const ctx = fakeCtx()
    const src = createRoundSource({ ctx: ctx as unknown as BaseAudioContext, library, manifest, heardBy: {}, entrants: ['a', 'b'] })
    const r0 = await src.getRound(0, 0)
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.decodes).toBe(2) // round 0, plus round 1 started early
    const r1 = await src.getRound(1, 0)
    expect(r1.title).not.toBe(r0.title)
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.decodes).toBe(3) // round 1 came from the early decode; only round 2 is new
  })
})

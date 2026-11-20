// §100: the namer, lyrics and art run side by side; only a rip waits for the namer
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from './library'

const naming = { running: true }
let waits = 0
const searched: [string, boolean][] = []

vi.mock('./metadata', () => ({
  isNamingRunning: () => naming.running,
  isRateLimited: () => false,
  lookUp: vi.fn(),
  nameOne: vi.fn(async () => {}),
  needsNaming: () => false,
  savedDetails: () => null,
  saveDetails: vi.fn(),
}))
vi.mock('./onlineLyrics', () => ({
  savedOnlineLyrics: () => null,
  // the namer finishes once the clean song has been searched
  searchOnline: vi.fn(async (t: Track) => { searched.push([t.title, naming.running]); naming.running = false; return null }),
}))
vi.mock('./logs', () => ({ logLine: () => {} }))
vi.mock('./linkClient', () => ({ onMobileData: () => false }))
vi.mock('../platform', () => ({
  allowBulkNotifications: async () => {},
  finishBulkProgress: () => {},
  onBulkStop: () => {},
  showBulkProgress: () => {},
  // a lane stuck waiting for the namer: let it go after a few waits, so the test fails instead of hanging
  waitMs: async () => { if (++waits > 5) naming.running = false },
}))

const song = (id: string, title: string, artist: string) => ({ id, title, artist, path: `/m/${id}.flac` }) as unknown as Track

describe('syncLyrics lanes', () => {
  beforeEach(() => { naming.running = true; searched.length = 0; waits = 0 })

  it('searches clean songs while the namer runs, and a rip only after it', async () => {
    const { syncLyrics } = await import('./bulkMeta')
    const clean = song('a', 'Clean Song', 'Some Artist')
    const rip = song('b', 'Rip Song (Official Video)', 'Some Artist')
    await syncLyrics([rip, clean])
    expect(searched).toEqual([['Clean Song', true], ['Rip Song (Official Video)', false]])
  })
})

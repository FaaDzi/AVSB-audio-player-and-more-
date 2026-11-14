import { describe, expect, it, vi } from 'vitest'
import { downloadSongQueue, type CatalogSong } from './cloudSongs'

const cloud = (stem: string, driveId?: string) =>
  ({ name: `${stem}.opus`, stem, title: stem, size: 10, builtin: false, status: 'cloud', driveId }) as CatalogSong

describe('downloadSongQueue retries', () => {
  it('retries a song after a dropped connection instead of failing it', async () => {
    const tries = new Map<string, number>()
    const download = vi.fn(async (song: CatalogSong) => {
      const n = (tries.get(song.stem) ?? 0) + 1
      tries.set(song.stem, n)
      if (n <= 2) throw new Error('Unable to resolve host')
    })
    const res = await downloadSongQueue([cloud('a', 'id-a'), cloud('b', 'id-b')], { download, retryDelays: [1, 1, 1] })
    expect(res).toEqual({ successful: 2, failed: [] })
    expect(tries.get('a')).toBe(3)
  })

  it('gives up after the last retry and reports the error', async () => {
    const download = vi.fn(async () => {
      throw new Error('Unable to resolve host')
    })
    const res = await downloadSongQueue([cloud('a', 'id-a')], { download, retryDelays: [1, 1] })
    expect(download).toHaveBeenCalledTimes(3)
    expect(res.failed.map((f) => f.error)).toEqual(['Unable to resolve host'])
  })

  it('does not retry a song missing from the Drive folder', async () => {
    const download = vi.fn(async () => {
      throw new Error("a isn't in the Drive folder")
    })
    const res = await downloadSongQueue([cloud('a')], { download, retryDelays: [1, 1] })
    expect(download).toHaveBeenCalledTimes(1)
    expect(res.failed).toHaveLength(1)
  })

  it('stops waiting when the user presses Stop', async () => {
    const ctrl = new AbortController()
    const download = vi.fn(async () => {
      setTimeout(() => ctrl.abort(), 5)
      throw new Error('Unable to resolve host')
    })
    await expect(downloadSongQueue([cloud('a', 'id-a')], { download, signal: ctrl.signal, retryDelays: [60000] })).rejects.toThrow(
      'Download cancelled',
    )
    expect(download).toHaveBeenCalledTimes(1)
  })
})

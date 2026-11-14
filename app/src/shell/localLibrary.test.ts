import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createLibrary } from '../../electron/library-scan.mjs'
import { duplicateGroups, lastScanText, scanIsDue, type LibraryFolder } from './localLibrary'
import type { Track } from './library'

/** A real, tiny WAV: one second of silence. */
function wav(seconds = 1, rate = 8000) {
  const data = rate * seconds * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(data, 40)
  return b
}

const root = mkdtempSync(join(tmpdir(), 'mp-library-'))
const music = join(root, 'Music')
const other = join(root, 'Other')
const data = join(root, 'data')
mkdirSync(join(music, 'Album'), { recursive: true })
mkdirSync(other, { recursive: true })
writeFileSync(join(music, 'top.wav'), wav())
writeFileSync(join(music, 'Album', 'inner.wav'), wav(2))
writeFileSync(join(music, 'Album', 'inner.lrc'), '[00:00.00]hello')
writeFileSync(join(music, 'notes.txt'), 'not music')
writeFileSync(join(other, 'top.wav'), wav())
afterAll(() => rmSync(root, { recursive: true, force: true }))

const md5 = (s: string) => createHash('md5').update(s).digest('hex').slice(0, 12)
const titles = (l: ReturnType<typeof createLibrary>) => l.state().tracks.map((t) => String(t.title)).sort()

describe('library scan', () => {
  const lib = createLibrary({ dataDir: data })

  it('reads a folder with its subfolders, and only audio files', async () => {
    lib.setFolders([{ path: music, subfolders: true }])
    await lib.scan()
    expect(titles(lib)).toEqual(['inner', 'top'])
    const inner = lib.state().tracks.find((t) => t.title === 'inner')!
    expect(inner.lyrics).toBe(true)
    expect(inner.sec).toBeCloseTo(2, 1)
    expect(inner.playable).toBe(true)
  })

  it('keeps the old id: a hash of the path inside the folder', () => {
    const ids = lib.state().tracks.map((t) => t.id).sort()
    expect(ids).toEqual([md5('Album/inner.wav'), md5('top.wav')].sort())
  })

  it('leaves subfolders out when asked', async () => {
    lib.setFolders([{ path: music, subfolders: false }])
    await lib.scan()
    expect(titles(lib)).toEqual(['top'])
  })

  it('leaves out one subfolder, keeps the rest, and brings it back on Add back', async () => {
    lib.setFolders([{ path: music, subfolders: true, exclude: [join(music, 'Album')] }])
    expect(titles(lib)).toEqual(['top'])
    await lib.scan()
    expect(titles(lib)).toEqual(['top'])
    expect(lib.allowed(join(music, 'Album', 'inner.wav'))).toBeNull()
    // a path outside the folder is dropped, not kept as an exclusion
    lib.setFolders([{ path: music, subfolders: true, exclude: [other] }])
    expect(lib.state().folders[0].exclude).toEqual([])
    await lib.scan()
    expect(titles(lib)).toEqual(['inner', 'top'])
  })

  it('takes several folders, and gives a clashing path its own id', async () => {
    lib.setFolders([{ path: music, subfolders: true }, { path: other, subfolders: true }])
    await lib.scan()
    const tops = lib.state().tracks.filter((t) => t.title === 'top')
    expect(tops).toHaveLength(2)
    expect(new Set(tops.map((t) => t.id)).size).toBe(2)
    expect(lib.state().folders.map((f) => f.count)).toEqual([2, 1])
  })

  it('serves only files inside a chosen folder', () => {
    expect(lib.allowed(join(music, 'Album', 'inner.wav'))).toBeTruthy()
    expect(lib.allowed(join(root, 'data', 'library', 'index.json'))).toBeNull()
    expect(lib.allowed(join(music, '..', 'Other', '..', '..', 'x.wav'))).toBeNull()
  })

  it('picks up new and deleted files on a rescan', async () => {
    writeFileSync(join(music, 'new.wav'), wav())
    rmSync(join(music, 'top.wav'))
    await lib.scan()
    expect(titles(lib)).toEqual(['inner', 'new', 'top'])
    expect(lib.state().tracks.filter((t) => t.title === 'top')).toHaveLength(1)
  })

  it('keeps an unplugged folder\'s songs, marked offline, and brings them back', async () => {
    renameSync(other, `${other}-away`)
    await lib.scan()
    const away = lib.state()
    expect(away.folders[1].online).toBe(false)
    expect(away.tracks.find((t) => String(t.root).endsWith('/Other'))?.offline).toBe(true)
    renameSync(`${other}-away`, other)
    await lib.scan()
    expect(lib.state().tracks.find((t) => String(t.root).endsWith('/Other'))?.offline).toBeUndefined()
  })

  it('drops a removed folder\'s songs straight away', () => {
    lib.setFolders([{ path: music, subfolders: true }])
    expect(lib.state().tracks.every((t) => String(t.root).endsWith('/Music'))).toBe(true)
  })

  it('remembers everything across a restart', () => {
    const again = createLibrary({ dataDir: data })
    expect(again.folders()).toHaveLength(1)
    expect(again.state().tracks.length).toBe(lib.state().tracks.length)
  })
})

const folder = (lastScan: number): LibraryFolder => ({ path: 'D:/Music', subfolders: true, lastScan, online: true, count: 1 })

describe('auto scan', () => {
  const day = 86400000
  it('follows the setting', () => {
    expect(scanIsDue([folder(Date.now())], Date.now(), 'Every app open')).toBe(true)
    expect(scanIsDue([folder(Date.now())], Date.now(), 'Off')).toBe(false)
    expect(scanIsDue([folder(0)], day * 2, 'Daily')).toBe(true)
    expect(scanIsDue([folder(day)], day * 1.5, 'Daily')).toBe(false)
    expect(scanIsDue([folder(day)], day * 6, 'Weekly')).toBe(false)
    expect(scanIsDue([], day, 'Every app open')).toBe(false)
  })
  it('says when the last scan was', () => {
    expect(lastScanText(0)).toBe('Not scanned yet')
    expect(lastScanText(1000, 1000 + 4 * 60000)).toBe('4 minutes ago')
    expect(lastScanText(0 + 1, 1 + 3 * 86400000)).toBe('3 days ago')
  })
})

describe('duplicates', () => {
  const t = (o: Partial<Track>) => ({ id: o.id, title: 'Song', artist: 'A', sec: 200, ...o }) as Track
  it('groups the same title and artist within 2 seconds', () => {
    const groups = duplicateGroups([t({ id: '1' }), t({ id: '2', sec: 201.5 }), t({ id: '3', sec: 260 }), t({ id: '4', artist: 'B' })])
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([['1', '2']])
  })
  it('excludes PC and local track pairs from being counted as duplicates', () => {
    const groups = duplicateGroups([
      t({ id: 'local-1', title: 'Song', artist: 'A', sec: 200, source: 'local', path: 'D:/Music/Song.mp3' }),
      t({ id: 'pc-1', title: 'Song', artist: 'A', sec: 200, source: 'pc', path: 'pc:123' }),
    ])
    expect(groups).toEqual([])
  })
})

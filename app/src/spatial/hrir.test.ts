import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFloat32, parseHrirFile } from './hrir'
import { firResponse, resampleSet, roomResponse, speakerIndices, speakerMatchGains } from './stage'

const encode = (xs: number[]) => {
  const view = new DataView(new ArrayBuffer(xs.length * 4))
  xs.forEach((x, i) => view.setFloat32(i * 4, x, true))
  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}

describe('HRIR files', () => {
  it('decodes base64 little-endian Float32', () => {
    expect([...decodeFloat32(encode([1, -0.5, 0.25, 0]))]).toEqual([1, -0.5, 0.25, 0])
    // what Python writes for numpy.float32([1, -0.5]).tobytes()
    expect([...decodeFloat32('AACAPwAAAL8=')]).toEqual([1, -0.5])
  })
  it('turns a file into an HrirSet', () => {
    const set = parseHrirFile({ id: 'g', name: 'G', source: 'S, MIT', sampleRate: 48000, stepDeg: 5, ring: [{ l: encode([1, 0]), r: encode([0, 1]) }] })
    expect(set.ring[0].left[0]).toBe(1)
    expect(set.ring[0].right[1]).toBe(1)
    expect(set.stepDeg).toBe(5)
  })
  it('rejects an empty ring', () => {
    expect(() => parseHrirFile({ id: 'x', name: '', source: '', sampleRate: 48000, stepDeg: 5, ring: [] })).toThrow()
  })
})

describe('the bundled generic set', () => {
  const set = parseHrirFile(JSON.parse(readFileSync(new URL('../../public/data/hrir/generic.json', import.meta.url), 'utf-8')))
  it('is a full 5° ring at 48 kHz with a credits line', () => {
    expect(set.ring.length).toBe(72)
    expect(set.sampleRate).toBe(48000)
    expect(set.ring.every((p) => p.left.length <= 256 && p.right.length === p.left.length)).toBe(true)
    expect(set.source).toMatch(/^HUTUBS \(TU Berlin\), CC BY 4\.0/)
  })
  it('has the near ear first and louder for a source on the left', () => {
    const p = set.ring[18]
    const peak = (a: Float32Array) => a.reduce((m, v, i) => (Math.abs(v) > Math.abs(a[m]) ? i : m), 0)
    expect(peak(p.left)).toBeLessThan(peak(p.right))
    expect(Math.abs(p.left[peak(p.left)])).toBeGreaterThan(Math.abs(p.right[peak(p.right)]))
  })
  it('is diffuse-field equalised: the frontal speakers are roughly flat in the mids', () => {
    const [iL, iR] = speakerIndices(0, set.stepDeg, set.ring.length)
    const centre = set.ring[iL].left.map((v, i) => v + set.ring[iR].left[i])
    const db = (f: number) => 20 * Math.log10(Math.hypot(...firResponse(centre, f, set.sampleRate)))
    for (const f of [250, 500, 1000, 2000]) expect(Math.abs(db(f) - db(1000))).toBeLessThan(6)
  })
  it('level-matches speakers and room within a few dB, at 44.1 kHz too', () => {
    for (const fs of [48000, 44100]) {
      const s = resampleSet(set, fs)
      const g = speakerMatchGains(s, [roomResponse(s, 0), roomResponse(s, 1)])
      expect(Math.abs(20 * Math.log10(g.speakers))).toBeLessThan(6)
      expect(Math.abs(20 * Math.log10(g.room))).toBeLessThan(8)
    }
  })
})

describe('the HRTF picker candidates', () => {
  const dir = new URL('../../public/data/hrir/', import.meta.url)
  const index: { id: string; name: string; source: string; group?: string }[] = JSON.parse(readFileSync(new URL('index.json', dir), 'utf-8'))
  it('lists generic and 15 more HUTUBS sets in 4 groups of 4, each a full ring under 300 KB with its credits', () => {
    expect(index[0].id).toBe('generic')
    expect(index.length).toBe(16)
    const heads = new Set(index.map((e) => e.group))
    expect(heads.size).toBe(4)
    for (const h of heads) expect(index.filter((e) => e.group === h).length, h).toBe(4)
    expect(new Set(index.map((e) => e.id)).size).toBe(index.length)
    for (const e of index) {
      const file = new URL(`${e.id}.json`, dir)
      expect(statSync(file).size).toBeLessThan(300 * 1024)
      const set = parseHrirFile(JSON.parse(readFileSync(file, 'utf-8')))
      expect(set.id).toBe(e.id)
      expect(set.ring.length).toBe(72)
      expect(e.source).toMatch(/^HUTUBS \(TU Berlin\), CC BY 4\.0/)
    }
  })
})

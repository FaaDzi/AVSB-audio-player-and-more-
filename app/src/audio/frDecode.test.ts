import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeAllFr, decodeFr } from './data'

/** The decoder as it was before the shared buffer (plan §76 J), kept as the reference. */
function oldDecodeFr(packed: string): Int16Array {
  const steps = packed.startsWith('~')
  const bin = atob(steps ? packed.slice(1) : packed)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  if (!steps) return new Int16Array(bytes.buffer)
  const view = new DataView(bytes.buffer)
  const out = new Int16Array(bytes.length - 1)
  out[0] = view.getInt16(0, true)
  for (let i = 2; i < bytes.length; i++) out[i - 1] = out[i - 2] + view.getInt8(i)
  return out
}

describe('curves decoded into one shared buffer', () => {
  const file = JSON.parse(readFileSync(new URL('../../public/data/iems.json', import.meta.url), 'utf8')) as { iems: { fr: string }[] }
  const sample = file.iems.slice(0, 400)

  it('match the old one-buffer-per-curve decoder exactly', () => {
    const packed = sample.map((x) => x.fr)
    const items = sample.map((x) => ({ fr: x.fr as unknown }))
    decodeAllFr(items)
    items.forEach((it, i) => expect(Array.from(it.fr as Int16Array)).toEqual(Array.from(oldDecodeFr(packed[i]))))
    // and they really share one buffer
    expect(new Set(items.map((it) => (it.fr as Int16Array).buffer)).size).toBe(1)
  })

  it('handles both encodings, negative values included', () => {
    const plain = btoa(String.fromCharCode(0x18, 0xfc, 0x10, 0x00)) // int16 LE: -1000, 16
    expect(Array.from(decodeFr(plain))).toEqual([-1000, 16])
    const steps = '~' + btoa(String.fromCharCode(0x0a, 0x00, 0xfb, 0x07)) // 10, then -5, +7
    expect(Array.from(decodeFr(steps))).toEqual([10, 5, 12])
  })
})

import { describe, expect, it } from 'vitest'
import { atStrength, galleryTargets, startTarget } from './gallery'

const ie = [
  { name: 'Harman in-ear 2019', note: '', values: [0, 0, 0] },
  { name: 'JM-1', note: '', values: [1, 1, 1] },
]
// over-ear targets in their native shape; toNative = native(first hp target) − in-ear target
const hp = {
  targets: [
    { name: 'Harman over-ear 2018', note: '', values: [5, -5, 2] },
    { name: 'Diffuse field', note: '', values: [3, -5, 4] },
  ],
  toNative: Float64Array.from([5, -5, 2]),
}

describe('galleryTargets', () => {
  it('moves over-ear targets into the in-ear frame', () => {
    const list = galleryTargets({ targets: ie, headphones: hp })
    const oe = list.find((t) => t.name === 'Harman over-ear 2018')!
    expect(oe.kind).toBe('headphone')
    expect(oe.values).toEqual([0, 0, 0]) // the reference over-ear target = the in-ear target in that frame
    expect(list.find((t) => t.name === 'Diffuse field')!.values).toEqual([-2, 0, 2])
    expect(list.filter((t) => t.kind === 'iem').map((t) => t.name)).toEqual(['Harman in-ear 2019', 'JM-1'])
  })
  it('has only in-ear targets without headphone data', () => {
    expect(galleryTargets({ targets: ie, headphones: undefined }).every((t) => t.kind === 'iem')).toBe(true)
  })
})

describe('startTarget', () => {
  const list = galleryTargets({ targets: ie, headphones: hp })
  it('opens on Harman over-ear 2018 for headphones and Harman in-ear 2019 for IEMs', () => {
    expect(startTarget(list, 'headphone', null)).toBe('Harman over-ear 2018')
    expect(startTarget(list, 'iem', null)).toBe('Harman in-ear 2019')
  })
  it('remembers the last pick per kind, ignoring one of the other kind', () => {
    expect(startTarget(list, 'headphone', 'Diffuse field')).toBe('Diffuse field')
    expect(startTarget(list, 'headphone', 'JM-1')).toBe('Harman over-ear 2018')
  })
})

describe('atStrength', () => {
  it('scales the correction in dB', () => {
    const c = Float64Array.from([4, -6, 2])
    expect(Array.from(atStrength(c, 50))).toEqual([2, -3, 1])
    expect(Array.from(atStrength(c, 0))).toEqual([0, -0, 0])
    expect(atStrength(c, 100)).toBe(c)
  })
})

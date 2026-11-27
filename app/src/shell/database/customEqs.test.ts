import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { listModels, withCustomEqs } = await import('./catalog')
const { EQ_DEFAULT, presetFrom } = await import('../eqState')
type Database = import('./catalog').Database

const grid = Array.from({ length: 61 }, (_, i) => 20 * 1000 ** (i / 60))
const iem = { id: 'moondrop-chu', name: 'Moondrop Chu', source: 'x', sources: ['x'], fr: new Int16Array(grid.length), metrics: {} }
const hp = { ...iem, id: 'hp-sony-xm4', name: 'Sony WH-1000XM4' }
const model = (m: typeof iem, kind: string) => ({ id: m.id, name: m.name, kind, members: [m], sortName: m.name.toLowerCase(), usd: 30, score: 7, reviewCount: 2, photoId: m.id })
const db = {
  catalog: { data: { grid, frScale: 0.01, iems: [iem, hp] }, byId: new Map([[iem.id, iem], [hp.id, hp]]) },
  models: [model(iem, 'iems'), model(hp, 'headphones')],
} as unknown as Database

const eq = { ...EQ_DEFAULT, mode: 'advanced+' as const, filters: [{ kind: 'peak' as const, fc: 1000, gain: 6, q: 1 }] }
const all = { query: '', kinds: new Set(['iems', 'tws', 'headphones'] as const), reviewedOnly: false, sort: 'name' as const }

describe('your saved EQs in the Database (plan §85)', () => {
  it('a saved EQ with a device becomes an entry: the device plus the EQ, kept apart from the shared database', () => {
    const out = withCustomEqs(db, [presetFrom(eq, 'Vocal lift', hp.id), presetFrom(eq, 'No device'), presetFrom(eq, 'Gone', 'not-in-catalog')])
    const mine = out.models.filter((m) => m.custom)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ name: 'Vocal lift', kind: 'headphones', photoId: hp.id, custom: { preset: 'Vocal lift', baseId: hp.id, baseName: hp.name } })
    const curve = mine[0].members[0].fr
    const at1k = grid.findIndex((f) => f >= 1000)
    expect(curve[at1k] * 0.01).toBeCloseTo(6, 0)
    expect(Math.abs(curve[0] * 0.01)).toBeLessThan(0.5)
    expect(out.catalog.byId.has(mine[0].id)).toBe(true)
    // the shared copy is untouched: brackets and the sound engine never see custom entries
    expect(db.models).toHaveLength(2)
    expect(db.catalog.byId.size).toBe(2)
    expect(db.catalog.data.iems).toHaveLength(2)
  })

  it('found by its own name or its device name, and listed alone under Custom; deleted presets are simply not there', () => {
    const out = withCustomEqs(db, [presetFrom(eq, 'Vocal lift', hp.id)])
    expect(listModels(out.models, { ...all, query: 'vocal' }).map((m) => m.name)).toEqual(['Vocal lift'])
    expect(listModels(out.models, { ...all, query: 'xm4' }).map((m) => m.name).sort()).toEqual(['Sony WH-1000XM4', 'Vocal lift'])
    expect(listModels(out.models, { ...all, customOnly: true }).map((m) => m.name)).toEqual(['Vocal lift'])
    expect(withCustomEqs(db, [])).toBe(db)
  })

  it('a search keeps the chosen sort and the kind chips (§114 C)', () => {
    const a = { ...model({ ...iem, id: 'moondrop-aria', name: 'Moondrop Aria' }, 'iems'), usd: 80, score: 9 }
    const b = { ...model({ ...iem, id: 'moondrop-arias', name: 'Moondrop Arias Pro' }, 'iems'), usd: 20, score: 6 }
    const h = { ...model({ ...hp, id: 'hp-moondrop-para', name: 'Moondrop Para' }, 'headphones'), usd: 5 }
    const models = [b, a, h]
    expect(listModels(models, { ...all, query: 'moondrop', sort: 'price-asc' }).map((m) => m.id)).toEqual(['hp-moondrop-para', 'moondrop-arias', 'moondrop-aria'])
    expect(listModels(models, { ...all, query: 'moondrop', sort: 'score' }).map((m) => m.id)[0]).toBe('moondrop-aria')
    expect(listModels(models, { ...all, kinds: new Set(['iems'] as const), query: 'moondrop', sort: 'price-asc' }).map((m) => m.id)).toEqual(['moondrop-arias', 'moondrop-aria'])
    // Name: best match first, as before
    expect(listModels(models, { ...all, query: 'aria' }).map((m) => m.id)[0]).toBe('moondrop-aria')
  })

  it('a Basic preset carries its sound (it used to save none)', () => {
    const basic = { ...EQ_DEFAULT, mode: 'basic' as const, subMode: 'shaper' as const, shaper: { ...EQ_DEFAULT.shaper!, bassGain: 6 } }
    const mine = withCustomEqs(db, [presetFrom(basic, 'Bassy', iem.id)]).models.find((m) => m.custom)!
    expect(Math.max(...mine.members[0].fr) * 0.01).toBeGreaterThan(3)
  })
})

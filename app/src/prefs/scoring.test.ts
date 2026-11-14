import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeIemData, type IemData } from '../audio/data'
import type { Catalog } from '../data/catalog'
import { modelKey, priceOf } from '../data/catalog'
import { gradeValue, isAirline, isCiem, isModded, isPrototype, pickGameRoster, rankCandidates, targetProfile, tonalDistance } from './scoring'
import { DEFAULT_PREFS, type Preferences } from './types'

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf-8'))
const data: IemData = decodeIemData(read('iems.json'))
const catalog: Catalog = {
  data,
  byId: new Map(data.iems.map((i) => [i.id, i])),
  reviews: read('reviews.json'),
  images: read('images.json'),
  shopPrices: read('prices.json'),
}
const prefs = (p: Partial<Preferences>): Preferences => ({ ...DEFAULT_PREFS, ...p })

describe('target profile', () => {
  it('"too little bass" on the current IEM asks for more bass than it has', () => {
    const cur = data.iems.find((i) => i.name === 'Moondrop Blessing 3')!
    const t = targetProfile(prefs({ current: { ...DEFAULT_PREFS.current, bass: 'more' } }), cur)
    expect(t.subBass).toBeCloseTo(cur.metrics.subBass + 3, 5)
    expect(t.upperMids).toBeCloseTo(cur.metrics.upperMids, 5)
  })

  it('a perfect match has zero distance', () => {
    const cur = data.iems[0]
    expect(tonalDistance(cur, targetProfile(prefs({}), cur))).toBeCloseTo(0, 6)
  })
})

describe('grades', () => {
  it('parses split grades', () => {
    expect(gradeValue('A+/S-')).toBeCloseTo(8.75, 5)
    expect(gradeValue('S')).toBe(9.5)
    expect(gradeValue(null)).toBeNull()
  })
})

describe('rankCandidates', () => {
  const budget: [number, number] = [50, 300]
  const ranked = rankCandidates(catalog, prefs({ budget }))

  it('respects the budget and finds enough IEMs for a 16 bracket', () => {
    expect(ranked.length).toBeGreaterThanOrEqual(16)
    for (const s of ranked) expect(s.price! >= budget[0] && s.price! <= budget[1]).toBe(true)
  })

  it('keeps one variant per model', () => {
    const keys = ranked.map((s) => modelKey(s.iem.name))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('wanting much more bass moves bassier IEMs up', () => {
    const neutral = rankCandidates(catalog, prefs({ budget })).slice(0, 10)
    const bassy = rankCandidates(catalog, prefs({ budget, sliders: { bass: 2, mids: 0, treble: 0, air: 0 } })).slice(0, 10)
    const avg = (xs: typeof neutral) => xs.reduce((s, x) => s + x.iem.metrics.subBass, 0) / xs.length
    expect(avg(bassy)).toBeGreaterThan(avg(neutral) + 1)
  })

  it("prefers Jay's sheet price over shop prices", () => {
    const withBoth = Object.keys(catalog.shopPrices).find((id) => catalog.reviews!.reviews[id]?.some((r) => r.jay.priceUsd))
    expect(priceOf(catalog, withBoth!)!.source).toBe("Jay's sheet")
  })

  it('excludes airline earbuds, prototypes, CIEMs, and DIY mods by default', () => {
    const all = rankCandidates(catalog, prefs({ budget: [0, 5000], includeUnpriced: true }))
    for (const s of all) {
      expect(isAirline(s.iem)).toBe(false)
      expect(isPrototype(s.iem)).toBe(false)
      expect(isCiem(s.iem)).toBe(false)
      expect(isModded(s.iem)).toBe(false)
    }
  })

  it('allows prototypes, CIEMs, and DIY mods when toggled on', () => {
    const withSpecial = rankCandidates(
      catalog,
      prefs({
        budget: [0, 5000],
        includeUnpriced: true,
        includePrototypes: true,
        includeCiems: true,
        includeModded: true,
      }),
    )
    const hasProto = withSpecial.some((s) => isPrototype(s.iem))
    const hasCiem = withSpecial.some((s) => isCiem(s.iem))
    const hasMod = withSpecial.some((s) => isModded(s.iem))
    expect(hasProto).toBe(true)
    expect(hasCiem).toBe(true)
    expect(hasMod).toBe(true)
    // Airlines remain excluded even when all opt-in toggles are on
    expect(withSpecial.some((s) => isAirline(s.iem))).toBe(false)
  })

  it('treats headphone pad swaps as mods, stock pads as stock', () => {
    const hp = (name: string) => isModded({ id: 'hp-x', name })
    expect(hp('Focal Clear MG Pro (Clear MG Pro with Utopia pads)')).toBe(true)
    expect(hp('FiiO FT1 Pro pad-rolling (FT1 Pro with Fluxion ported pads)')).toBe(true)
    expect(hp('HiFiMAN HE6 (HE-6 with Serene stock pads)')).toBe(true)
    expect(hp('Sennheiser HD 560S (HD 560S (2025 sample, fresh stock pads, realistic seal))')).toBe(false)
    expect(hp('Verum 2 (2 with stock leather ported pads)')).toBe(false)
    expect(hp('Sennheiser HD 600')).toBe(false)
    expect(isModded({ id: 'iem-x', name: 'Some IEM with foam pads' })).toBe(false)
  })
})

describe('game roster', () => {
  it('a $150–400 band picks IEMs inside the band (one stretch pick may sit above it)', () => {
    const p = prefs({ budget: [150, 400], size: 8, currentId: null, includeCurrent: false })
    const { ids, roles } = pickGameRoster(catalog, p)
    expect(ids).toHaveLength(8)
    for (const id of ids) {
      const usd = priceOf(catalog, id)!.usd
      if (roles[id] === 'stretch') expect(usd).toBeGreaterThan(400)
      else expect(usd >= 150 && usd <= 400).toBe(true)
    }
  })
})

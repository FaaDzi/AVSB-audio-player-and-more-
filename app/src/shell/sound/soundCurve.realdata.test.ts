// The Sound module (§68) on real data: per-kind rules, accuracy of what you'd hear, strength, Best fit, open-back space.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFr, decodeIemData, type IemData } from '../../audio/data'
import type { RefData } from '../../audio/reference'
import { mergeCatalogs, type Catalog, type GraphTarget } from '../../data/catalog'
import { DEFAULT_FIT } from '../../fit/fit'
import { linearLatencyMs, soundCurve, SOUND_DEFAULT, targetsFor, type SoundEnv } from './soundCurve'

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../public/data/${f}`, import.meta.url), 'utf-8'))
const ie: IemData = decodeIemData(read('iems.json'))
const hp: IemData = decodeIemData(read('headphones.json'))
const targetFile = read('targets.json') as { targets: { name: string; note: string; fr: number[] }[]; headphoneTargets: { name: string; note: string; fr: number[] }[] }
const toTargets = (rows: { name: string; note: string; fr: number[] }[], data: IemData): GraphTarget[] => rows.map((t) => ({ name: t.name, note: t.note, values: t.fr.map((v) => v * data.frScale) }))
const base = (data: IemData, kind: 'iems' | 'headphones'): Catalog =>
  ({ kind, data, byId: new Map(data.iems.map((i) => [i.id, i])), reviews: null, images: {}, shopPrices: {}, squig: {}, targets: toTargets(targetFile.targets, data) }) as Catalog
const hpTargets = toTargets(targetFile.headphoneTargets, hp)
const hpCat = { ...base(hp, 'headphones'), headphones: { targets: hpTargets, toNative: Float64Array.from(hpTargets[0].values, (v, k) => v - hp.target.fr[k] * hp.frScale) } }
const catalog = mergeCatalogs(base(ie, 'iems'), hpCat as Catalog)
const refsRaw = read('refs.json') as RefData
for (const r of Object.values(refsRaw)) r.fr = decodeFr(r.fr)
const env: SoundEnv = { catalog, refs: refsRaw, fit: DEFAULT_FIT, airMode: 'auto' }
const grid = catalog.data.grid
const rmsTo = (a: ArrayLike<number>, b: ArrayLike<number>, lo: number, hi: number) => {
  const idx = grid.flatMap((f, i) => (f >= lo && f <= hi ? [i] : []))
  const mid = grid.flatMap((f, i) => (f >= 300 && f <= 3000 ? [i] : []))
  const off = mid.reduce((s, i) => s + a[i] - b[i], 0) / mid.length
  return Math.sqrt(idx.reduce((s, i) => s + (a[i] - b[i] - off) ** 2, 0) / idx.length)
}
const ODYSSEY = 'ziigaat-odyssey'
const HD600 = 'hp-sennheiser-hd-600-2020'
const HE600 = 'hp-hifiman-he600'

describe('Sound: per-kind rules', () => {
  it('offers only the device family\'s targets', () => {
    expect(targetsFor(catalog, ODYSSEY).every((t) => t.kind === 'iem')).toBe(true)
    expect(targetsFor(catalog, HD600).every((t) => t.kind === 'headphone')).toBe(true)
    expect(targetsFor(catalog, HD600).map((t) => t.name)).toContain('Harman over-ear 2018')
    expect(targetsFor(catalog, ODYSSEY).map((t) => t.name)).toContain('Harman in-ear 2019')
  })

  it('adds the open-back space only for an open-back aim heard on in-ears, and only when switched on', () => {
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: HD600 } }).space).toBe('open')
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: HD600 }, space: false }).space).toBe(null)
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: HE600, aim: { kind: 'device', id: HD600 } }).space).toBe(null)
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: 'moondrop-chu-2' } }).space).toBe(null)
  })

  it('says the linear-phase delay', () => {
    expect(linearLatencyMs(48000)).toBeCloseTo(42.7, 1)
    expect(linearLatencyMs(96000)).toBeCloseTo(21.3, 1)
  })
})

describe('Sound: accuracy', () => {
  for (const [device, aim, label] of [[HD600, HE600, 'HD 600 → HE600 (same kind)'], [ODYSSEY, 'moondrop-chu-2', 'Odyssey → Chu 2'], [ODYSSEY, HD600, 'Odyssey → HD 600 (cross kind)']] as const) {
    it(`${label}: heard ≈ aim`, () => {
      const r = soundCurve(env, { ...SOUND_DEFAULT, deviceId: device, aim: { kind: 'device', id: aim } })
      const heard = r.reference.map((v, i) => v + r.curve![i])
      const low = rmsTo(heard, r.aim!, 20, 6000)
      const treble = rmsTo(heard, r.aim!, 6000, 10000)
      console.log(`${label}: treble detail ${r.treble}; heard vs aim ${low.toFixed(2)} dB (20 Hz–6 kHz), ${treble.toFixed(2)} dB (6–10 kHz)`)
      expect(low).toBeLessThan(1)
      // same-kind pairs whose measurements agree keep full treble detail (the HD 600 / HiFiMan lesson)
      if (r.treble === 'full') expect(treble).toBeLessThan(1.5)
    })
  }

  it('HD 600 → HE600 keeps full treble detail', () => {
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: HD600, aim: { kind: 'device', id: HE600 } }).treble).toBe('full')
  })

  it('a target on the Odyssey lands on the target', () => {
    const r = soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'target', name: 'Harman in-ear 2019' } })
    expect(rmsTo(r.reference.map((v, i) => v + r.curve![i]), r.aim!, 20, 6000)).toBeLessThan(1)
  })

  it('Strength scales the correction, Best fit limits it', () => {
    const full = soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: HD600 } })
    const half = soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: HD600 }, strength: 50 })
    for (let i = 0; i < grid.length; i += 20) expect(half.curve![i]).toBeCloseTo(full.curve![i] / 2, 6)
    const best = soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY, aim: { kind: 'device', id: HD600 }, fit: 'best' })
    expect(best.best).not.toBeNull()
    expect(best.best!.afterDb).toBeLessThan(best.best!.beforeDb)
  })

  it('Off does nothing', () => {
    expect(soundCurve(env, { ...SOUND_DEFAULT, deviceId: ODYSSEY }).curve).toBeNull()
  })
})

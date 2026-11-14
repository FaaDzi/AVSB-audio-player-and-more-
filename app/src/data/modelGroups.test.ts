import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { modelKey, setFamilies, splitName } from './catalog'

const aliases = JSON.parse(readFileSync(new URL('../../public/data/aliases.json', import.meta.url), 'utf8')) as {
  merge: Record<string, string>
  families: Record<string, string>
}

beforeAll(() => setFamilies(aliases.families))

const sameModel = (a: string, b: string) => expect(modelKey(a)).toBe(modelKey(b))

describe('models that used to show twice', () => {
  it('group a model\'s configs under it', () => {
    sameModel('Fiio FD5', 'FIIO FD5 LARGE NOZZLE')
    sameModel('EPZ P50', 'EPZ P50 CLEAR')
    sameModel('Shanling ME800', 'Shanling ME800 Vocal')
    sameModel('NF Audio RA15', 'NF ACOUS RA15 (gold nozzle)')
    sameModel('7Hz Timeless 2', '7Hz Timeless 2 BIG GOLD NOZZLE')
    sameModel('TIN HiFi T6 Green', 'TinHiFi T6 Green Ring Clear')
    sameModel('Oppo Enco X2 (TWS)', 'OPPO Enco X2 EQ Punchy')
  })
  it('group spellings of one model', () => {
    sameModel('SIVGA M100', 'SIVGA SM100 (SIVGA SM100 Final E)')
    sameModel('Dunu DN242', 'DUNU 242 (DUNU 242 (Deep Fit))')
    sameModel('KBEAR KB16 Cepheus', 'KBEAR KB16 (Cepheus) (Cepheus (Zhulinniao Zhu Rythme tips))')
    sameModel('Tangzu Waner S.G 2 Amethyst Dragon', "Tangzu Wan'er SG 2 Jade Dragon")
  })
  it('keep the config name as the config', () => {
    expect(splitName('FIIO FD5 LARGE NOZZLE').variant).toBe('LARGE NOZZLE')
    expect(splitName('EPZ P50 CLEAR').variant).toBe('CLEAR')
  })
  it('leave separate products separate', () => {
    expect(modelKey('Letshuoer S12 ULTRA Clear')).not.toBe(modelKey('Letshuoer S12'))
    expect(modelKey('Simgot EW200 DSP')).not.toBe(modelKey('Simgot EW200'))
    expect(modelKey('KZ EDC Pro OFC Cable')).not.toBe(modelKey('KZ EDC'))
    expect(modelKey('Final E3000C')).not.toBe(modelKey('Final Audio E3000'))
  })
  it('merge rows that were the same thing under two names', () => {
    expect(aliases.merge['denon-d5200'] ?? aliases.merge['hp-denon-d5200']).toBeDefined()
  })
})

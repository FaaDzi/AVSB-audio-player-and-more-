import { describe, expect, it } from 'vitest'
import { checkSource, sourceFor } from './source'

describe('checkSource', () => {
  it('unknown when not set', () => {
    expect(checkSource({ outputOhm: null, iemOhm: null }).level).toBe('unknown')
  })

  it('low output impedance is fine', () => {
    expect(checkSource({ outputOhm: 0.5, iemOhm: null }).level).toBe('ok')
  })

  it('rule of eighths with a rated IEM impedance', () => {
    expect(checkSource({ outputOhm: 1, iemOhm: 32 }).level).toBe('ok') // 32:1
    expect(checkSource({ outputOhm: 5, iemOhm: 16 }).level).toBe('warn') // 3.2:1
    expect(checkSource({ outputOhm: 4, iemOhm: 40 }).level).toBe('caution') // passes 8:1 but 4 Ω is high for multi-BA dips
  })

  it('high output impedance without IEM info warns', () => {
    expect(checkSource({ outputOhm: 10, iemOhm: null }).level).toBe('warn')
    expect(checkSource({ outputOhm: 1.5, iemOhm: null }).level).toBe('caution')
  })
})

describe('sourceFor', () => {
  const dongle = { outputOhm: 1, iemOhm: 32, dacName: 'TP35 Pro', forOutput: 'Headphones (TP35 Pro) (3302:43e6)' }
  it('keeps the DAC on its own output', () => {
    expect(sourceFor(dongle, { label: dongle.forOutput, usb: '3302:43e6' }).dacName).toBe('TP35 Pro')
  })
  it('sets the DAC aside on another output, keeping the IEM', () => {
    const s = sourceFor(dongle, { label: 'Speakers (Realtek(R) Audio)', usb: null })
    expect(s.dacName).toBeUndefined()
    expect(s.outputOhm).toBeNull()
    expect(s.iemOhm).toBe(32)
  })
  it('older saves without an output count on USB outputs only', () => {
    const old = { outputOhm: 1, iemOhm: null, dacName: 'TP35 Pro' }
    expect(sourceFor(old, { label: 'x (3302:43e6)', usb: '3302:43e6' }).dacName).toBe('TP35 Pro')
    expect(sourceFor(old, { label: 'Speakers', usb: null }).dacName).toBeUndefined()
  })
})

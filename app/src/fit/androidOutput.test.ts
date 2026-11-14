import { describe, expect, it } from 'vitest'
import { classifyOutput, type DeviceTable } from './detect'
import { androidOutputDevice } from './system'

const table: DeviceTable = {
  dacs: [{ name: 'Test Dongle', match: ['\\btest dongle\\b'], usb: ['1234:abcd'], outputOhm: 0.3 }],
  btAdapters: [{ name: 'FiiO UTWS5', match: ['utws ?5'], kind: 'ear-hook', outputOhm: null }],
  dsps: [{ name: 'Chu II DSP', match: ['chu ii dsp'], usb: ['31b2:0113'], chip: 'x', app: 'Moondrop Link', iems: [], confirmed: true }],
}
const classify = (o: Parameters<typeof androidOutputDevice>[0]) => {
  const d = androidOutputDevice(o)
  return d && classifyOutput(d, table)
}

describe('Android output → the Windows-style classifier', () => {
  it('finds a DSP cable by its USB id whatever Android names it', () => {
    expect(classify({ type: 'usb', name: 'USB-Audio - Generic', usb: '31b2:0113' })).toMatchObject({ kind: 'dsp' })
  })
  it('finds a DAC by USB id', () => {
    expect(classify({ type: 'usb', name: 'whatever', usb: '1234:abcd' })).toMatchObject({ kind: 'dac', outputOhm: 0.3 })
  })
  it('Bluetooth buds are Bluetooth even under an unknown name', () => {
    expect(classify({ type: 'bluetooth', name: 'Galaxy Buds2 Pro' })).toMatchObject({ kind: 'bluetooth', label: 'Galaxy Buds2 Pro (Bluetooth)' })
    expect(classify({ type: 'bluetooth', name: 'My Headset' })).toMatchObject({ kind: 'bluetooth' })
  })
  it('a Bluetooth IEM adapter is the adapter', () => {
    expect(classify({ type: 'bluetooth', name: 'FiiO UTWS5' })).toMatchObject({ kind: 'bt-adapter' })
  })
  it('nothing known: no device', () => {
    expect(androidOutputDevice({})).toBeNull()
  })
})

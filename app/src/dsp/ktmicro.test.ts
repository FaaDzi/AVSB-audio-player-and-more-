import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeBand, isSupported, KtMicroDsp } from './ktmicro'
import type { DspTransport } from './transport'

/** USB capture of a real Moondrop Chu II DSP, from devicePEQ (0BSD): its registers' replies. */
const capture = JSON.parse(readFileSync(new URL('./fixtures/ktmicro_chu2_dsp.json', import.meta.url), 'utf-8')) as {
  device: { vendorId: number; productId: number; productName: string }
  exchanges: { send: { reportId: number; data: number[] }; responses: { reportId: number; data: number[] }[] }[]
}

/** A cable whose registers start as captured and keep what's written; reads answer like the device. */
function fakeCable() {
  const regs = new Map<number, number[]>()
  for (const ex of capture.exchanges) if (ex.send.data[4] === 0x52 && ex.responses[0]) regs.set(ex.send.data[0], ex.responses[0].data.slice(6, 10))
  const sent: number[][] = []
  const subs = new Set<(id: number, d: Uint8Array) => void>()
  const t: DspTransport = {
    ...capture.device,
    async send(reportId, data) {
      expect(reportId).toBe(0x4b)
      expect(data.length).toBe(10)
      sent.push(Array.from(data))
      const [reg, , , , cmd] = data
      if (cmd === 0x57) regs.set(reg, Array.from(data.slice(6, 10)))
      if (cmd === 0x52 && regs.has(reg)) {
        const reply = Uint8Array.from([reg, 0, 0, 0, 0x52, 0, ...regs.get(reg)!])
        queueMicrotask(() => subs.forEach((cb) => cb(0x4b, reply)))
      }
    },
    onReport: (cb) => (subs.add(cb), () => void subs.delete(cb)),
    close: async () => {},
  }
  return { t, regs, sent }
}

describe('KT Micro DSP bypass (Chu II DSP capture)', () => {
  it('recognises the Chu II DSP', () => {
    expect(isSupported(capture.device)).toBe(true)
    expect(isSupported({ vendorId: 0x31b2, productName: 'Some Other Dongle' })).toBe(false)
  })

  it('reads 5 bands within the cable limits', async () => {
    const dsp = new KtMicroDsp(fakeCable().t, 50)
    const b = await dsp.backup()
    expect(b.bands).toHaveLength(5)
    for (const band of b.bands.map(decodeBand)) {
      expect(Math.abs(band.gainDb)).toBeLessThanOrEqual(12)
      expect(band.q).toBeGreaterThan(0)
    }
  })

  it('flatten sets every gain to 0 dB, keeps frequencies, and commits', async () => {
    const cable = fakeCable()
    const dsp = new KtMicroDsp(cable.t, 50)
    const before = await dsp.backup()
    // make it non-flat first, as after an accidental AutoEQ
    await dsp.restore({ ...before, bands: before.bands.map((b) => ({ ...b, gainFreq: [0xc4, 0xff, b.gainFreq[2], b.gainFreq[3]] })) })
    expect(await dsp.isFlat()).toBe(false)
    const eqd = await dsp.backup()
    await dsp.flatten(eqd)
    expect(await dsp.isFlat()).toBe(true)
    const after = await dsp.readBands()
    after.forEach((b, i) => expect(b.gainFreq.slice(2)).toEqual(eqd.bands[i].gainFreq.slice(2)))
    expect(cable.sent.some((p) => p[4] === 0x53)).toBe(true)
  })

  it('restore puts back the exact bytes it read', async () => {
    const cable = fakeCable()
    const dsp = new KtMicroDsp(cable.t, 50)
    const orig = await dsp.backup()
    await dsp.flatten(orig)
    await dsp.restore(orig)
    expect(await dsp.readBands()).toEqual(orig.bands)
  })

  it("won't restore another model's backup", async () => {
    const dsp = new KtMicroDsp(fakeCable().t, 50)
    const b = await dsp.backup()
    await expect(dsp.restore({ ...b, product: 'TANCHJIM-ONE DSP' })).rejects.toThrow(/TANCHJIM One DSP/)
  })
})

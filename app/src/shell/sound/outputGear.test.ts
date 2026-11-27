import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
const { decideForOutput, looksLikeSpeakers, outputKey } = await import('./outputGear')

describe('the PC device follows the Windows output (§119)', () => {
  it('speaker-like outputs, not ear gear or DACs', () => {
    for (const l of ['Speakers (NVIDIA High Definition Audio)', 'Realtek Digital Output (Realtek(R) Audio)', 'LG HDR 4K (NVIDIA High Definition Audio)', 'Speakers (Realtek(R) Audio)', 'Intel SST Audio Device', 'DELL U2720Q (Intel(R) Display Audio)'])
      expect(looksLikeSpeakers(l), l).toBe(true)
    for (const l of ['Headphones (Moondrop Dawn Pro)', 'Speakers (USB Audio DAC)', 'Headset Earphone (Galaxy Buds2)', 'Speakers (Apple USB-C to 3.5mm Headphone Jack Adapter)'])
      expect(looksLikeSpeakers(l), l).toBe(false)
  })

  it('a remembered output brings its device back; a speaker-like new one offers your speakers once', () => {
    const map = { [outputKey('Speakers (Dawn Pro)')]: 'moondrop-chu' }
    expect(decideForOutput('Speakers (Dawn Pro)', map, ['moondrop-chu', 'spk-kef-lsx'], 'spk-kef-lsx')).toEqual({ kind: 'switch', id: 'moondrop-chu' })
    expect(decideForOutput('Speakers (NVIDIA High Definition Audio)', {}, ['moondrop-chu', 'spk-kef-lsx'], 'moondrop-chu')).toEqual({ kind: 'offer', id: 'spk-kef-lsx' })
    expect(decideForOutput('Speakers (USB Audio DAC)', {}, ['moondrop-chu', 'spk-kef-lsx'], 'moondrop-chu')).toEqual({ kind: 'stay', id: 'moondrop-chu' })
    expect(outputKey('Default - Speakers (2- Dawn Pro)')).toBe(outputKey('Speakers (Dawn Pro)'))
  })
})

import { describe as group, expect, it } from 'vitest'
import { classifyOutput, type DeviceTable } from './detect'

const table: DeviceTable = {
  dacs: [
    { name: 'Test Dongle', match: ['\\btest dongle\\b'], usb: ['1234:abcd'], outputOhm: 0.3, source: 'x' },
    { name: 'Mystery DAC', match: ['mystery dac'], usb: [], outputOhm: null },
  ],
  btAdapters: [{ name: 'FiiO UTWS5', match: ['utws ?5'], kind: 'ear-hook', outputOhm: null }],
}
const dev = (label: string) => {
  const usb = label.match(/\(([0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i)?.[1].toLowerCase() ?? null
  return { id: 'x', label, usb }
}

group('classifyOutput', () => {
  it('matches a known dongle by USB id even with an odd name', () => {
    expect(classifyOutput(dev('Headphones (Something) (1234:abcd)'), table)).toMatchObject({ kind: 'dac', outputOhm: 0.3 })
  })
  it('matches by name', () => {
    expect(classifyOutput(dev('Headphones (Mystery DAC)'), table)).toMatchObject({ kind: 'dac', outputOhm: null })
  })
  it('an ambiguous name with disagreeing impedances gives no number', () => {
    const t: DeviceTable = { dacs: [
      { name: 'Apple adapter', match: ['usb-c to 3.5mm headphone jack adapter'], usb: ['05ac:110a'], outputOhm: 0.9 },
      { name: 'Google adapter', match: ['usb-c to 3.5mm headphone jack adapter'], usb: ['18d1:5034'], outputOhm: 7 },
    ], btAdapters: [] }
    expect(classifyOutput(dev('Headphones (USB-C to 3.5mm Headphone Jack Adapter)'), t)).toMatchObject({ kind: 'dac', outputOhm: null, name: 'Apple adapter or Google adapter' })
    expect(classifyOutput(dev('Headphones (USB-C to 3.5mm Headphone Jack Adapter) (18d1:5034)'), t)).toMatchObject({ outputOhm: 7 })
  })

  it('passes a Bluetooth IEM adapter', () => {
    expect(classifyOutput(dev('Headphones (FiiO UTWS5 Stereo)'), table).kind).toBe('bt-adapter')
  })
  it('unknown USB audio, built-in jack, speakers', () => {
    expect(classifyOutput(dev('Headphones (TP35 Pro) (3302:43e6)'), table).kind).toBe('usb-unknown')
    expect(classifyOutput(dev('Headphones (Realtek(R) Audio)'), table).kind).toBe('builtin-jack')
    expect(classifyOutput(dev('Speakers (Realtek(R) Audio)'), table).kind).toBe('speakers')
    expect(classifyOutput(dev('R25i-30 (NVIDIA High Definition Audio)'), table).kind).toBe('speakers')
  })
})

group('the real device list (public/data/devices.json)', async () => {
  const { readFileSync } = await import('node:fs')
  const real: DeviceTable = JSON.parse(readFileSync(new URL('../../public/data/devices.json', import.meta.url), 'utf-8'))
  const name = (label: string) => {
    const d = classifyOutput(dev(label), real)
    return d.kind === 'dsp' ? `dsp:${d.entry.name}` : d.kind === 'dac' ? `dac:${d.name}` : d.kind
  }

  it('DSP cables and DSP IEMs are recognised by the name Windows shows', () => {
    expect(name('Headphones (Chu2 DSP) (31b2:0113)')).toBe('dsp:Moondrop Chu II DSP cable')
    expect(name('Headphones (Chu2 DSP)')).toBe('dsp:Moondrop Chu II DSP cable')
    expect(name('Headphones (CDSP)')).toBe('dsp:Moondrop CDSP')
    expect(name('Headphones (FreeDSP)')).toBe('dsp:Moondrop FreeDSP')
    expect(name('Headphones (FreeDSP Pro)')).toBe('dsp:Moondrop FreeDSP Pro')
    expect(name('Headphones (FreeDSP Mini)')).toBe('dsp:Moondrop FreeDSP Mini')
    expect(name('Headphones (Rays)')).toBe('dsp:Moondrop Rays')
    expect(name('Headphones (TANCHJIM-ONE DSP)')).toBe('dsp:TANCHJIM One DSP cable')
    expect(name('Headphones (TANCHJIM-FISSION  DSP)')).toBe('dsp:TANCHJIM DSP plug (Fission)')
  })

  it("a DSP cable isn't mistaken for a same-brand dongle, and dongles stay dongles", () => {
    expect(name('Headphones (TANCHJIM-SPACE PRO)')).toBe('dac:Tanchjim Space / Space Lite / Space II')
    expect(name('Headphones (TANCHJIM-STARGATE II)')).toBe('dac:TANCHJIM Stargate II')
    expect(name('Headphones (Protocol Max)')).toBe('dac:CrinEar Protocol Max')
    expect(name('Headphones (MOONRIVER 3)')).toBe('dac:Moondrop Moonriver 3')
    expect(name('Headphones (Moonriver 2 Ti)')).toBe('dac:Moondrop Moonriver 2 / 2 Ti')
  })

  // §101: Android gives the bare USB product name (androidOutputDevice), not "Headphones (…)"
  it('finds devices by the bare name Android gives', () => {
    const android = (label: string, usb: string | null = null) => {
      const d = classifyOutput({ id: 'android', label, usb }, real)
      return d.kind === 'dsp' ? `dsp:${d.entry.name}` : d.kind === 'dac' ? `dac:${d.name}` : d.kind
    }
    // the owner's JCally JM12 on a Xiaomi 14, as `dumpsys usb` shows it
    expect(android('KT02H20 HIFI Audio', '31b2:0111')).toBe('dsp:KT02H20 dongle (JCally JM12 and others)')
    expect(android('KT02H20 HIFI Audio')).toBe('dsp:KT02H20 dongle (JCally JM12 and others)')
    expect(android('Chu2 DSP')).toBe('dsp:Moondrop Chu II DSP cable')
    expect(android('CDSP')).toBe('dsp:Moondrop CDSP')
    expect(android('Rays')).toBe('dsp:Moondrop Rays')
    expect(android('Octave')).toBe('dac:NiceHCK Octave')
    expect(android('Shanling UA4')).toBe('dac:Shanling UA4')
    expect(android('Questyle M18i')).toBe('dac:Questyle M18i')
  })

  it('no pattern carries a control character (a heredoc once turned \\b into a backspace)', () => {
    for (const d of [...real.dacs, ...real.btAdapters, ...(real.dsps ?? [])]) for (const m of d.match) expect(m).not.toMatch(/[\u0000-\u001f]/)
  })
})

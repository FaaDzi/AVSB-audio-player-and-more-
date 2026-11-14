/**
 * Bypass and restore the EQ inside KT Micro DSP cables and dongles (Moondrop Chu II DSP,
 * TANCHJIM One / Fission / Bunny DSP, Kiwi Ears Allegro…), so a test hears the IEM's stock
 * tuning rather than whatever the maker's app left in the cable.
 *
 * Protocol from devicePEQ (github.com/jeromeof/devicePEQ, 0BSD): 10-byte HID reports with
 * report ID 0x4B, "<register> 00 00 00 <command> 00 <payload…>". Band i lives in registers
 * 0x26 + 2i (gain ×10 signed, frequency) and 0x27 + 2i (Q ×1000, filter type). Reads are
 * answered with the same header; writes aren't acknowledged; 0x53 commits them.
 *
 * Everything here works on the registers' raw bytes, so a restore puts back exactly what
 * was read, whatever scaling a given model uses for frequency.
 */
import type { DspTransport } from './transport'

export const KT_MICRO_VENDOR = 0x31b2
const REPORT_ID = 0x4b
const READ = 0x52
const WRITE = 0x57
const COMMIT = 0x53
const SLOT_REG = 0x24
const PREGAIN_REG = 0x66
const FIRST_BAND_REG = 0x26
const BANDS = 5

/** Models whose 5 bands sit at 0x26… in order (product names as the USB descriptor reports them). */
export const KT_MICRO_MODELS: Record<string, string> = {
  'Chu2 DSP': 'Moondrop Chu II DSP',
  'TANCHJIM-ONE DSP': 'TANCHJIM One DSP',
  'TANCHJIM FISSION': 'TANCHJIM Fission DSP',
  'TANCHJIM-FISSION  DSP': 'TANCHJIM Fission DSP',
  'TANCHJIM BUNNY DSP': 'TANCHJIM Bunny DSP',
  'Kiwi Ears-Allegro PRO': 'Kiwi Ears Allegro Pro',
  'Kiwi Ears-Allegro Mini': 'Kiwi Ears Allegro Mini',
  'KT02H20 HIFI Audio': 'KT02H20 dongle',
}
/** Older chips store half the frequency (devicePEQ's compensate2X); only matters for showing it. */
const FREQ_X2 = new Set(['KT02H20 HIFI Audio'])
export const displayHz = (product: string, rawFreq: number) => (FREQ_X2.has(product) ? rawFreq * 2 : rawFreq)

/** One band's two registers, as read: bytes 6-9 of each reply. */
export interface RawBand {
  gainFreq: number[]
  qType: number[]
}

/** What the cable held before a bypass, to put back byte for byte. */
export interface DspBackup {
  product: string
  slot: number | null
  pregain: number | null
  bands: RawBand[]
  savedAt: string
}

/** A band in readable units (for showing what the cable is doing). */
export interface Band {
  gainDb: number
  rawFreq: number
  q: number
  type: 'peak' | 'low shelf' | 'high shelf'
}

export function decodeBand(b: RawBand): Band {
  const g = b.gainFreq[0] | (b.gainFreq[1] << 8)
  const type = b.qType[2] === 3 ? 'low shelf' : b.qType[2] === 4 ? 'high shelf' : 'peak'
  return {
    gainDb: (g > 0x7fff ? g - 0x10000 : g) / 10,
    rawFreq: b.gainFreq[2] | (b.gainFreq[3] << 8),
    q: (b.qType[0] | (b.qType[1] << 8)) / 1000,
    type,
  }
}

export const isSupported = (t: Pick<DspTransport, 'vendorId' | 'productName'>) =>
  t.vendorId === KT_MICRO_VENDOR && t.productName in KT_MICRO_MODELS

const packet = (reg: number, cmd: number, payload: number[] = []) => {
  const p = new Uint8Array(10)
  p[0] = reg
  p[4] = cmd
  payload.forEach((v, i) => (p[6 + i] = v))
  return p
}

export class KtMicroDsp {
  private t: DspTransport
  private timeoutMs: number
  constructor(t: DspTransport, timeoutMs = 1000) {
    this.t = t
    this.timeoutMs = timeoutMs
  }

  get name() {
    return KT_MICRO_MODELS[this.t.productName] ?? this.t.productName
  }

  /** Send a read and wait for the reply with the same register and command; its payload bytes. */
  private async read(reg: number): Promise<number[]> {
    const reply = new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`no reply from register 0x${reg.toString(16)}`))
      }, this.timeoutMs)
      const off = this.t.onReport((id, data) => {
        if (id !== REPORT_ID || data[0] !== reg || data[4] !== READ) return
        clearTimeout(timer)
        off()
        resolve(Array.from(data.slice(6, 10)))
      })
    })
    await this.t.send(REPORT_ID, packet(reg, READ, reg === SLOT_REG ? [0x03] : []))
    return reply
  }

  private write(reg: number, payload: number[]) {
    return this.t.send(REPORT_ID, packet(reg, WRITE, payload))
  }

  /** A register some models don't have: null instead of an error. */
  private async tryRead(reg: number): Promise<number[] | null> {
    try {
      return await this.read(reg)
    } catch {
      return null
    }
  }

  async readBands(): Promise<RawBand[]> {
    const bands: RawBand[] = []
    for (let i = 0; i < BANDS; i++) {
      bands.push({ gainFreq: await this.read(FIRST_BAND_REG + 2 * i), qType: await this.read(FIRST_BAND_REG + 2 * i + 1) })
    }
    return bands
  }

  async backup(): Promise<DspBackup> {
    const slot = await this.tryRead(SLOT_REG)
    const pregain = await this.tryRead(PREGAIN_REG)
    return {
      product: this.t.productName,
      slot: slot ? slot[0] : null,
      pregain: pregain ? pregain[0] : null,
      bands: await this.readBands(),
      savedAt: new Date().toISOString(),
    }
  }

  /** Every band to 0 dB (frequency, Q and type kept), pre-gain to 0, then commit: the maker app's Reset. */
  async flatten(from: DspBackup) {
    for (let i = 0; i < from.bands.length; i++) {
      const [, , f0, f1] = from.bands[i].gainFreq
      await this.write(FIRST_BAND_REG + 2 * i, [0, 0, f0, f1])
    }
    if (from.pregain !== null && from.pregain !== 0) await this.write(PREGAIN_REG, [0])
    await this.t.send(REPORT_ID, packet(0, COMMIT))
  }

  /** Put back exactly what `backup` read. */
  async restore(b: DspBackup) {
    if (b.product !== this.t.productName) throw new Error(`that backup is from a ${KT_MICRO_MODELS[b.product] ?? b.product}`)
    for (let i = 0; i < b.bands.length; i++) {
      await this.write(FIRST_BAND_REG + 2 * i, b.bands[i].gainFreq)
      await this.write(FIRST_BAND_REG + 2 * i + 1, b.bands[i].qType)
    }
    if (b.pregain !== null) await this.write(PREGAIN_REG, [b.pregain])
    await this.t.send(REPORT_ID, packet(0, COMMIT))
    if (b.slot !== null) await this.write(SLOT_REG, [b.slot])
  }

  /** True when every band reads back at 0 dB. */
  async isFlat(): Promise<boolean> {
    return (await this.readBands()).every((b) => decodeBand(b).gainDb === 0)
  }
}

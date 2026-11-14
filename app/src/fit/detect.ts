import type { OutputDevice } from './system'
import { isBluetoothLabel, isHandsFreeLabel } from '../audio/wireless'

export interface DacEntry {
  name: string
  match: string[]
  usb: string[]
  outputOhm: number | null
  source?: string | null
  note?: string
  /** A shop photo (scripts/build_dac_photos.py), app-relative. */
  photo?: string
}

export interface BtAdapterEntry {
  name: string
  match: string[]
  kind: string
  outputOhm: number | null
  source?: string | null
}

/** A DSP cable, plug or USB-C IEM: it holds its own EQ, which plays after this app. */
export interface DspEntry {
  name: string
  match: string[]
  usb: string[]
  chip: string
  /** Where its EQ is set (and reset); empty when it can't be changed. */
  app: string
  /** The IEMs it comes with, or how it's sold. */
  iems: string[]
  /** Its USB product name was seen in devicePEQ's device list (else the pattern is a guess). */
  confirmed: boolean
  note?: string
  source?: string
}

export interface DeviceTable {
  dacs: DacEntry[]
  btAdapters: BtAdapterEntry[]
  dsps?: DspEntry[]
}

export type Detected =
  | { kind: 'dac'; name: string; outputOhm: number | null; source: string | null }
  | { kind: 'dsp'; entry: DspEntry }
  | { kind: 'bt-adapter'; name: string; outputOhm: number | null }
  | { kind: 'usb-unknown'; label: string }
  | { kind: 'builtin-jack'; label: string }
  | { kind: 'speakers'; label: string }
  /** Bluetooth earbuds or headphones (not an IEM adapter), in their stereo listening mode. */
  | { kind: 'bluetooth'; label: string }
  /** A Bluetooth headset in its mono call mode (Windows "Hands-Free"): useless for listening tests. */
  | { kind: 'bt-handsfree'; label: string }
  | { kind: 'other'; label: string }

const matches = (patterns: string[], label: string) =>
  patterns.some((p) => {
    try {
      return new RegExp(p, 'i').test(label)
    } catch {
      return false
    }
  })

/** What the current output is, as far as the app can tell from its Windows name. */
export function classifyOutput(dev: OutputDevice, table: DeviceTable): Detected {
  const label = dev.label
  // DSP cables first: some share a brand word with a DAC entry ("TANCHJIM-ONE DSP" vs Tanchjim Space)
  const dsps = table.dsps ?? []
  const dsp = (dev.usb && dsps.find((d) => d.usb.map((u) => u.toLowerCase()).includes(dev.usb!))) || dsps.find((d) => matches(d.match, label))
  if (dsp) return { kind: 'dsp', entry: dsp }
  if (dev.usb) {
    const byId = table.dacs.find((d) => d.usb.map((u) => u.toLowerCase()).includes(dev.usb!))
    if (byId) return { kind: 'dac', name: byId.name, outputOhm: byId.outputOhm, source: byId.source ?? null }
  }
  const byName = table.dacs.filter((d) => matches(d.match, label))
  if (byName.length) {
    // the same Windows name can belong to different devices (e.g. Apple's and Google's USB-C adapters);
    // if their impedances disagree, name them all and leave the value unknown rather than pick one
    const ohms = new Set(byName.map((d) => d.outputOhm))
    if (byName.length > 1 && ohms.size > 1) {
      return { kind: 'dac', name: byName.map((d) => d.name).join(' or '), outputOhm: null, source: null }
    }
    return { kind: 'dac', name: byName[0].name, outputOhm: byName[0].outputOhm, source: byName[0].source ?? null }
  }
  const bt = table.btAdapters.find((d) => matches(d.match, label))
  if (bt) return { kind: 'bt-adapter', name: bt.name, outputOhm: bt.outputOhm }
  if (dev.usb) return { kind: 'usb-unknown', label }
  if (isHandsFreeLabel(label)) return { kind: 'bt-handsfree', label }
  if (isBluetoothLabel(label)) return { kind: 'bluetooth', label }
  if (/^speakers?\b|\bspeakers?\s*\(|hdmi|nvidia high definition|amd high definition|display audio|monitor/i.test(label)) {
    return { kind: 'speakers', label }
  }
  if (/realtek|high definition audio|conexant|cirrus|\bsst\b|smart sound/i.test(label)) return { kind: 'builtin-jack', label }
  return { kind: 'other', label }
}

export async function loadDeviceTable(): Promise<DeviceTable> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/devices.json`)
    return r.ok ? await r.json() : { dacs: [], btAdapters: [] }
  } catch {
    return { dacs: [], btAdapters: [] }
  }
}

/** One-line explanation for the UI. */
export function describe(d: Detected): { level: 'ok' | 'caution' | 'warn' | 'info'; text: string } {
  switch (d.kind) {
    case 'dac':
      return d.outputOhm !== null
        ? { level: d.outputOhm <= 1 ? 'ok' : d.outputOhm <= 2 ? 'caution' : 'warn', text: `${d.name}: ${d.outputOhm} Ω output impedance (from its specs).` }
        : { level: 'info', text: `${d.name} detected; its output impedance isn't published, so it's assumed low (most dongles are under 1 Ω).` }
    case 'dsp':
      return {
        level: 'caution',
        text: d.entry.app
          ? `${d.entry.name}: a DSP cable with its own EQ, which plays on top of this app. Reset it to flat in ${d.entry.app} before testing.`
          : `${d.entry.name}: its tuning is built into the cable's DSP and can't be switched off, so tests include it.`,
      }
    case 'bt-adapter':
      return { level: 'ok', text: `${d.name} (Bluetooth IEM adapter) detected: your wired IEMs are the speakers, so IEM mode is right. The Bluetooth codec adds a little colour of its own.` }
    case 'usb-unknown':
      return { level: 'info', text: `USB audio device "${d.label}" isn't in the app's list. Most USB dongles are under 1 Ω; enter its spec below if you know it.` }
    case 'builtin-jack':
      return { level: 'caution', text: `Built-in headphone jack ("${d.label}"). Laptop and PC jacks vary a lot (often 1–10 Ω and sometimes noisy); a USB dongle is more reliable.` }
    case 'bluetooth':
      return { level: 'caution', text: `"${d.label}" looks like Bluetooth earbuds or headphones. That works: pick your exact model as the IEM in your ears, turn off its own EQ / sound modes and spatial audio, and expect the codec to soften fine detail a little.` }
    case 'bt-handsfree':
      return { level: 'warn', text: `"${d.label}" is a Bluetooth headset in call mode (Hands-Free): mono and low quality. Switch Windows' output to the "Headphones … Stereo" entry for the same device before testing.` }
    case 'speakers':
      return { level: 'info', text: `"${d.label}" looks like speakers or a monitor. Switch to speaker mode, or plug in your IEM.` }
    default:
      return { level: 'info', text: `Output: "${d.label}".` }
  }
}

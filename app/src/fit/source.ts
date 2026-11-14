/**
 * Source (DAC / dongle / jack) output impedance check.
 *
 * IEM graphs are measured from a near-0 Ω source. A higher output impedance forms a
 * voltage divider with the IEM's impedance, and multi-driver BA/hybrid IEMs have an
 * impedance that changes a lot with frequency, so their sound shifts. Without each IEM's
 * impedance curve the app can't correct this, so it only warns.
 */
export interface SourceSettings {
  /** Output impedance of the DAC / dongle / headphone jack in ohms; null = not set. */
  outputOhm: number | null
  /** Rated (nominal) impedance of the user's IEM in ohms; null = unknown. */
  iemOhm: number | null
  /** Name of the auto-detected device the output impedance came from; absent = typed in by the user. */
  auto?: string
  /** The DAC / dongle picked by name in Settings (devices.json); absent = a range or a typed value. */
  dacName?: string
  /** Label of the output the DAC belongs to; another output means no DAC. Absent (older saves) = any USB output. */
  forOutput?: string
}

export const DEFAULT_SOURCE: SourceSettings = { outputOhm: null, iemOhm: null }

/** The saved source as it applies to the output playing now: a DAC saved for another output doesn't count. */
export function sourceFor(s: SourceSettings, out: { label: string; usb: string | null } | null): SourceSettings {
  if (!out || !s.dacName) return s
  const mine = s.forOutput ? s.forOutput === out.label : Boolean(out.usb)
  return mine ? s : { ...DEFAULT_SOURCE, iemOhm: s.iemOhm }
}

/** Ranges for a source you can't name: label, value used, what typically has it. */
export const OUTPUT_PRESETS: [string, number, string][] = [
  ['< 1 Ω', 0.5, 'Most current dongles and DAPs'],
  ['1–2 Ω', 1.5, 'Some older dongles, many phones'],
  ['~5 Ω', 5, 'Some phone and tablet jacks'],
  ['10 Ω+', 10, 'Some laptop and PC jacks'],
]

export interface SourceCheck {
  level: 'ok' | 'caution' | 'warn' | 'unknown'
  text: string
}

export function checkSource(s: SourceSettings): SourceCheck {
  const z = s.outputOhm
  if (z === null && s.dacName) {
    return { level: 'unknown', text: `${s.dacName}: its output impedance isn't published. Most dongles are under 1 Ω, which is fine.` }
  }
  if (z === null || !Number.isFinite(z) || z < 0) {
    return { level: 'unknown', text: 'Source not set. Most modern dongles and DAPs are under 1 Ω, which is fine.' }
  }
  if (s.iemOhm && s.iemOhm > 0) {
    const ratio = s.iemOhm / Math.max(z, 0.01)
    if (ratio >= 8 && z <= 2) {
      return { level: 'ok', text: `${z} Ω into a ${s.iemOhm} Ω IEM passes the rule of eighths (ratio ${ratio.toFixed(0)}:1). The graphs should hold.` }
    }
    if (ratio >= 8) {
      return {
        level: 'caution',
        text: `${z} Ω into a ${s.iemOhm} Ω IEM passes the rule of eighths on the rated impedance, but multi-driver IEMs can dip far below their rating in parts of the range. Their sound may still shift a little.`,
      }
    }
    return {
      level: 'warn',
      text: `${z} Ω into a ${s.iemOhm} Ω IEM fails the rule of eighths (ratio ${ratio.toFixed(1)}:1, should be 8:1 or more). Your IEM probably sounds different from its graph (often bass or treble shifts), so the simulation will be off. A low-impedance dongle fixes this.`,
    }
  }
  if (z <= 1) return { level: 'ok', text: `${z} Ω is low enough for practically any IEM. The graphs should hold.` }
  if (z <= 2) {
    return { level: 'caution', text: `${z} Ω is fine for single dynamic-driver IEMs. Some low-impedance multi-BA IEMs may shift slightly.` }
  }
  return {
    level: 'warn',
    text: `${z} Ω can change the sound of multi-driver (BA / hybrid) IEMs noticeably compared with their graphs, so the simulation may be off. Single dynamic-driver IEMs are usually fine. Enter your IEM's impedance for a precise check.`,
  }
}

const KEY = 'source-v1'

export function loadSource(): SourceSettings {
  try {
    return { ...DEFAULT_SOURCE, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_SOURCE
  }
}

export function saveSource(s: SourceSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

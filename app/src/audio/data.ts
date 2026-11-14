import { isWirelessName } from './wireless'

export type Band ='subBass' | 'midBass' | 'lowerMids' | 'upperMids' | 'lowerTreble' | 'air'

export interface Iem {
  id: string
  name: string
  /** Reviewer whose measurement is used. */
  source: string
  /** All reviewers who measured it. */
  sources: string[]
  /** FR in tenths of a dB on the shared grid (multiply by `frScale`); packed in the file, see decodeIemData. */
  fr: ArrayLike<number>
  /** Mean deviation from the target per band (dB). */
  metrics: Record<Band, number>
  /** Headphones only, where known (scripts/headphone_types.py). */
  back?: 'open' | 'semi-open' | 'closed'
  fit?: 'over' | 'on'
}

export interface IemData {
  grid: number[]
  frScale: number
  target: { name: string; fr: number[] }
  bands: Record<Band, [number, number]>
  calibration: Record<string, { overlap: number; rmsDb: number }>
  iems: Iem[]
}

export async function loadIemData(url = `${import.meta.env.BASE_URL}data/iems.json`): Promise<IemData> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return decodeIemData(await res.json())
}

/**
 * Unpack the curves (scripts/frcodec.py), tenths of a dB: "~" + base64 of an int16 first value and
 * int8 steps to each next point, or base64 of int16 values. Plain number lists pass through.
 */
export function decodeIemData(raw: IemData): IemData {
  decodeAllFr(raw.iems)
  return raw
}

/** How many points a packed curve holds, read from its base64 length without decoding it. */
function frLength(packed: string): number {
  const b64 = packed.startsWith('~') ? packed.slice(1) : packed
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  return packed.startsWith('~') ? bytes - 1 : bytes >> 1
}

function decodeFrInto(packed: string, out: Int16Array) {
  const steps = packed.startsWith('~')
  const bin = atob(steps ? packed.slice(1) : packed)
  if (!steps) {
    for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16
    return
  }
  out[0] = (bin.charCodeAt(0) | (bin.charCodeAt(1) << 8)) << 16 >> 16
  for (let i = 2; i < bin.length; i++) out[i - 1] = out[i - 2] + ((bin.charCodeAt(i) << 24) >> 24)
}

/**
 * Decodes every packed curve of a list into one shared buffer, each item keeping a view into it. One small buffer
 * per curve cost ~7.7 KB each in the WebView (allocation overhead on a 482-byte curve): the ~18,900 curves of the
 * IEM, headphone and reference lists held 137 MB on the phone (heap snapshot, plan §76 J); shared, they take ~9 MB.
 */
export function decodeAllFr(items: { fr: unknown }[]): void {
  const lengths = items.map((it) => (typeof it.fr === 'string' ? frLength(it.fr) : 0))
  const all = new Int16Array(lengths.reduce((a, b) => a + b, 0))
  let at = 0
  items.forEach((it, i) => {
    if (typeof it.fr !== 'string') return
    const view = all.subarray(at, at + lengths[i])
    decodeFrInto(it.fr, view)
    it.fr = view
    at += lengths[i]
  })
}

/** One packed curve (see decodeIemData); anything that isn't a string passes through. */
export function decodeFr(packed: unknown): ArrayLike<number> {
  if (typeof packed !== 'string') return packed as ArrayLike<number>
  const out = new Int16Array(frLength(packed))
  decodeFrInto(packed, out)
  return out
}

/** FR of an IEM (or the target) in dB. */
export function frDb(data: IemData, fr: ArrayLike<number>): Float64Array {
  return Float64Array.from(fr, (v) => v * data.frScale)
}

/** Median FR (dB) of `iems`, each levelled at 200 Hz–1 kHz first: a typical graph for gear not in the catalog. */
export function medianFr(data: IemData, iems: Iem[]): Float64Array {
  const mid = data.grid.flatMap((f, i) => (f >= 200 && f <= 1000 ? [i] : []))
  const curves = iems.map((iem) => {
    const db = frDb(data, iem.fr)
    const level = mid.reduce((s, i) => s + db[i], 0) / (mid.length || 1)
    return db.map((v) => v - level)
  })
  return Float64Array.from(data.grid, (_, i) => {
    const col = curves.map((c) => c[i]).sort((a, b) => a - b)
    const m = col.length >> 1
    return col.length % 2 ? col[m] : (col[m - 1] + col[m]) / 2
  })
}

const typicalCache = new WeakMap<IemData, Map<string, Float64Array>>()

/**
 * The reference when there's no current IEM: the target, or with "Cannot find mine" a typical
 * graph for the device type (wireless models for earbuds, every model for IEMs). The catalog has
 * no over-ears, so headphones keep the target.
 */
export function baselineFr(
  data: IemData,
  p: { mode: 'iem' | 'speakers'; listeningOn?: string; unlistedGear?: boolean },
): Float64Array {
  const kind = p.listeningOn === 'earbuds' ? 'earbuds' : 'iems'
  if (!p.unlistedGear || p.mode !== 'iem' || p.listeningOn === 'headphones') return frDb(data, data.target.fr)
  let byKind = typicalCache.get(data)
  if (!byKind) typicalCache.set(data, (byKind = new Map()))
  let fr = byKind.get(kind)
  if (!fr) {
    const pool = kind === 'earbuds' ? data.iems.filter((i) => isWirelessName(i.name)) : data.iems
    fr = medianFr(data, pool.length ? pool : data.iems)
    byKind.set(kind, fr)
  }
  return fr
}

/** What a label's words say it's about, in the order the pickers appear. First match wins. */
const KINDS: [string, RegExp][] = [
  ['Tips', /\b(tips?|eartips?|foam|silicone|silicon|spinfit|azla|sedna|final ?e|symbio|divinus|sancai|velvet|anemone|tennmak|cp\d+|ultraclear|stock (black|clear|white|red|blue|grey|gray|wide|narrow))\b/i],
  ['Nozzle', /\b(nozzles?|noz)\b/i],
  ['Filter', /\b(filters?|filterless|mesh|damped|undamped|tape|taped|vent)\b/i],
  ['Switch', /\b(switch(es)?|dip|all (on|off)|(on|off)([- ](on|off))+|[ud]{3,}|sw-?[01]+)\b/i],
  ['Mode', /\b(anc|ambient|ambience|transparency|eq|dsp|mode|bass boost)\b/i],
  ['Pads', /\b(pads?|earpads?|pad-rolling)\b/i],
  ['Cable', /\b(cable|recable|usb-?c|3\.5|4\.4|mmcx)\b/i],
  ['Adapter', /(\b\d+(\.\d+)? ?(ohms?|Ω))|\b(adapter|iematch)\b/i],
  ['Fit', /\b(deep|shallow|fit|insertion)\b/i],
  ['Unit', /\b(sample|unit|s\d+|20\d\d|prototype)\b/i],
]
const OTHER = 'Version'
export const MEASURED = 'Measured by'
const NONE = 'Standard'

export function kindOfLabel(text: string): string {
  return KINDS.find(([, words]) => words.test(text))?.[0] ?? OTHER
}

/** "Foam Tips, ANC OFF" -> { Tips: "Foam Tips", Mode: "ANC OFF" }. */
export function splitConfig(variant: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!variant) return out
  for (const raw of variant.split(/\s*(?:,|\s\+\s|;)\s*/)) {
    const part = raw.replace(/^[(\s]+|[)\s]+$/g, '')
    if (!part) continue
    const kind = kindOfLabel(part)
    out[kind] = out[kind] ? `${out[kind]} ${part}` : part
  }
  return out
}

export interface ConfigRow {
  id: string
  variant: string | null
  source: string
}

export interface Picker {
  kind: string
  value: string
  options: string[]
}

const reviewerOf = (source: string) => source.split(' (')[0]

const order = (kind: string) => {
  if (kind === MEASURED) return KINDS.length + 2
  if (kind === OTHER) return KINDS.length + 1
  return KINDS.findIndex(([k]) => k === kind)
}

/** Every row's value for each kind that varies. A row without one is "Standard". */
function table(rows: ConfigRow[]): { kinds: string[]; values: Map<string, Record<string, string>> } {
  const parsed = rows.map((r) => ({ id: r.id, config: splitConfig(r.variant), source: reviewerOf(r.source) }))
  const kinds = [...new Set(parsed.flatMap((p) => Object.keys(p.config)))]
  const values = new Map(parsed.map((p) => {
    const full: Record<string, string> = {}
    for (const k of kinds) full[k] = p.config[k] ?? NONE
    full[MEASURED] = p.source
    return [p.id, full]
  }))
  const varying = [...kinds, MEASURED].filter((k) => new Set([...values.values()].map((v) => v[k])).size > 1)
  return { kinds: varying.sort((a, b) => order(a) - order(b)), values }
}

/** One picker per kind of option this model has, showing what `currentId` is set to. */
export function pickersFor(rows: ConfigRow[], currentId: string): Picker[] {
  const { kinds, values } = table(rows)
  const now = values.get(currentId)
  if (!now) return []
  return kinds.map((kind) => {
    const options = [...new Set([...values.values()].map((v) => v[kind]))]
    options.sort((a, b) => (a === NONE ? -1 : b === NONE ? 1 : a.localeCompare(b)))
    return { kind, value: now[kind], options }
  })
}

/** The row to show after choosing `value` for `kind`: the one with that value that keeps the most of the other choices. */
export function rowForChoice(rows: ConfigRow[], currentId: string, kind: string, value: string): string {
  const { kinds, values } = table(rows)
  const now = values.get(currentId)
  if (!now) return currentId
  let best = currentId
  let bestScore = -1
  for (const row of rows) {
    const v = values.get(row.id) as Record<string, string>
    if (v[kind] !== value) continue
    const score = kinds.filter((k) => k !== kind && v[k] === now[k]).length
    if (score > bestScore) {
      bestScore = score
      best = row.id
    }
  }
  return best
}

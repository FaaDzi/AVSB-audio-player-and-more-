import type { Iem } from '../audio/data'
import { mergeDuplicates, splitName, stripParens } from './catalog'

/**
 * Catalog clean-up at load (§36.1). Squig reviewers spell brands their own way, leave bookkeeping in
 * the names and measure one IEM through several source impedances; this turns that into one model
 * per product with short variant labels. Ids never change: hidden rows keep resolving to the row
 * that stands for them, so saved brackets and your IEMs still load.
 */

/** Words that some reviewers put after the brand ("Final Audio A5000" = "Final A5000", "Moondrop Ultrasonic TWS" = "Moondrop Ultrasonic"). */
const BRAND_FILLER = new Set([
  'audio',
  'acoustic',
  'acoustics',
  'hifi',
  'technology',
  'tech',
  'electronics',
  'ear',
  'ears',
  'lab',
  'labs',
  'sound',
  'sounds',
  'inc',
  'ltd',
  'co',
  'the',
  'ver',
  'version',
  'edition',
  'tws',
])
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4' }
const BRAND_SYNONYMS: Record<string, string> = {
  crinears: 'crinear',
  truthears: 'truthear',
  ziigat: 'ziigaat',
  zigaat: 'ziigaat',
  cresscent: 'crescent',
  vison: 'vision',
  shuoer: 'letshuoer',
  letshouer: 'letshuoer',
  mangird: 'xenns',
  salnotes: '7hz',
  rosesesa: 'roseselsa',
  rosetechnics: 'roseselsa',
  meyr: 'myer',
  intaura: 'intuaura',
  phillips: 'philips',
  dragonly: 'dragonfly',
  airioso: 'airoso',
  fortenza: 'forteza',
  haylcon: 'halcyon',
  incongnita: 'incognita',
  adonix: 'adonis',
  vulkan: 'vulcan',
  cannon: 'canon',
  xyraa: 'xyrra',
  quark: 'quarks',
  chikyuu: 'chikyu',
  annivesary: 'anniversary',
  aniversary: 'anniversary',
  remastered: 'remaster',
  orivetti: 'oriveti',
  earacoustics: 'earacoustic',
  soundpeat: 'soundpeats',
  ttromso: 'tromso',
  azuyrs: 'azurys',
  mira: 'mirai',
  gen: 'generation',
  professional: 'pro',
  galazy: 'galaxy',
  tw2: 'truewireless2',
  tw3: 'truewireless3',
  tw4: 'truewireless4',
}

const CYRILLIC_LOOKALIKES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  А: 'A',
  Е: 'E',
  О: 'O',
  Р: 'P',
  С: 'C',
  У: 'Y',
  Х: 'X',
}

const COLLAB_RE =
  /\b(?:x|with|\+)\s*(?:crinacle|hbb|hawaiibadboy|gizaudio|z[\s-]*reviews?|zeos|z\b|super\s*review|jay'?s?(?:\s+audio)?|bad\s+guy\s+good\s+audio\s+reviews|elise(?:\s+audio)?|linsoul|shenzhenaudio|headphone\.?com|apos(?:\s+audio)?|drop|massdrop|audione|jade\s*audio|hangout(?:\s+audio)?|ha\b|akros|av\b|cfa\b|r2e3|effect\s+audio|fitear|hifiman)\b|\b(?:crinacle|hbb|hawaiibadboy|gizaudio|z[\s-]*reviews?|zeos|drop|massdrop)\s*(?:x|\+|\/)\s*/gi

function foldAccents(s: string): string {
  return s
    .replace(/[аеорсухАЕОРСУХ]/g, (c) => CYRILLIC_LOOKALIKES[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
}

const compact = (s: string) => foldAccents(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const wordsOf = (s: string) =>
  foldAccents(s)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => {
      const r = ROMAN[w] ?? w
      return BRAND_SYNONYMS[r] ?? r
    })

/** Source leftovers: "Campfire Audio ['Andromeda']", "<Mod> 'Chu II Modded'", doubled brand words ("Sony Sony", "Head(amame) Head(amame)"), doubled spaces. */
export function cleanName(name: string): string {
  return name
    .replace(/[аеорсухАЕОРСУХ]/g, (c) => CYRILLIC_LOOKALIKES[c] ?? c)
    .replace(/\[\s*'([^']*)'\s*\]/g, '$1')
    .replace(/<\s*mod\s*>\s*/gi, '')
    .replace(/(^|\s)'([^']+)'(?=\s|$)/g, '$1$2')
    .replace(/\blyr[oö]\/lyro\b/gi, 'Lyro')
    .replace(/(^|\s)(\p{L}[\p{L}\p{N}().'-]*)\s+\2(?=\s|$)/giu, (m, pre, w) => (w.toLowerCase() === 'omega' ? m : `${pre}${w}`))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The brand-spelling-proof key of a model: filler words after the brand dropped, II = 2. */
export function brandKey(model: string): string {
  const s = stripParens(model)
    .replace(COLLAB_RE, ' ')
    .replace(/\bwan['’]?er(?:\s+s\.?g\.?)?\b|\bwan\s+er(?:\s+s\.?g\.?)?\b/gi, 'waner')
    .replace(/\bkinera\s+celest\b/gi, 'celest')
    .replace(/\bxenns\s+mangird\b/gi, 'xenns')
    .replace(/\b7hz\s+salnotes\b|\bsalnotes\s+7hz\b/gi, '7hz')
    .replace(/\bfiio\s+jade\s*audio\b/gi, 'fiio')
    .replace(/\bqueen\s+of\s+audio(?:\s+qoa)?\b/gi, 'qoa')
    .replace(/\bastell\s*(?:&|n|and)?\s*kern(?:\s+ak)?\b/gi, 'astellkern')
    .replace(/\bventure\s+electronics(?:\s+ve)?\b/gi, 'ventureelectronics')
    .replace(/\btangzu(?:\s+hbb)?(?:\s+zetian)?\s+wu\s+heyday\b/gi, 'tangzuzetianwuheyday')
    .replace(/\bmega\s*5\s*est\b|\bmega5\b/gi, 'mega5est')
    .replace(/\bjvc\s+ha[- ]/gi, 'jvc ')
    .replace(/\bblon\s+bl[- ]/gi, 'blon ')
    .replace(/\bfinal(?:\s+audio)?\s+fi[- ]/gi, 'final ')
    .replace(/\burbanfun\s+ybf[- ]/gi, 'urbanfun ')
    .replace(/\bphonak\s+audeo\b/gi, 'phonak')
    .replace(/\b64\s+audio\s+tia\b/gi, '64 audio')
    .replace(/\brose\s*technics\b/gi, 'roseselsa')
    .replace(/\baudio[\s-]*technica\s+ath[- ]/gi, 'audiotechnica ')
    .replace(/\bsony\s+mdr[- ]/gi, 'sony ')
    .replace(/\bphilips\s+fidelio\b/gi, 'philips')
    .replace(/\banker\s+soundcore\b|\bsoundcore\s+by\s+anker\b|\banker\s+(?=liberty\b)/gi, 'soundcore ')
    .replace(/\bsamsung\s+buds\b/gi, 'samsung galaxy buds')
    .replace(/\bnoble\s+(?=fokus\b)/gi, 'noble audio ')
  const w = wordsOf(s)
  const dedup: string[] = []
  for (const tok of w) {
    if (!dedup.length || dedup[dedup.length - 1] !== tok) dedup.push(tok)
  }
  return dedup.filter((x, i) => !(i >= 1 && BRAND_FILLER.has(x))).join('')
}

const OHM = /(\d+(?:\.\d+)?)\s*(?:ohms?\b|Ω)/i
const OHM_ALL = /\+?\s*\(?\d+(?:\.\d+)?\s*(?:ohms?\b|Ω)\)?/gi
const BARE_OHM = /^(?:10|15|20|30|32|47|50|75|80|100|120|150|200|220|250|300|470|600)$/
const ACCESSORY = /\b(resistor|adapter|adaptor|impedance\s+(?:plug|adapter)|iematch)\b/i
/** Reviewer bookkeeping that tells a user nothing: "S1 (by 냥냐냥)", "Sample 2", "22th measurement". */
const NOISE = [
  /\bby\s+[^,()]*/gi,
  /\bS\d\b/g,
  /\bsample\s*\d*\b/gi,
  /\b\d+(?:st|nd|rd|th)\s+(?:measurement|unit)\b/gi,
  /\bmeasurement\s*\d*\b/gi,
  /\bunit\s*\d+\b/gi,
  /\bfirmware\s+\S+/gi,
  /\b\d+k\s+peak\b/gi,
]

/**
 * A variant label without the model name repeated in it or reviewer bookkeeping:
 * ("64 Audio Aspire 1", "64 Audio Aspire 1 deep") -> "deep". Returns '' when nothing is left.
 */
export function cleanVariant(model: string, variant: string, opts: { dropOhm?: boolean } = {}): string {
  let v = variant
  for (const re of NOISE) v = v.replace(re, ' ')
  if (opts.dropOhm) v = v.replace(OHM_ALL, ' ')
  const mw = wordsOf(model)
  const known = new Set([...mw, ...mw.slice(1).map((w, i) => mw[i] + w), ...BRAND_FILLER])
  const kept = v
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((tok) => {
      const r = ROMAN[compact(tok)] ?? compact(tok)
      const c = BRAND_SYNONYMS[r] ?? r
      return c && !known.has(c)
    })
  return kept
    .join(' ')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .replace(/^[\s,+\-–—/]+|[\s,+\-–—/]+$/g, '')
    .trim()
}

/**
 * Largest level-matched difference (dB) of two curves over 20 Hz–16 kHz. The full range on purpose:
 * bass switches and fit change only the low end, and must never count as the same curve.
 */
export function curveGapper(grid: number[], frScale: number): (a: ArrayLike<number>, b: ArrayLike<number>) => number {
  const idx = grid.flatMap((f, i) => (f >= 20 && f <= 16000 ? [i] : []))
  const mid = grid.flatMap((f, i) => (f >= 200 && f <= 1000 ? [i] : []))
  return (a, b) => {
    if (!idx.length || a.length < grid.length || b.length < grid.length) return Infinity
    let level = 0
    for (const i of mid) level += a[i] - b[i]
    level /= Math.max(1, mid.length)
    let worst = 0
    for (const i of idx) worst = Math.max(worst, Math.abs(a[i] - b[i] - level))
    return worst * frScale
  }
}

/** Re-measurements that never differ by this much (dB) count as one variant. */
export const SAME_CURVE_DB = 1
/** Switch settings ("UDUD", "1010", "on-off") are real options even when two of them measure alike. */
const SWITCHES = /^(?:(?:on|off|up|down|u|d|[01])[\s/-]?){2,6}$/i

/** Canonical key for comparing two variant labels of the same model ("Deep Fit" == "deep", "UUUU" == "on-on-on-on"). */
function labelCompareKey(label: string): string {
  const s = label.toLowerCase().trim()
  if (SWITCHES.test(s)) {
    const tokens = s.match(/on|off|up|down|u|d|1|0/g)
    if (tokens && tokens.length >= 2) {
      return 'sw:' + tokens.map((t) => (t === 'on' || t === 'up' || t === 'u' || t === '1' ? '1' : '0')).join('')
    }
  }
  return s
    .replace(/\b(fit|eartips?|tips?|mode|setting)\b/g, ' ')
    .replace(/\bsilicone?\b/g, 'silicone')
    .replace(/[^a-z0-9]+/g, '')
}

interface Row {
  iem: Iem
  model: string
  label: string
  ohm: number | null
  accessory: boolean
  order: number
}

/**
 * Tidy the rows in place: names cleaned and brand spellings unified, variant labels shortened,
 * then per model one row per label (and per near-identical curve). On in-ears, a source-impedance
 * row ("15 Ohm") or resistor/adapter row is hidden whenever the model has another row.
 */
export function tidyCatalog(
  data: { iems: Iem[]; grid: number[]; frScale: number },
  byId: Map<string, Iem>,
  kind: 'iems' | 'headphones',
  extras: Record<string, unknown>[],
): { hidden: number } {
  const inEar = kind === 'iems'
  const gap = curveGapper(data.grid, data.frScale)
  const rows: Row[] = data.iems.map((iem, order) => {
    const raw = cleanName(iem.name)
    const split = splitName(raw)
    let model = split.model
    const variant = split.variant
    let ohmM = variant ? OHM.exec(variant) : null
    let accessory = inEar && !!variant && ACCESSORY.test(variant)
    // "Kiwi Ears Airoso 10ohm", "Truthear Red 90 ohm adapter": the impedance is in the model part
    const inModel = inEar ? OHM.exec(model) : null
    if (inModel) {
      ohmM ??= inModel
      accessory ||= ACCESSORY.test(model)
      model = model.replace(OHM_ALL, ' ').replace(new RegExp(ACCESSORY.source, 'gi'), ' ').replace(/\s+/g, ' ').replace(/[\s+]+$/, '').trim()
    }
    let label = variant ? cleanVariant(model, variant, { dropOhm: inEar }) : ''
    let ohm = ohmM ? Number(ohmM[1]) : null
    if (inEar && BARE_OHM.test(label)) {
      ohm ??= Number(label)
      label = ''
    }
    return {
      iem,
      model,
      label,
      ohm,
      accessory,
      order,
    }
  })

  // one display spelling per model: non-collab before collab, the most used one, mixed case before ALL CAPS, then shorter
  const byModel = new Map<string, Row[]>()
  for (const r of rows) {
    const k = brandKey(r.model) || compact(r.model)
    const g = byModel.get(k)
    if (g) g.push(r)
    else byModel.set(k, [r])
  }
  const merge: Record<string, string> = {}
  for (const group of byModel.values()) {
    const counts = new Map<string, number>()
    for (const r of group) counts.set(r.model, (counts.get(r.model) ?? 0) + 1)
    const caps = (s: string) => (s === s.toUpperCase() ? 1 : 0)
    const hasCollab = (s: string) => {
      COLLAB_RE.lastIndex = 0
      return COLLAB_RE.test(s) ? 1 : 0
    }
    const display = [...counts].sort(
      (a, b) => hasCollab(a[0]) - hasCollab(b[0]) || b[1] - a[1] || caps(a[0]) - caps(b[0]) || a[0].length - b[0].length,
    )[0][0]

    // which rows stand for the model: plain and real options before impedance/adapter rows
    const rank = (r: Row) => (r.accessory ? 2 : r.ohm !== null ? 1 : 0)
    const sorted = [...group].sort(
      (a, b) => rank(a) - rank(b) || (a.ohm ?? 0) - (b.ohm ?? 0) || b.iem.sources.length - a.iem.sources.length || a.order - b.order,
    )
    const kept: Row[] = []
    for (const r of sorted) {
      // an adapter row only stays when the model has nothing else; an impedance row ("Treble + 80ohm")
      // is folded into the row with the same label once the ohms are dropped
      const rKey = labelCompareKey(r.label)
      const keeper =
        (r.accessory && kept.length ? kept[0] : undefined) ??
        (inEar && r.ohm !== null && !r.label && kept.length ? kept[0] : undefined) ??
        kept.find((k) => labelCompareKey(k.label) === rKey) ??
        (SWITCHES.test(r.label)
          ? undefined
          : kept.find((k) => !SWITCHES.test(k.label) && gap(k.iem.fr, r.iem.fr) < SAME_CURVE_DB))
      if (keeper) merge[r.iem.id] = keeper.iem.id
      else kept.push(r)
    }
    for (const r of kept) r.iem.name = r.label ? `${display} (${r.label})` : display
  }

  const before = data.iems.length
  mergeDuplicates(data, byId, merge, extras)
  // ids that already pointed at a row hidden just now (older alias merges) follow it to its keeper
  for (const [id, iem] of byId) {
    const to = merge[iem.id]
    if (to && byId.get(to)) byId.set(id, byId.get(to)!)
  }
  return { hidden: before - data.iems.length }
}

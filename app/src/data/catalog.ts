import { frDb, loadIemData, type Iem, type IemData } from '../audio/data'
import { isWirelessName } from '../audio/wireless'
import { loadImages, loadReviews, type IemImage, type Review, type ReviewData, type ReviewPointData } from '../reviews/reviews'
import { tidyCatalog } from './tidy'

export interface ShopPrice {
  usd: number
  store: string
  url: string
}

/**
 * What a catalog holds: wired in-ears, wireless earbuds (TWS) or over-ear/on-ear headphones. The
 * loaded IEM file holds both in-ear kinds; `bracketCatalog` splits them for a bracket.
 */
export type CatalogKind = 'iems' | 'tws' | 'headphones' | 'speakers' | 'soundbar'

/**
 * §114 D (reports/classification_audit_2026-11-27.md): rows the source put in the wrong file, or whose name misleads
 * the wireless check. An id here also covers its variants ("akg-n9" → "akg-n9-n9-wired-anc").
 */
const KIND_OVERRIDES: [string, CatalogKind][] = [
  ...['akg-n9', 'audio-technica-ath-w1000z', 'bang-olufsen-beoplay-h95', 'fostex-modhouse-t50rp', 'fostex-modhouse-t60rp', 'fostex-t20', 'hifiman-mini-shangri-la', 'hifiman-shangri-la-jr', 'philips-fidelio-x3', 'sendy-peacock', 'sennheiser-hd25', 'thieaudio-ghost']
    .map((id) => [id, 'headphones'] as [string, CatalogKind]),
  ...['hp-bose-quietcomfort-20', 'hp-polk-audio-ultrafit-2000', 'hp-philips-actionfit-shq5200', 'hp-nocs-ns700', 'hp-nocs-ns300',
    'apple-airpods-wired-3-5-mm', 'airline-buds-air-india', 'airline-freebuds-ana-airline', 'earbuds-dk-buds-150', 'kinera-verdandi-tws-wired', 'kiwi-ears-orchestra-kiwi-ears-orchestra-e-type-tws', 'musikable-modder-sleeper-buds-600ohms']
    .map((id) => [id, 'iems'] as [string, CatalogKind]),
  // iemworld's "Momentum 3" rows carry eartip variants: the True Wireless 3, not the over-ear
  ...['hp-beats-powerbeats-2-wireless', 'sennheiser-momentum-3'].map((id) => [id, 'tws'] as [string, CatalogKind]),
]
const overrideOf = (id: string) => KIND_OVERRIDES.find(([p]) => id === p || id.startsWith(`${p}-`))?.[1]

/** A device's kind: headphone ids start with "hp-", wireless in-ears are named like it. */
export function kindOfIem(iem: { id: string; name: string }): CatalogKind {
  const fixed = overrideOf(iem.id)
  if (fixed) return fixed
  // speakers and soundbars (§78 B, scripts/build_speakers.py): "what you listen on" only, never a bracket entrant
  if (iem.id.startsWith('spk-')) return /soundbar/i.test(iem.name) ? 'soundbar' : 'speakers'
  // §106 F: a phone's or tablet's own loudspeakers
  if (iem.id.startsWith('phone-speaker-')) return 'speakers'
  return iem.id.startsWith('hp-')
    ? 'headphones'
    : isWirelessName(iem.name) || isWirelessName(iem.id.replace(/-/g, ' '))
      ? 'tws'
      : 'iems'
}

/** The words a bracket of this kind uses for one entrant ("IEM" / "TWS" / "headphone"). */
export function gearWords(kind: CatalogKind): { one: string; many: string; upper: string } {
  if (kind === 'headphones') return { one: 'headphone', many: 'headphones', upper: 'HEADPHONE' }
  if (kind === 'tws') return { one: 'TWS', many: 'TWS', upper: 'TWS' }
  if (kind === 'speakers') return { one: 'speaker', many: 'speakers', upper: 'SPEAKER' }
  if (kind === 'soundbar') return { one: 'soundbar', many: 'soundbars', upper: 'SOUNDBAR' }
  return { one: 'IEM', many: 'IEMs', upper: 'IEM' }
}

/** One kind out of the in-ear catalog (wired IEMs or TWS); photos, prices and reviews stay shared. */
export function bracketCatalog(inEars: Catalog, kind: 'iems' | 'tws'): Catalog {
  const iems = inEars.data.iems.filter((i) => kindOfIem(i) === kind)
  const keep = new Set(iems)
  return {
    ...inEars,
    kind,
    data: { ...inEars.data, iems },
    // merged duplicate ids keep resolving to their kept row
    byId: new Map([...inEars.byId].filter(([, i]) => keep.has(i))),
  }
}

export interface Catalog {
  kind: CatalogKind
  data: IemData
  byId: Map<string, Iem>
  reviews: ReviewData | null
  images: Record<string, IemImage>
  shopPrices: Record<string, ShopPrice>
  /** IEM id -> its graph on the reviewer's squig.link site (scripts/build_squig_links.py). */
  squig: Record<string, { url: string; reviewer: string }>
  /** Target curves the graph can draw (scripts/build_targets.py), dB on the shared grid. */
  targets: GraphTarget[]
  /** Headphone graphs (headphone and merged catalogs): over-ear targets, and what turns a stored curve back into its over-ear shape. */
  headphones?: HeadphoneGraph
}

export interface HeadphoneGraph {
  targets: GraphTarget[]
  /** dB to add to a stored headphone curve (in-ear style) for its real over-ear shape: OE target − in-ear target. */
  toNative: Float64Array
}

/**
 * Curves and targets for a frequency graph of these models. Headphones only: each in its real
 * over-ear shape against the over-ear targets. Mixed with in-ears (or no headphone data): the
 * stored curves and in-ear targets, the one baseline both can share.
 */
export function graphOf(c: Catalog, models: Iem[]): { fr: (iem: Iem) => Float64Array; targets: GraphTarget[] } {
  const hp = c.headphones
  if (!hp || !models.length || !models.every((m) => m.id.startsWith('hp-'))) return { fr: (i) => frDb(c.data, i.fr), targets: c.targets }
  return { fr: (i) => frDb(c.data, i.fr).map((v, k) => v + hp.toNative[k]), targets: hp.targets }
}

export interface GraphTarget {
  name: string
  note: string
  values: number[]
}

/**
 * Load a catalog. Headphones (scripts/build_headphone_data.py) share the IEM format: each curve is
 * the headphone's difference from Harman over-ear 2018 laid onto the in-ear target, so the
 * tournament, EQ and scoring code work on them unchanged. Reviews, photos and prices are keyed by
 * id in the same files (headphone ids start with "hp-").
 */
// the IEM and headphone catalogs load together and share these files: fetch and parse each once (§113 check).
// Merging adds entries by id only, so sharing the parsed objects between the two is safe.
const shared = new Map<string, Promise<any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
const sharedJson = (f: string) => {
  let p = shared.get(f)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    shared.set(f, p)
    // both catalogs ask in the same tick (loadDatabase), so drop it once it's in: nothing keeps a second copy alive
    void p.finally(() => shared.delete(f))
  }
  return p
}

export async function loadCatalog(kind: 'iems' | 'headphones' = 'iems'): Promise<Catalog> {
  const json = sharedJson
  const hp = kind === 'headphones'
  const [data, reviews, pointFile, shopImages, archiveImages, searchImages, shopPrices, squig, targetFile, aliasFile, ...brandImages] = await Promise.all([
    loadIemData(`${import.meta.env.BASE_URL}data/${hp ? 'headphones' : 'iems'}.json`),
    loadReviews().catch(() => null),
    json('review_points.json'),
    loadImages().catch(() => ({})),
    json('images_archive.json'),
    json('images_search.json'),
    json('prices.json'),
    json('squig.json'),
    json('targets.json'),
    json('aliases.json'),
    ...['a', 'b', 'c'].map((g) => json(`images_brand_${g}.json`)),
  ])
  // current shop photos win, then archived shop pages, then brand sites, then image search
  const images = { ...searchImages, ...Object.assign({}, ...brandImages), ...archiveImages, ...shopImages }
  type TargetRow = { name: string; note: string; fr: number[] }
  const file = targetFile as { targets?: TargetRow[]; headphoneTargets?: TargetRow[] }
  const toTargets = (rows: TargetRow[] = []): GraphTarget[] => rows.map((t) => ({ name: t.name, note: t.note, values: t.fr.map((v) => v * data.frScale) }))
  const targets = toTargets(file.targets)
  if (!targets.length) targets.push({ name: data.target.name, note: '', values: data.target.fr.map((v) => v * data.frScale) })
  // headphone curves are stored in-ear style (scripts/build_headphone_data.py); the first over-ear target is the one they were aligned to
  const hpTargets = toTargets(file.headphoneTargets)
  const headphones: HeadphoneGraph | undefined =
    hp && hpTargets.length ? { targets: hpTargets, toNative: Float64Array.from(hpTargets[0].values, (v, k) => v - data.target.fr[k] * data.frScale) } : undefined
  const byId = new Map(data.iems.map((i) => [i.id, i]))
  const aliases = aliasFile as { merge?: Record<string, string>; families?: Record<string, string> }
  setFamilies(aliases.families ?? {})
  // review summaries ride along with the reviews they belong to (same ids, same merges)
  const points = pointFile as Partial<ReviewPointData>
  if (reviews && points.points) reviews.points = { points: points.points, reviews: points.reviews ?? {}, videos: points.videos ?? {}, comments: points.comments ?? {} }
  const extras = [images, shopPrices, squig, reviews?.reviews ?? {}, reviews?.videos ?? {}, reviews?.comments ?? {}, ...(reviews?.points ? [reviews.points.reviews, reviews.points.videos, reviews.points.comments] : [])]
  mergeDuplicates(data, byId, aliases.merge ?? {}, extras)
  tidyCatalog(data, byId, kind, extras)
  return { kind, data, byId, reviews, images, shopPrices, squig, targets, headphones }
}

/**
 * IEMs (with TWS) and headphones as one catalog, for the gallery and quick match: every model,
 * photo, price and review reachable by id. Both share the grid and the in-ear target.
 */
export function mergeCatalogs(iems: Catalog, headphones: Catalog): Catalog {
  return {
    ...iems,
    data: { ...iems.data, iems: [...iems.data.iems, ...headphones.data.iems] },
    byId: new Map([...headphones.byId, ...iems.byId]),
    images: { ...headphones.images, ...iems.images },
    shopPrices: { ...headphones.shopPrices, ...iems.shopPrices },
    squig: { ...headphones.squig, ...iems.squig },
    headphones: headphones.headphones,
  }
}

/**
 * Show each IEM once (scripts/build_iem_aliases.py): duplicate rows leave the list, their
 * ids keep resolving to the kept row (saved brackets, your IEMs), and the kept row picks
 * up any photo, price, squig page or review only the duplicate had.
 */
export function mergeDuplicates(
  data: { iems: Iem[] },
  byId: Map<string, Iem>,
  merge: Record<string, string>,
  extras: Record<string, unknown>[],
) {
  for (const [dup, keepId] of Object.entries(merge)) {
    const keep = byId.get(keepId)
    const gone = byId.get(dup)
    if (!keep || !gone || keep === gone) continue
    for (const rec of extras) if (!(keepId in rec) && dup in rec) rec[keepId] = rec[dup]
    keep.sources = [...new Set([...keep.sources, ...gone.sources])]
    byId.set(dup, keep)
  }
  data.iems = data.iems.filter((i) => byId.get(i.id) === i)
}

/** Name prefix -> model, for rows that are one IEM measured with different tips/filters (aliases.json). */
let families: [string, string][] = []
export function setFamilies(f: Record<string, string>) {
  families = Object.entries(f)
    .map(([prefix, model]): [string, string] => [prefix.toLowerCase(), model])
    .sort((a, b) => b[0].length - a[0].length)
}

/** Remove all balanced parenthetical groups, including nested ones. */
export function stripParens(s: string): string {
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\s*\([^()]*\)/g, '')
  }
  return s
}

/** Model name without variant details: "Kato (gold nozzle)" -> "kato". Used to keep one variant per model. */
export function modelKey(name: string): string {
  const m = splitName(name).model
  return stripParens(m)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

/** Sub-model tokens that distinguish a genuinely separate product from a tip/nozzle/switch suffix. */
const SUBMODEL_START =
  /^(?:pro|max|plus|ultra|mini|lite|se|fe|gt|ti|turris|turis|live|dsp|anc|wireless|tws|bt|open|closed|mk\s*(?:[1234]|i|ii|iii|iv)|v[1234]|ii|iii|iv|\d+)\b/i

/** The family `name` belongs to, if any: its model and the variant part of the name. */
function familyOf(name: string): { model: string; variant: string } | null {
  const n = name.toLowerCase()
  for (const [prefix, model] of families) {
    if (n.length > prefix.length + 1 && n.startsWith(prefix + ' ')) {
      const rem = name.slice(prefix.length).trim()
      if (!SUBMODEL_START.test(rem)) return { model, variant: rem }
    }
  }
  return null
}

/** Split balanced trailing parentheses `Model (Variant (sub))` -> `{ model, variant }`. */
function splitOuterParens(name: string): { model: string; variant: string } | null {
  const s = name.trim()
  if (!s.endsWith(')')) return null
  let depth = 0
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++
    else if (s[i] === '(') {
      depth--
      if (depth === 0) {
        const model = s.slice(0, i).trim()
        const variant = s.slice(i + 1, -1).trim()
        if (model.length >= 2 && variant.length >= 1) return { model, variant }
        return null
      }
    }
  }
  return null
}

const INNER_BOOKKEEPING_PAREN = /^(?:sample\s*\d*|s\d+|unit\s*\d+|20\d\d|19\d\d|\d+(?:\.\d+)?\s*(?:ohms?|Ω)|bs)$/i

const VARIANT_SUFFIX_PATTERNS = [
  /\s+[-–—]\s*(.+)$/,
  /\s+((?:gold|silver|brass|black|blue|red|green|white|clear|grey|gray|pink|purple|yellow|steel|ti|titanium|br|bronze|copper|ss|stainless(?:\s+steel)?|[a-d]|bullet\s+gold|bullet\s+silver|flat\s+gold|flat\s+silver|standard|alternative|vocal|instrumental|reference|transparency|atmospheric(?:\s+immersion)?|bass|balanced|treble|stock)\s+nozzles?(?:\s+(?:clarion|ultraclear|ultra\s+clear|azla(?:\s+sedna)?|sancai(?:\s+wide)?|black|white|clear|red|blue|green|stock))?)$/i,
  /\s+((?:bass|treble|balanced|reference|normal|red|silver|gold|blue|green|white|short|gray|grey|black|no|alternative|standard|taped|foam|mesh|damped|undamped|high|mid|low)\s+(?:filters?|filt\.?|ring|dampers?))$/i,
  /\s+(stock(?:\s+(?:black|clear|grey|gray|white|red\/white|yellow|green|blue|silicone|silicon|foam|wide|narrow|anemone|balanced|bass|vocal))+|stock(?:\s+(?:tips?|eartips?))?|(?:foam|silicone|silicon|sancai(?:\s+wide|\s+regular|\s+flange|\s+balance)?|divinus(?:\s+velvet)?(?:\s+wide)?|spring|memory\s+foam|comply(?:\s+\d+)?(?:\s+foam)?|clarion|ultraclear|ultra\s+clear|azla(?:\s+sedna|\s+crystal|\s+xelastec)?|spinfit(?:\s+\w+)?|final\s+e|tang\s+sancai|softears\s+ultraclear|h570|cp\d+)\s*(?:wide|narrow)?\s*(?:tips?|eartips?)?)$/i,
  /\s+(\d+\s+mesh(?:\s+mod|\s+filter|\s+re-tune)?)$/i,
  /\s+(anc\s+(?:on|off))$/i,
  /\s+(all\s+(?:on|off)|[1-4]\s+(?:on|off)|sw-?[01]{2,4}(?:\s+(?:equalization|transparency|atmosphere|electronic|high[- ]frequency|low[- ]frequency|balanced|bass|treble))?|(?:(?:off|on|up|down|u|d|[01])[\s/-]?){2,6})$/i,
  /\s+((?:m12|m15|m20|m26|mx|xx)(?:\s+apex(?:\s+module)?)?)$/i,
  /\s+([nf]\.(?:black|blue|red|gold|silver|green|purple|pink|grey|gray)|blk|gld|slv|sil|blu|grn)$/i,
  /\s+(atmospheric(?:\s+immersion)?(?:\s+mode)?|atmosphere|bass\s+mode|planar\s+mode|high\s+frequency|low\s+frequency|instrument\s+enhancement|bass[- ]mids(?:[- ]highs)?|bass[- ]highs|pr\s+(?:open|closed)|(?:hollow|solid)\s+switch\s+(?:smooth|sticky)|(?:control|power|superstage)\/vocal\s+(?:on|off))$/i,
  /\s+(pad[- ]rolling|(?:fresh|worn)\s+earpads|[12]\/2)$/i,
]

/** "Kato (gold nozzle)" -> { model: "Kato", variant: "gold nozzle" }, for two-line labels. */
export function splitName(name: string): { model: string; variant: string | null } {
  let curModel = name.trim()
  const variants: string[] = []

  for (let pass = 0; pass < 3; pass++) {
    const fam = familyOf(curModel)
    if (fam) {
      curModel = fam.model
      variants.unshift(fam.variant)
      break
    }
    const paren = splitOuterParens(curModel)
    if (paren && (pass === 0 || INNER_BOOKKEEPING_PAREN.test(paren.variant))) {
      curModel = paren.model
      variants.unshift(paren.variant)
      continue
    }
    let matched = false
    for (const pat of VARIANT_SUFFIX_PATTERNS) {
      const m = pat.exec(curModel)
      if (m) {
        const model = curModel.slice(0, m.index).trim()
        const variant = (m[1] || m[0]).replace(/^[-–—\s()]+|[-–—\s()]+$/g, '').trim()
        if (model.length >= 3 && variant.length >= 1) {
          curModel = model
          variants.unshift(variant)
          matched = true
          break
        }
      }
    }
    if (!matched) break
  }

  return variants.length ? { model: curModel, variant: variants.join(' ') } : { model: name, variant: null }
}

/** Number of distinct models (variants such as cable or tip options count once). */
export function modelCount(iems: { name: string }[]): number {
  return new Set(iems.map((i) => modelKey(i.name))).size
}

export function reviewsOf(c: Catalog, id: string): Review[] {
  return c.reviews?.reviews[id] ?? []
}

/** Price: Jay's sheet first (it's what his review assumes), else the shop price. */
export function priceOf(c: Catalog, id: string): { usd: number; source: string; url?: string } | null {
  const sheet = reviewsOf(c, id).find((r) => r.jay.priceUsd !== null)
  if (sheet) return { usd: sheet.jay.priceUsd!, source: "Jay's sheet", url: sheet.link ?? undefined }
  const shop = c.shopPrices[id]
  return shop ? { usd: shop.usd, source: shop.store, url: shop.url } : null
}

/** Rows grouped by model so variants sit together: the plain model first, then by name. */
export function groupVariants<T extends { iem: { name: string } }>(rows: T[]): T[][] {
  const by = new Map<string, T[]>()
  for (const r of rows) {
    const k = modelKey(r.iem.name)
    const g = by.get(k)
    if (g) g.push(r)
    else by.set(k, [r])
  }
  const plain = (r: T) => (splitName(r.iem.name).variant === null ? 0 : 1)
  for (const g of by.values()) g.sort((a, b) => plain(a) - plain(b) || a.iem.name.localeCompare(b.iem.name))
  return [...by.values()]
}

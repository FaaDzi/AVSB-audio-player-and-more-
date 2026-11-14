import type { Iem } from '../../audio/data'
import { searchScore, searchWords } from '../../components/iemSearch'
import { groupVariants, kindOfIem, loadCatalog, mergeCatalogs, priceOf, reviewsOf, splitName, type Catalog, type CatalogKind } from '../../data/catalog'
import { logLine } from '../logs'
import { addListeningDevices } from '../../data/listeningDevices'

export interface Model {
  id: string
  name: string
  kind: CatalogKind
  members: Iem[]
  /** The model's name for sorting, without leading symbols. */
  sortName: string
  usd: number | null
  /** Average of the reviewers who score out of 10, or null. */
  score: number | null
  reviewCount: number
  photoId: string | null
}

export interface Database {
  catalog: Catalog
  models: Model[]
}

const TEN_POINT = /^(\d+(?:\.\d+)?)\s*\/\s*10$/

/** Reviewers who give a score out of 10 for one row, as numbers. */
export function tenPointScores(jayScore: number | null | undefined, grades: (string | null | undefined)[]): number[] {
  const scores = grades.flatMap((g) => {
    const m = g ? TEN_POINT.exec(g.trim()) : null
    return m ? [Number(m[1])] : []
  })
  return typeof jayScore === 'number' && jayScore <= 10 ? [jayScore, ...scores] : scores
}

export function buildModels(catalog: Catalog): Model[] {
  const rows = catalog.data.iems.map((iem) => ({ iem }))
  return groupVariants(rows).map((group) => {
    const members = group.map((r) => r.iem)
    const scores: number[] = []
    let reviewCount = 0
    for (const m of members) {
      const jay = reviewsOf(catalog, m.id)
      const comments = catalog.reviews?.comments?.[m.id] ?? []
      scores.push(...tenPointScores(jay[0]?.jay.score, comments.map((c) => c.grade)))
      reviewCount += jay.length + comments.length + (catalog.reviews?.videos?.[m.id]?.length ?? 0)
    }
    const name = splitName(members[0].name).model
    return {
      id: members[0].id,
      name,
      kind: kindOfIem(members[0]),
      members,
      sortName: name.normalize('NFKD').toLowerCase().replace(/^[^a-z0-9]+/, ''),
      usd: members.map((m) => priceOf(catalog, m.id)?.usd).find((p) => p !== undefined) ?? null,
      score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      reviewCount,
      photoId: members.find((m) => catalog.images[m.id])?.id ?? null,
    }
  })
}

export type SortMode = 'name' | 'score' | 'price-asc' | 'price-desc'
export const SORTS: [SortMode, string][] = [['name', 'Name'], ['score', 'Highest score'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low']]

export interface ListFilters {
  query: string
  kinds: Set<CatalogKind>
  reviewedOnly: boolean
  sort: SortMode
}

/** The list for these filters. While searching, the closest match comes first. */
export function listModels(models: Model[], { query, kinds, reviewedOnly, sort }: ListFilters): Model[] {
  const words = searchWords(query)
  const match = new Map<string, number>()
  if (words.length) {
    for (const m of models) {
      const best = Math.min(...m.members.map((r) => searchScore(r.name, words) ?? Infinity))
      if (best < Infinity) match.set(m.id, best)
    }
  }
  const list = models.filter((m) => kinds.has(m.kind) && (!reviewedOnly || m.reviewCount > 0) && (!words.length || match.has(m.id)))
  const byName = (a: Model, b: Model) => (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0)
  if (words.length) return list.sort((a, b) => (match.get(a.id) as number) - (match.get(b.id) as number) || byName(a, b))
  return list.sort((a, b) => {
    if (sort === 'score') return (b.score ?? -1) - (a.score ?? -1) || byName(a, b)
    if (sort === 'name') return byName(a, b)
    // nothing priced sorts last either way
    if (a.usd === null || b.usd === null) return a.usd === null ? (b.usd === null ? byName(a, b) : 1) : -1
    return sort === 'price-asc' ? a.usd - b.usd : b.usd - a.usd
  })
}

let loading: Promise<Database> | null = null

/** Loaded once, the first time the page opens, since it's about 15 MB of data. */
export function loadDatabase(): Promise<Database> {
  loading ??= (async () => {
    const started = performance.now()
    const json = (f: string) => fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    const [iems, headphones, generic, speakers] = await Promise.all([loadCatalog('iems'), loadCatalog('headphones'), json('generic.json'), json('speakers.json')])
    const catalog = mergeCatalogs(iems, headphones)
    // generic presets and speakers (§78 B, C): here only, so a bracket never gets them
    addListeningDevices(catalog, generic, speakers)
    const models = buildModels(catalog)
    logLine('INFO', 'Database', `Loaded ${models.length} models in ${Math.round(performance.now() - started)} ms`)
    return { catalog, models }
  })()
  loading.catch(() => { loading = null })
  return loading
}

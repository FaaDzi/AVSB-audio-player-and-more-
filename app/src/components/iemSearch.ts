import type { Iem } from '../audio/data'
import { splitName } from '../data/catalog'

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4' }
/** Words some reviewers put after the brand ("Final Audio A5000") or collab tags: optional in a query. */
const FILLER = new Set([
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
  'x',
  'crinacle',
  'hbb',
  'gizaudio',
  'zeos',
  'salnotes',
  'mangird',
  'celest',
])

/** Search words: accents and punctuation gone, "II" = 2, letters and digits apart ("hd600" = "hd 600"). */
export function searchWords(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, '$1$3 $2$4')
    .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, '$1$3 $2$4')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
}

/** How a query word lands in a name's words: 0 whole word, 1 start of a word (or of joined words), 2 inside one. */
function hit(q: string, words: string[]): number | null {
  let best: number | null = null
  for (let i = 0; i < words.length; i++) {
    if (words[i] === q) return 0
    if (words[i].startsWith(q)) best = 1
    else if (best === null) {
      // "shadowblade" = "shadow blade", "airpods" = "air pods"
      let joined = words[i]
      for (let j = i + 1; j < words.length && joined.length < q.length; j++) joined += words[j]
      if (joined.length > words[i].length && joined.startsWith(q)) best = 1
    }
  }
  // inside a word only counts for 3+ letters ("drop" in "moondrop"), never "2" in "x2"
  if (best === null && q.length >= 3 && words.some((w) => w.includes(q))) best = 2
  return best
}

// §114 B: splitting and normalising a name is the slow part of a search; each name is done once, not per keystroke
const prepared = new Map<string, { m: string[]; v: string[]; variant: string | null }>()
function nameWords(name: string) {
  let got = prepared.get(name)
  if (!got) {
    const { model, variant } = splitName(name)
    got = { m: searchWords(model), v: variant ? searchWords(variant) : [], variant }
    prepared.set(name, got)
  }
  return got
}

/**
 * How well `name` answers `query` (lower is better), or null when it doesn't. Every word has to land
 * in the name; words in the model beat words only in the variant, whole words beat word starts, and
 * the fewer extra words the model has, the closer the match ("hd 600" → Sennheiser HD 600 before
 * "Satyr 2 (HD600 pads)").
 */
export function searchScore(name: string, query: string[]): number | null {
  if (!query.length) return null
  const { m, v, variant } = nameWords(name)
  let score = 0
  let used = 0
  for (const q of query) {
    const inModel = hit(q, m)
    if (inModel !== null) {
      score += inModel * 10
      used++
      continue
    }
    const inVariant = hit(q, v)
    if (inVariant !== null) score += 100 + inVariant * 10
    else if (!FILLER.has(q)) return null
  }
  if (!used) score += 1000
  // the query starting the model or the word after the brand ("blessing 3" in "Moondrop Blessing 3")
  if (m[0]?.startsWith(query[0]) || m[1]?.startsWith(query[0])) score -= 5
  score += Math.max(0, m.length - used) * 3 + (variant ? 2 : 0)
  return score
}

/** Rows that answer the query, best first; ties: more reviewers, then A–Z. */
export function searchIems(iems: Iem[], query: string): Iem[] {
  const q = searchWords(query)
  if (!q.length) return []
  return iems
    .flatMap((iem) => {
      const s = searchScore(iem.name, q)
      return s === null ? [] : [{ iem, s }]
    })
    .sort((a, b) => a.s - b.s || b.iem.sources.length - a.iem.sources.length || a.iem.name.localeCompare(b.iem.name))
    .map((x) => x.iem)
}

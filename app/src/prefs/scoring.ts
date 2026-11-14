import type { Band, Iem } from '../audio/data'
import { modelKey, priceOf, reviewsOf, type Catalog } from '../data/catalog'
import type { Review } from '../reviews/reviews'
import type { FlavourId, HeadphoneType, Preferences, Profile } from './types'

export const BANDS: Band[] = ['subBass', 'midBass', 'lowerMids', 'upperMids', 'lowerTreble', 'air']
const WEIGHTS: Record<Band, number> = { subBass: 1, midBass: 1, lowerMids: 0.8, upperMids: 1.2, lowerTreble: 1, air: 0.6 }
const STEP_DB = 1.5 // one slider step
const REL_DB = 3 // "too little / too much" on the current IEM

export const FLAVOUR_INFO: Record<FlavourId, { label: string; tagline: string; color: string; sliders: Preferences['sliders'] }> = {
  bass: {
    label: 'Bass Head',
    tagline: 'Deep sub-bass slam and heavy low-end punch',
    color: '#FF2A85',
    sliders: { bass: 2, mids: 0, treble: -1, air: 0 },
  },
  warm: {
    label: 'Warm and Smooth',
    tagline: 'Rich lower-mids, relaxed treble, zero fatigue',
    color: '#FF9F1C',
    sliders: { bass: 1, mids: 1, treble: -1, air: -1 },
  },
  neutral: {
    label: 'Neutral Reference',
    tagline: 'True-to-life studio balance across every band',
    color: '#00F0B5',
    sliders: { bass: 0, mids: 0, treble: 0, air: 0 },
  },
  bright: {
    label: 'Bright and Detailed',
    tagline: 'Crisp upper-mids, sparkle, and micro-detail',
    color: '#00E5FF',
    sliders: { bass: -1, mids: 1, treble: 1, air: 2 },
  },
  vshape: {
    label: 'V-shaped Fun',
    tagline: 'Big bass + energetic treble for maximum excitement',
    color: '#FFE600',
    sliders: { bass: 2, mids: -1, treble: 1, air: 1 },
  },
}

/** Classifies any IEM's measured band metrics into one of the 5 GDD flavours. */
export function classifyFlavour(iem: Iem): { id: FlavourId; label: string; color: string } {
  const m = iem.metrics
  const bass = 0.6 * m.subBass + 0.4 * m.midBass
  const treble = 0.6 * m.lowerTreble + 0.4 * m.air
  const mids = 0.5 * m.lowerMids + 0.5 * m.upperMids

  if (bass >= 1.5 && treble >= 1.0 && bass - mids > 1.2) {
    return { id: 'vshape', label: FLAVOUR_INFO.vshape.label, color: FLAVOUR_INFO.vshape.color }
  }
  if (bass >= 2.2) {
    return { id: 'bass', label: FLAVOUR_INFO.bass.label, color: FLAVOUR_INFO.bass.color }
  }
  if (treble >= 1.4 && bass < 1.2) {
    return { id: 'bright', label: FLAVOUR_INFO.bright.label, color: FLAVOUR_INFO.bright.color }
  }
  if (bass >= 0.7 && treble <= 0.3) {
    return { id: 'warm', label: FLAVOUR_INFO.warm.label, color: FLAVOUR_INFO.warm.color }
  }
  return { id: 'neutral', label: FLAVOUR_INFO.neutral.label, color: FLAVOUR_INFO.neutral.color }
}

/** Extracts the brand name (first token) for the "at most 2 per brand" diversity rule (GDD Section 5). */
export function brandOf(iem: Iem): string {
  return (iem.name.trim().split(/\s+/)[0] ?? iem.name).toLowerCase()
}

/** Airline and disposable generic earbuds measured as comedic/meme baselines. */
export function isAirline(iem: { id: string; name: string }): boolean {
  const s = `${iem.id} ${iem.name}`.toLowerCase()
  return s.includes('airline') || s.includes('eva air') || s.includes('krisworld')
}

/** Engineering samples, beta tunings, and unreleased prototypes. */
export function isPrototype(iem: { id: string; name: string }): boolean {
  const s = `${iem.id} ${iem.name}`.toLowerCase()
  return (
    /\b(prototype|pre-production|engineering sample)\b/.test(s) ||
    /\bsample\s*([0-9]+|[a-z])?\b/.test(s) ||
    /\bbeta\b/.test(s)
  )
}

/** Private custom in-ear monitors molded to individual ear canals. */
export function isCiem(iem: { id: string; name: string }): boolean {
  const s = `${iem.id} ${iem.name}`.toLowerCase()
  return /\bciem\b/.test(s)
}

/** Community / reviewer DIY physical hardware mods (tape mods, mesh filters, sponges, reshells). */
export function isModded(iem: { id: string; name: string }): boolean {
  const s = `${iem.id} ${iem.name}`.toLowerCase()
  if (
    s.includes('shortbus') ||
    s.includes('tanya filter') ||
    s.includes('tape mod') ||
    s.includes('mesh mod') ||
    s.includes('zeus mod') ||
    s.includes('re-tune') ||
    s.includes('prison mike mod') ||
    s.includes('jaytiss custom tuned') ||
    s.includes('modified')
  ) {
    return true
  }
  if (/\b\d+\s+mesh\b/.test(s)) return true
  if (/\b(sponge|sponges)\b/.test(s)) return true
  if (/\b(mod|modded|diy mod|damping mod|nozzle mod)\b/.test(s) && !/\b(module|mode|model)\b/.test(s)) return true
  if (iem.id.startsWith('hp-') && isPadSwap(iem.name.toLowerCase())) return true
  return false
}

/**
 * A headphone measured with aftermarket or another model's pads ("… with Dekoni pads", "pad-rolling").
 * Stock pads stay stock ("fresh stock pads", "original pads"), but "with Serene stock pads" is a swap.
 */
function isPadSwap(name: string): boolean {
  if (!/\b(ear)?pads?\b|\bpad-roll|\bcushions?\b/.test(name)) return false
  const stock = /\b(stock|original|factory|default|oem)\b[^,)]*\b(ear)?pads?\b/.test(name)
  return !stock || /\bwith\s+(?!stock|original|factory|default|oem)\S+\s+(stock|original)\b/.test(name)
}

/** Filters a list of IEMs according to user preferences for special categories. */
export function filterIems<T extends { id: string; name: string; back?: string; fit?: string }>(
  iems: T[],
  prefs: Pick<Preferences, 'includePrototypes' | 'includeCiems' | 'includeModded' | 'hpType'>,
): T[] {
  return iems.filter((iem) => {
    if (isAirline(iem)) return false
    if (!matchesHpType(iem, prefs.hpType)) return false
    if (!prefs.includePrototypes && isPrototype(iem)) return false
    if (!prefs.includeCiems && isCiem(iem)) return false
    if (!prefs.includeModded && isModded(iem)) return false
    return true
  })
}

/** Headphone type filter; IEMs always pass. Open includes semi-open; untagged headphones match only "any". */
export function matchesHpType(iem: { id: string; back?: string; fit?: string }, type: HeadphoneType | undefined): boolean {
  if (!type || type === 'any' || !iem.id.startsWith('hp-')) return true
  if (type === 'on-ear') return iem.fit === 'on'
  return type === 'closed' ? iem.back === 'closed' : iem.back === 'open' || iem.back === 'semi-open'
}

/** A headphone's type in a few words ("Open back", "Closed · on-ear"); null for IEMs and untagged headphones. */
export function headphoneTypeLabel(iem: { id: string; back?: string; fit?: string }): string | null {
  if (!iem.id.startsWith('hp-') || !iem.back) return null
  const back = iem.back === 'open' ? 'Open' : iem.back === 'semi-open' ? 'Semi-open' : 'Closed'
  return iem.fit === 'on' ? `${back} · on-ear` : `${back} back`
}

/** Song genres (manifest) -> genre tags used in Jay's notes. */
const GENRE_TAGS: Record<string, string[]> = {
  rock: ['rock'], 'post-rock': ['rock'], 'jazz-rock': ['rock'], metal: ['metal'], 'hip-hop': ['hip-hop'],
  'k-pop': ['k-pop/j-pop'], 'j-pop': ['k-pop/j-pop'], 'j-rock': ['rock', 'k-pop/j-pop'], 'rhythm-game': ['edm', 'k-pop/j-pop'],
  electronic: ['edm'], 'trip-hop': ['edm'], pop: ['pop'], 'city-pop': ['pop'], reggaeton: ['pop'], afrobeats: ['pop'],
  folk: ['acoustic', 'ballads'], country: ['acoustic'], jazz: ['acoustic', 'instrumentals'], classical: ['classical', 'instrumentals'],
  soundtrack: ['classical', 'instrumentals'], 'r&b': ['r&b'], soul: ['r&b'], indie: ['indie'], latin: ['acoustic'],
}

/** The sound the user is looking for, as band deviations from the Harman target. */
export function targetProfile(prefs: Preferences, current: Iem | null): Profile {
  const t: Profile = current ? { ...current.metrics } : { subBass: 0, midBass: 0, lowerMids: 0, upperMids: 0, lowerTreble: 0, air: 0 }
  const rel = (r: string) => (r === 'more' ? 1 : r === 'less' ? -1 : 0)
  t.subBass += rel(prefs.current.bass) * REL_DB
  t.midBass += rel(prefs.current.bass) * REL_DB * 0.8
  t.upperMids += rel(prefs.current.vocals) * REL_DB * 0.7
  t.lowerMids += rel(prefs.current.vocals) * REL_DB * 0.3
  t.lowerTreble += rel(prefs.current.treble) * REL_DB * 0.7
  t.air += rel(prefs.current.treble) * REL_DB * 0.7
  if (prefs.current.sibilant) t.lowerTreble -= 1.5
  t.subBass += prefs.sliders.bass * STEP_DB
  t.midBass += prefs.sliders.bass * STEP_DB * 0.8
  t.lowerMids += prefs.sliders.mids * STEP_DB * 0.5
  t.upperMids += prefs.sliders.mids * STEP_DB
  t.lowerTreble += prefs.sliders.treble * STEP_DB
  t.air += prefs.sliders.air * STEP_DB
  return t
}

/** Weighted RMS distance (dB) between an IEM's band levels and the target. */
export function tonalDistance(iem: Iem, target: Profile): number {
  let sum = 0
  let w = 0
  for (const b of BANDS) {
    sum += WEIGHTS[b] * (iem.metrics[b] - target[b]) ** 2
    w += WEIGHTS[b]
  }
  return Math.sqrt(sum / w)
}

const GRADE: Record<string, number> = {
  'S+': 10, S: 9.5, 'S-': 9, 'A+': 8.5, A: 8, 'A-': 7.5, 'B+': 7, B: 6.5, 'B-': 6, 'C+': 5.5, C: 5, 'C-': 4.5, D: 4, FAIL: 3,
}

/** "A+/S-" -> 8.75. Unknown -> null. */
export function gradeValue(g: string | null | undefined): number | null {
  if (!g) return null
  const parts = g.toUpperCase().split('/').map((p) => GRADE[p.trim()]).filter((v) => v !== undefined)
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

/**
 * Rough separation estimate 0–10. Uses the reviewer's tech grade when there is one;
 * otherwise a graph proxy (clean upper mids, little mid-bass bleed, some air). An estimate only.
 */
export function separationEstimate(iem: Iem, reviews: Review[]): { value: number; fromReview: boolean } {
  const m = iem.metrics
  const bleed = Math.max(0, m.midBass - m.subBass - 1)
  const proxy = Math.min(10, Math.max(0, 5 + 0.4 * (m.upperMids + 0.5 * m.lowerTreble) - 0.6 * bleed + 0.3 * m.air))
  const tech = reviews.map((r) => gradeValue(r.jay.tech)).find((v) => v !== null)
  return tech != null ? { value: 0.7 * tech + 0.3 * proxy, fromReview: true } : { value: proxy, fromReview: false }
}

/** Jay's entry that fits the user's volume best ("MID-VOLUME", "HIGH-VOLUME", "MID/HIGH-VOLUME"). */
export function reviewForVolume(reviews: Review[], volume: Preferences['volume']): Review | null {
  if (!reviews.length) return null
  const word = volume.toUpperCase()
  return reviews.find((r) => r.jay.volume?.toUpperCase().includes(word)) ?? reviews[0]
}

export interface Scored {
  iem: Iem
  score: number
  distanceDb: number
  price: number | null
  reasons: string[]
  warnings: string[]
}

export function scoreIem(c: Catalog, iem: Iem, prefs: Preferences, target: Profile): Scored {
  const reasons: string[] = []
  const warnings: string[] = []
  const d = tonalDistance(iem, target)
  let score = 100 * Math.exp(-d / 4)
  if (d < 1.5) reasons.push('very close to the sound you asked for')
  else if (d < 3) reasons.push('close to the sound you asked for')

  if (prefs.current.sibilant && (iem.metrics.lowerTreble > 1.8 || iem.metrics.air > 2.2)) {
    score -= 8
    warnings.push('bright treble (pushed down per your ear sensitivity)')
  }

  const reviews = reviewsOf(c, iem.id)
  const jay = reviewForVolume(reviews, prefs.volume)
  if (jay?.jay.score != null) {
    score += jay.jay.score
    if (jay.jay.score >= 8) reasons.push(`Jay rates it ${jay.jay.score}/10`)
  }
  if (jay?.jay.volume && jay.jay.volume.toUpperCase().includes(prefs.volume.toUpperCase())) {
    score += 3
    reasons.push(`Jay recommends it at ${prefs.volume} volume`)
  }
  if (jay?.jay.flags.includes('notRecommended')) {
    score -= 15
    warnings.push('Jay: not recommended')
  }

  const tags = new Set(prefs.genres.flatMap((g) => GENRE_TAGS[g] ?? []))
  if (jay && tags.size) {
    const good = jay.keywords.goodFor.filter((k) => tags.has(k.tag)).map((k) => k.tag)
    const bad = jay.keywords.notFor.filter((k) => tags.has(k.tag)).map((k) => k.tag)
    score += 4 * good.length - 4 * bad.length
    if (good.length) reasons.push(`good for ${good.join(', ')}`)
    if (bad.length) warnings.push(`not for ${bad.join(', ')}`)
  }

  if (prefs.mode === 'iem' && prefs.separation > 0) {
    const sep = separationEstimate(iem, reviews)
    score += prefs.separation * 2 * (sep.value - 5)
    if (sep.value >= 7) reasons.push(`good separation (${sep.fromReview ? "Jay's tech grade" : 'graph estimate'})`)
  }

  if (c.images[iem.id]) score += 3 // looks better in the bracket
  const price = priceOf(c, iem.id)?.usd ?? null
  return { iem, score, distanceDb: d, price, reasons, warnings }
}

/** Ranked candidates: within budget, filters applied, one variant per model. */
export function rankCandidates(c: Catalog, prefs: Preferences): Scored[] {
  const current = prefs.currentId ? c.byId.get(prefs.currentId) ?? null : null
  const target = targetProfile(prefs, current)
  const best = new Map<string, Scored>()
  for (const iem of c.data.iems) {
    if (iem.id === prefs.currentId) continue
    if (isAirline(iem)) continue
    if (!prefs.includePrototypes && isPrototype(iem)) continue
    if (!prefs.includeCiems && isCiem(iem)) continue
    if (!prefs.includeModded && isModded(iem)) continue
    if (!matchesHpType(iem, prefs.hpType)) continue
    const reviews = reviewsOf(c, iem.id)
    if (!prefs.includeNotRec && reviews.some((r) => r.jay.flags.includes('notRecommended'))) continue
    if (!prefs.includeDiscontinued && reviews.length && reviews.every((r) => r.jay.discontinued)) continue
    const price = priceOf(c, iem.id)?.usd ?? null
    // most headphones have no price on file: an unpriced one isn't left out of a headphone bracket
    if (price === null ? !prefs.includeUnpriced && c.kind !== 'headphones' : price < prefs.budget[0] || price > prefs.budget[1]) continue
    const s = scoreIem(c, iem, prefs, target)
    const key = modelKey(iem.name)
    if (!best.has(key) || best.get(key)!.score < s.score) best.set(key, s)
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score)
  if (c.kind !== 'headphones') return ranked
  // headphones with a price in your budget come first; the many unpriced ones fill in after
  const priced = (s: Scored) => (priceOf(c, s.iem.id) ? 0 : 1)
  return ranked.sort((a, b) => priced(a) - priced(b) || b.score - a.score)
}

/** Next budget band ceiling for the "Stretch Pick" rule (GDD Section 4 & 5). */
function stretchCeiling(maxBudget: number): number {
  if (maxBudget <= 50) return 150
  if (maxBudget <= 150) return 400
  if (maxBudget <= 400) return 1000
  return 2500
}

export type SlotRole = 'yours' | 'stretch' | 'darkhorse' | 'pick'

/**
 * Implements the exact "You choose" roster builder from GDD Section 5:
 * - Current IEM takes Seed #1 ("yours") if named.
 * - Top scorers within budget, with at most 2 from the same brand.
 * - At most 1 "Stretch Pick" one band above budget if it scores higher than the bottom pick.
 * - 1 "Dark Horse": a well-rated IEM from a different flavour than the one you picked.
 */
export function pickGameRoster(
  c: Catalog,
  prefs: Preferences,
  existingIds: (string | null)[] = [],
): { ids: string[]; roles: Record<string, SlotRole> } {
  const size = prefs.size
  const roles: Record<string, SlotRole> = {}
  const chosen: string[] = []
  const brandCounts = new Map<string, number>()

  const add = (id: string, role: SlotRole) => {
    if (chosen.includes(id)) return false
    const iem = c.byId.get(id)
    if (!iem) return false
    const b = brandOf(iem)
    if (role !== 'yours' && (brandCounts.get(b) ?? 0) >= 2) return false
    chosen.push(id)
    roles[id] = role
    brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1)
    return true
  }

  // Keep any manually pre-filled slots first
  for (const id of existingIds) {
    if (id && c.byId.get(id)) {
      add(id, id === prefs.currentId ? 'yours' : 'pick')
    }
  }

  // 1. Current IEM joins as Seed #1 ("yours") if named and includeCurrent is true
  if (prefs.includeCurrent && prefs.currentId && c.byId.get(prefs.currentId) && !chosen.includes(prefs.currentId)) {
    chosen.unshift(prefs.currentId)
    roles[prefs.currentId] = 'yours'
    const b = brandOf(c.byId.get(prefs.currentId)!)
    brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1)
  }

  const ranked = rankCandidates(c, prefs)
  const userFlavour = prefs.flavour ?? 'neutral'

  // Reserve 1 slot for Dark Horse and optionally 1 slot for Stretch Pick
  const reserveSlots = chosen.length < size ? 1 : 0
  const mainTarget = Math.max(0, size - reserveSlots)

  for (const s of ranked) {
    if (chosen.length >= mainTarget) break
    add(s.iem.id, 'pick')
  }

  // Try to add 1 Dark Horse (well-rated IEM from a different flavour within budget)
  if (chosen.length < size) {
    const darkHorse = ranked.find((s) => {
      if (chosen.includes(s.iem.id)) return false
      const fl = classifyFlavour(s.iem).id
      return fl !== userFlavour && (brandCounts.get(brandOf(s.iem)) ?? 0) < 2
    })
    if (darkHorse) {
      add(darkHorse.iem.id, 'darkhorse')
    }
  }

  // Optional Stretch Pick (at most 1 from one band above budget if we still have room or to replace last pick)
  if (prefs.budget[1] < 1000) {
    const stretchRanked = rankCandidates(c, {
      ...prefs,
      budget: [prefs.budget[1] + 1, stretchCeiling(prefs.budget[1])],
    })
    const bestStretch = stretchRanked.find((s) => !chosen.includes(s.iem.id) && (brandCounts.get(brandOf(s.iem)) ?? 0) < 2)
    if (bestStretch) {
      if (chosen.length < size) {
        add(bestStretch.iem.id, 'stretch')
      } else if (chosen.length === size && size >= 8) {
        // Swap into the second-to-last slot so there's 1 stretch pick in the field
        const replaceIdx = chosen.findIndex((id) => roles[id] === 'pick' && id !== prefs.currentId)
        if (replaceIdx >= 0) {
          const lastPickIdx = chosen.map((id, i) => (roles[id] === 'pick' ? i : -1)).filter((i) => i >= 0).pop()!
          const removedId = chosen[lastPickIdx]
          delete roles[removedId]
          chosen[lastPickIdx] = bestStretch.iem.id
          roles[bestStretch.iem.id] = 'stretch'
        }
      }
    }
  }

  // Fill any remaining slots from ranked list (relaxing brand cap if needed)
  for (const s of ranked) {
    if (chosen.length >= size) break
    if (!chosen.includes(s.iem.id)) {
      chosen.push(s.iem.id)
      roles[s.iem.id] = 'pick'
    }
  }

  // Band too thin: fill from cheaper IEMs below the band before widening further
  if (chosen.length < size && prefs.budget[0] > 0) {
    for (const s of rankCandidates(c, { ...prefs, budget: [0, prefs.budget[1]] })) {
      if (chosen.length >= size) break
      if (!chosen.includes(s.iem.id)) {
        chosen.push(s.iem.id)
        roles[s.iem.id] = 'pick'
      }
    }
  }

  // Fallback if budget was super narrow: widen budget so every slot is guaranteed full
  if (chosen.length < size) {
    const wide = rankCandidates(c, { ...prefs, budget: [0, 10000], includeUnpriced: true })
    for (const s of wide) {
      if (chosen.length >= size) break
      if (!chosen.includes(s.iem.id)) {
        chosen.push(s.iem.id)
        roles[s.iem.id] = 'pick'
      }
    }
  }

  return { ids: chosen.slice(0, size), roles }
}

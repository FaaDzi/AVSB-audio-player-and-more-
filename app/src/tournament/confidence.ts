import type { Band, Iem } from '../audio/data'
import { entrantsOf, type Bracket, type MatchResult } from './bracket'

/**
 * How sure the bracket's result is, from the picks themselves (HEADPHONE_SIM_RESEARCH.md §3.3).
 * The Padua study screened listeners with two identical control tracks; a bracket has natural
 * controls: a rematch (double elimination brings some pairs back) whose winner flipped, and
 * best-of matches whose rounds split. Pairs whose tunings differ by under 1 dB in every band are
 * coin flips whatever the ears: the device you wear adds more than that.
 */
export interface Confidence {
  level: 'solid' | 'mixed' | 'shaky'
  matches: number
  /** Best-of matches where the loser won at least one round. */
  split: number
  rematches: number
  /** Rematches whose winner differed from the first meeting. */
  flips: number
  /** Matches between near-identical tunings. */
  nearIdentical: number
  lines: string[]
}

export const NEAR_IDENTICAL_DB = 1

/** Largest per-band difference between two tunings (dB, from their band metrics). */
export function tuningGapDb(a: Pick<Iem, 'metrics'>, b: Pick<Iem, 'metrics'>): number {
  return Math.max(...(Object.keys(a.metrics) as Band[]).map((k) => Math.abs(a.metrics[k] - b.metrics[k])))
}

export function bracketConfidence(
  bracket: Bracket,
  results: Record<string, MatchResult>,
  entrants: string[],
  byId: (id: string) => Pick<Iem, 'metrics'> | undefined,
): Confidence {
  let matches = 0
  let multi = 0
  let split = 0
  let nearIdentical = 0
  const meetings = new Map<string, string[]>() // pair -> winner of each meeting, in play order
  for (const m of [...bracket.matches].sort((x, y) => x.playOrder - y.playOrder)) {
    const r = results[m.id]
    if (!r) continue
    const [s0, s1] = entrantsOf(bracket, m, results)
    if (!s0 || !s1) continue
    const pair = [entrants[s0 - 1], entrants[s1 - 1]]
    matches++
    if (r.wins[0] + r.wins[1] > 1) {
      multi++
      if (Math.min(...r.wins) > 0) split++
    }
    const [a, b] = pair.map(byId)
    if (a && b && tuningGapDb(a, b) < NEAR_IDENTICAL_DB) nearIdentical++
    const key = [...pair].sort().join('|')
    meetings.set(key, [...(meetings.get(key) ?? []), pair[r.winner]])
  }
  const repeated = [...meetings.values()].filter((w) => w.length > 1)
  const flips = repeated.filter((w) => new Set(w).size > 1).length

  const lines: string[] = []
  if (flips) {
    lines.push(`In ${flips} rematch${flips === 1 ? '' : 'es'} you picked the other side the second time: those two are too close to call.`)
  }
  if (multi && split / multi > 0.5) {
    lines.push(`${split} of ${multi} matches went the distance with split rounds, so the places below the champion are close.`)
  }
  if (nearIdentical) {
    lines.push(`${nearIdentical} match${nearIdentical === 1 ? '' : 'es'} pitted near-identical tunings (under ${NEAR_IDENTICAL_DB} dB apart): coin flips, whatever your ears.`)
  }
  const level = flips > 1 || (flips && multi && split / multi > 0.5) ? 'shaky' : lines.length ? 'mixed' : 'solid'
  if (!lines.length) lines.push(repeated.length ? 'Consistent: every rematch went the same way, and most matches were clear wins.' : 'Consistent: most matches were clear wins.')
  return { level, matches, split, rematches: repeated.length, flips, nearIdentical, lines }
}

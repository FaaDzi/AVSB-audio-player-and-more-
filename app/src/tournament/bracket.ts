/**
 * Seeded double-elimination bracket (VCT style): upper bracket, lower bracket with
 * drop-ins from each upper round, and a single grand final (no bracket reset).
 * Sizes 4, 8, 16 → 2N−2 matches.
 */

import type { SpatialMode } from '../spatial/types'

export type Slot =
  | { kind: 'seed'; seed: number } // 1-based seed
  | { kind: 'winner'; match: string }
  | { kind: 'loser'; match: string }

export interface BracketMatch {
  id: string
  bracket: 'upper' | 'lower' | 'grand'
  round: number // 1-based within its bracket
  index: number // position within the round
  /** 1-based Valorant play order number (e.g. 1..14 for 8-IEM). */
  playOrder: number
  bestOf: number
  slots: [Slot, Slot]
  label: string
}

export interface MatchResult {
  winner: 0 | 1
  wins: [number, number]
  /** Spatial mode the match was heard in (the same for both sides); absent = off, or saved before it existed. */
  spatial?: SpatialMode
}

export interface Bracket {
  size: number
  matches: BracketMatch[]
}

/** The field in random seed order (Fisher-Yates), for "hide names until the results". */
export function shuffleSeeds<T>(ids: T[]): T[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Standard seed order so seeds 1 and 2 can only meet in the final: 8 → [1,8,4,5,2,7,3,6]. */
export function seedOrder(n: number): number[] {
  let order = [1]
  while (order.length < n) {
    const len = order.length * 2
    order = order.flatMap((s) => [s, len + 1 - s])
  }
  return order
}

export function buildBracket(
  size: number,
  opts: { bestOf?: number; lowerFinalBestOf?: number; grandFinalBestOf?: number } = {},
): Bracket {
  if (![4, 8, 16].includes(size)) throw new Error(`Bracket size must be 4, 8 or 16, got ${size}`)
  const bo = opts.bestOf ?? 3
  const lfBo = opts.lowerFinalBestOf ?? bo
  const gfBo = opts.grandFinalBestOf ?? 5
  const k = Math.log2(size)
  const matches: BracketMatch[] = []
  const upper: BracketMatch[][] = []

  // upper bracket
  const order = seedOrder(size)
  for (let r = 1; r <= k; r++) {
    const round: BracketMatch[] = []
    const count = size >> r
    for (let i = 0; i < count; i++) {
      const slots: [Slot, Slot] =
        r === 1
          ? [{ kind: 'seed', seed: order[2 * i] }, { kind: 'seed', seed: order[2 * i + 1] }]
          : [{ kind: 'winner', match: upper[r - 2][2 * i].id }, { kind: 'winner', match: upper[r - 2][2 * i + 1].id }]
      round.push({
        id: `U${r}-${i + 1}`,
        bracket: 'upper',
        round: r,
        index: i,
        playOrder: 0,
        bestOf: bo,
        slots,
        label: r === k ? 'Upper final' : r === k - 1 ? 'Upper semi' : `Upper R${r}`,
      })
    }
    upper.push(round)
    matches.push(...round)
  }

  // lower bracket: 2(k−1) rounds. Odd rounds pair lower survivors (round 1: upper round-1 losers);
  // even rounds take a drop-in from the next upper round (reversed to avoid quick rematches).
  const lowerRounds = 2 * (k - 1)
  const lower: BracketMatch[][] = []
  let prev: Slot[] = upper[0].map((m) => ({ kind: 'loser', match: m.id }) as Slot)
  for (let r = 1; r <= lowerRounds; r++) {
    const round: BracketMatch[] = []
    let slotsList: [Slot, Slot][]
    if (r === 1) {
      slotsList = []
      for (let i = 0; i < prev.length; i += 2) slotsList.push([prev[i], prev[i + 1]])
    } else if (r % 2 === 0) {
      const drops = upper[r / 2].map((m) => ({ kind: 'loser', match: m.id }) as Slot).reverse()
      slotsList = prev.map((s, i) => [s, drops[i]] as [Slot, Slot])
    } else {
      slotsList = []
      for (let i = 0; i < prev.length; i += 2) slotsList.push([prev[i], prev[i + 1]])
    }
    const isLowerFinal = r === lowerRounds
    slotsList.forEach((slots, i) => {
      round.push({
        id: `L${r}-${i + 1}`,
        bracket: 'lower',
        round: r,
        index: i,
        playOrder: 0,
        bestOf: isLowerFinal ? lfBo : bo,
        slots,
        label: isLowerFinal ? 'Lower final' : r === lowerRounds - 1 ? 'Lower semi' : `Lower R${r}`,
      })
    })
    lower.push(round)
    matches.push(...round)
    prev = round.map((m) => ({ kind: 'winner', match: m.id }) as Slot)
  }

  const gf: BracketMatch = {
    id: 'GF',
    bracket: 'grand',
    round: 1,
    index: 0,
    playOrder: 0,
    bestOf: gfBo,
    label: 'Grand final',
    slots: [{ kind: 'winner', match: upper[k - 1][0].id }, prev[0]],
  }
  matches.push(gf)

  // Assign official Valorant playOrder (GDD Section 7):
  // Upper R1 -> Lower R1 -> Upper R2 -> Lower R2 -> ... -> Upper Final -> Lower Semi -> Lower Final -> Grand Final
  let seq = 1
  if (upper[0]) for (const m of upper[0]) m.playOrder = seq++
  if (lower[0]) for (const m of lower[0]) m.playOrder = seq++
  for (let ur = 1; ur < k; ur++) {
    if (upper[ur]) for (const m of upper[ur]) m.playOrder = seq++
    const lrDrop = 2 * ur - 1 // 1-based lower round 2*ur
    const lrSurv = 2 * ur     // 1-based lower round 2*ur + 1
    if (lower[lrDrop]) for (const m of lower[lrDrop]) m.playOrder = seq++
    if (lower[lrSurv]) for (const m of lower[lrSurv]) m.playOrder = seq++
  }
  gf.playOrder = seq

  return { size, matches }
}

/** Seed number (1-based) occupying a slot, or null if not decided yet. */
export function resolveSlot(b: Bracket, slot: Slot, results: Record<string, MatchResult>): number | null {
  if (slot.kind === 'seed') return slot.seed
  const m = b.matches.find((x) => x.id === slot.match)!
  const r = results[m.id]
  if (!r) return null
  const side = slot.kind === 'winner' ? r.winner : 1 - r.winner
  return resolveSlot(b, m.slots[side], results)
}

export function entrantsOf(b: Bracket, m: BracketMatch, results: Record<string, MatchResult>): [number | null, number | null] {
  return [resolveSlot(b, m.slots[0], results), resolveSlot(b, m.slots[1], results)]
}

/** Next match to play in official Valorant playOrder among ready unplayed matches. */
export function nextMatch(b: Bracket, results: Record<string, MatchResult>): BracketMatch | null {
  const ready = b.matches.filter((m) => !results[m.id] && entrantsOf(b, m, results).every((e) => e !== null))
  ready.sort((x, y) => x.playOrder - y.playOrder)
  return ready[0] ?? null
}

export function isComplete(_b: Bracket, results: Record<string, MatchResult>): boolean {
  return !!results.GF
}

/** IEM ids that have played at least one finished match (mystery mode unmasks these). */
export function playedIds(b: Bracket, results: Record<string, MatchResult>, entrants: string[]): Set<string> {
  const out = new Set<string>()
  for (const m of b.matches) {
    if (!results[m.id]) continue
    for (const seed of entrantsOf(b, m, results)) if (seed) out.add(entrants[seed - 1])
  }
  return out
}

/** Returns a human-readable slot placeholder like "Seed 1", "W5", or "Loser 8" matching the GDD bracket diagram. */
export function describeSlot(b: Bracket, slot: Slot): string {
  if (slot.kind === 'seed') return `Seed ${slot.seed}`
  const m = b.matches.find((x) => x.id === slot.match)
  const num = m ? m.playOrder : slot.match
  return slot.kind === 'winner' ? `Winner of ${num}` : `Loser of ${num}`
}

/** Returns all matches played by a given 1-based seed in chronological order. */
export function pathOfSeed(
  b: Bracket,
  results: Record<string, MatchResult>,
  seed: number,
): { match: BracketMatch; opponentSeed: number; won: boolean; myWins: number; oppWins: number }[] {
  const ordered = [...b.matches].sort((a, c) => a.playOrder - c.playOrder)
  const out: { match: BracketMatch; opponentSeed: number; won: boolean; myWins: number; oppWins: number }[] = []
  for (const m of ordered) {
    const r = results[m.id]
    if (!r) continue
    const [s0, s1] = entrantsOf(b, m, results)
    if (s0 === seed || s1 === seed) {
      const mySide = s0 === seed ? 0 : 1
      const oppSeed = (mySide === 0 ? s1 : s0)!
      out.push({
        match: m,
        opponentSeed: oppSeed,
        won: r.winner === mySide,
        myWins: r.wins[mySide],
        oppWins: r.wins[1 - mySide],
      })
    }
  }
  return out
}

/**
 * Final placings once complete: [{place, seeds}] — 1st, 2nd, 3rd (lower-final loser),
 * 4th (lower-semi loser), then shared places by the lower round they fell in.
 */
export function placings(b: Bracket, results: Record<string, MatchResult>): { place: string; seeds: number[] }[] {
  if (!isComplete(b, results)) return []
  const gf = b.matches.find((m) => m.id === 'GF')!
  const [a, c] = entrantsOf(b, gf, results)
  const out = [
    { place: '1st', seeds: [results.GF.winner === 0 ? a! : c!] },
    { place: '2nd', seeds: [results.GF.winner === 0 ? c! : a!] },
  ]
  const lower = b.matches.filter((m) => m.bracket === 'lower')
  const maxRound = Math.max(...lower.map((m) => m.round))
  let next = 3
  for (let r = maxRound; r >= 1; r--) {
    const losers = lower
      .filter((m) => m.round === r)
      .map((m) => resolveSlot(b, m.slots[1 - results[m.id].winner], results)!)
    const place = losers.length === 1 ? ordinal(next) : `${ordinal(next)}–${ordinal(next + losers.length - 1)}`
    out.push({ place, seeds: losers })
    next += losers.length
  }
  return out
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

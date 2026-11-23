/**
 * A single-elimination bracket over a few candidates (the HRTF picker's "which sounds more outside
 * your head" rounds): neighbours meet in order, winners meet in the next round, an odd one out gets
 * a bye. n candidates take n − 1 picks.
 */
export interface Knockout {
  /** This round's entrants, in meeting order. */
  pool: string[]
  /** Winners so far this round. */
  winners: string[]
  /** Index in `pool` of the next pair's first entrant. */
  at: number
  /** Picks made so far. */
  picks: number
}

/** Fisher–Yates shuffle with an injectable random source. */
export function shuffled<T>(xs: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Moves past byes and finished rounds until a pair is due or one entrant is left. */
function settle(k: Knockout): Knockout {
  let { pool, winners, at } = k
  for (;;) {
    if (pool.length <= 1) return { ...k, pool, winners: [], at: 0 }
    if (at === pool.length - 1) {
      winners = [...winners, pool[at]]
      at = pool.length
    }
    if (at >= pool.length) {
      pool = winners
      winners = []
      at = 0
      continue
    }
    return { ...k, pool, winners, at }
  }
}

/** A bracket over `ids` in a random order (duplicates dropped). */
export function startKnockout(ids: readonly string[], rand: () => number = Math.random): Knockout {
  return settle({ pool: shuffled([...new Set(ids)], rand), winners: [], at: 0, picks: 0 })
}

/** The pair to compare now, or null when the bracket is decided. */
export function currentPair(k: Knockout): [string, string] | null {
  return k.pool.length > 1 ? [k.pool[k.at], k.pool[k.at + 1]] : null
}

export function champion(k: Knockout): string | null {
  return k.pool.length === 1 ? k.pool[0] : null
}

/** Total picks a bracket over n entrants takes. */
export function totalPicks(n: number): number {
  return Math.max(0, n - 1)
}

/** Record the winner of the current pair. */
export function pick(k: Knockout, winner: string): Knockout {
  const pair = currentPair(k)
  if (!pair || !pair.includes(winner)) return k
  return settle({ ...k, winners: [...k.winners, winner], at: k.at + 2, picks: k.picks + 1 })
}

/**
 * The HRTF picker's two short rounds (scripts/build_hrirs.py groups the sets): round 1 between the
 * group heads, round 2 inside the winner's group. 16 sets in groups of 4 take 3 + 3 picks instead of 15.
 * Sets without a group (an older index, your imported SOFA) are heads of their own one-set group.
 */
export function twoRounds(entries: readonly { id: string; group?: string }[]): { heads: string[]; members: (head: string) => string[] } {
  const ids = new Set(entries.map((e) => e.id))
  const headOf = (e: { id: string; group?: string }) => (e.group && ids.has(e.group) ? e.group : e.id)
  const heads = [...new Set(entries.map(headOf))]
  return { heads, members: (head) => entries.filter((e) => headOf(e) === head).map((e) => e.id) }
}

/**
 * §108: the whole HRTF test. Round 1: the group heads. Round 2: the winning group plus the runner-up group's
 * head, so a group that lost a close final still has a say. Round 3, the final check: best of three between the
 * winner and its closest rival (the one it tied with on "Same", else the round-2 final's loser, whose final
 * already counts as the first vote). "Same" moves the first of the pair on and counts as no vote.
 */
export interface HrtfTest {
  round: 1 | 2 | 3
  ko: Knockout
  /** Picks made in the finished rounds 1 and 2. */
  before: number
  /** Round 2: who went on after a "Same", and the set it tied with. */
  tieOf: Record<string, string>
  /** `carried`: 1 when the round-2 final already counts as the first vote. */
  final: { champ: string; rival: string; champVotes: number; rivalVotes: number; asked: number; carried: number } | null
  winner: string | null
}

type Plan = { heads: string[]; members: (head: string) => string[] }

export function startHrtfTest(plan: Plan, rand: () => number = Math.random): HrtfTest {
  const t: HrtfTest = { round: 1, ko: startKnockout(plan.heads, rand), before: 0, tieOf: {}, final: null, winner: null }
  return champion(t.ko) ? toRound2(t, plan, champion(t.ko)!, null, rand) : t
}

/** The two sets to compare now (unordered: the UI shuffles A and B), or null once there's a winner. */
export function hrtfPair(t: HrtfTest): [string, string] | null {
  if (t.winner) return null
  return t.final ? [t.final.champ, t.final.rival] : currentPair(t.ko)
}

/** Picks made so far, and about how many the whole test takes (one more shows up if the final needs a third listen). */
export function hrtfProgress(t: HrtfTest, plan: Plan): { done: number; of: number } {
  const done = t.before + (t.final ? t.final.asked - t.final.carried : t.ko.picks)
  const groupSize = Math.max(1, ...plan.heads.map((h) => plan.members(h).length))
  const base = totalPicks(plan.heads.length) + (plan.heads.length > 1 ? groupSize : groupSize - 1) + 1
  return { done, of: Math.max(base, done + (t.winner ? 0 : 1)) }
}

function toRound2(t: HrtfTest, plan: Plan, won: string, runnerUp: string | null, rand: () => number): HrtfTest {
  const entrants = [...plan.members(won), ...(runnerUp && !plan.members(won).includes(runnerUp) ? [runnerUp] : [])]
  const before = t.before + t.ko.picks
  if (entrants.length < 2) return { ...t, before, winner: entrants[0] ?? won }
  return { ...t, round: 2, before, ko: startKnockout(entrants, rand), tieOf: {} }
}

/** Records an answer: the chosen set's id, or null for "Same". */
export function answerHrtf(t: HrtfTest, chosen: string | null, plan: Plan, rand: () => number = Math.random): HrtfTest {
  const pair = hrtfPair(t)
  if (!pair || (chosen !== null && !pair.includes(chosen))) return t
  if (t.final) {
    const f = { ...t.final, asked: t.final.asked + 1 }
    if (chosen === f.champ) f.champVotes++
    else if (chosen === f.rival) f.rivalVotes++
    const winner =
      f.champVotes >= 2 ? f.champ : f.rivalVotes >= 2 ? f.rival : f.asked >= 3 ? (f.rivalVotes > f.champVotes ? f.rival : f.champ) : null
    return { ...t, final: f, winner }
  }
  const goesOn = chosen ?? pair[0]
  const other = pair[0] === goesOn ? pair[1] : pair[0]
  const ko = pick(t.ko, goesOn)
  const tieOf = chosen === null && t.round === 2 ? { ...t.tieOf, [goesOn]: other } : t.tieOf
  const next = { ...t, ko, tieOf }
  const won = champion(ko)
  if (!won) return next
  if (t.round === 1) return toRound2(next, plan, won, other, rand)
  // round 2 is decided: the final check against the closest rival
  const rival = tieOf[won] ?? other
  const counted = chosen !== null && rival === other
  return {
    ...next,
    round: 3,
    before: t.before + ko.picks,
    final: { champ: won, rival, champVotes: counted ? 1 : 0, rivalVotes: 0, asked: counted ? 1 : 0, carried: counted ? 1 : 0 },
  }
}

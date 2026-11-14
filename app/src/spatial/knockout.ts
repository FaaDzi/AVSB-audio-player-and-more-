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

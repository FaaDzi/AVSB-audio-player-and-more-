import { entrantsOf, pathOfSeed, placings, type Bracket, type MatchResult } from './bracket'

/**
 * The awards row under the podium: one IEM each, from the whole bracket (podium or not). Any
 * entrant can take one, including for losing; the rare ones come in tiers so they stay rare.
 */
export interface Awards {
  /** The win where the cheaper IEM beat the dearer one by the most dollars. */
  goliath: { seed: number; price: number; beat: number; beatPrice: number } | null
  /** The lowest seed that finished best (places above its seed). Not given with random seeds. */
  darkHorse: { seed: number; place: string; climbed: number } | null
  /** The loser of the closest match that went the distance (latest one wins ties). */
  heartbreak: { seed: number; to: number; score: [number, number]; label: string } | null
  /** Songs won ÷ songs played over the tournament: 100 % flawless, 95 % dominating, 90 % favourite. */
  pickRate: { seed: number; tier: PickTier; won: number; played: number } | null
  /** Lost its first match, won at least two after it, and finished top 5: won it all, podium, or top 5. */
  comeback: { seed: number; tier: ComebackTier; place: string } | null
}
export type PickTier = 'flawless' | 'dominating' | 'favourite'
export type ComebackTier = 'perfect' | 'great' | 'comeback'

/** Fewer songs than this and a pick rate says nothing. */
const PICK_MIN_PLAYED = 4
/** A dark horse has to finish at least this many places above its seed. */
const DARK_HORSE_MIN = 2
/**
 * Wins after losing its opening match that make a comeback. A later first loss doesn't count:
 * losing an upper semi or final and winning a lower match or two is the usual road to 2nd–4th.
 */
const COMEBACK_WINS = 2

export function pickTier(won: number, played: number): PickTier | null {
  if (played < PICK_MIN_PLAYED) return null
  const r = won / played
  return r >= 1 ? 'flawless' : r >= 0.95 ? 'dominating' : r >= 0.9 ? 'favourite' : null
}

export function computeAwards(
  bracket: Bracket,
  results: Record<string, MatchResult>,
  seeds: number,
  opts: { priceOf: (seed: number) => number | null | undefined; randomSeeds?: boolean },
): Awards {
  const places = placings(bracket, results)
  // each seed's finish: the first place number of its group ("5th–6th" → 5)
  const rank = new Map<number, { rank: number; place: string }>()
  let n = 1
  for (const p of places) {
    for (const s of p.seeds) rank.set(s, { rank: n, place: p.place })
    n += p.seeds.length
  }
  const better = (a: number, b: number) => (rank.get(a)?.rank ?? 99) - (rank.get(b)?.rank ?? 99)

  let goliath: Awards['goliath'] = null
  let heartbreak: (Awards['heartbreak'] & { order: number; gap: number }) | null = null
  for (const m of bracket.matches) {
    const r = results[m.id]
    if (!r) continue
    const [s0, s1] = entrantsOf(bracket, m, results)
    if (!s0 || !s1) continue
    const pair = [s0, s1]
    const [w, l] = [pair[r.winner], pair[1 - r.winner]]
    const [wp, lp] = [opts.priceOf(w), opts.priceOf(l)]
    if (wp != null && lp != null && lp > wp && lp - wp > (goliath ? goliath.beatPrice - goliath.price : 0)) {
      goliath = { seed: w, price: wp, beat: l, beatPrice: lp }
    }
    // a heartbreak needs a real decider: best of 3 or more, every song played
    const gap = r.wins[r.winner] - r.wins[1 - r.winner]
    const distance = m.bestOf >= 3 && r.wins[0] + r.wins[1] === m.bestOf
    if (distance && (!heartbreak || gap < heartbreak.gap || (gap === heartbreak.gap && m.playOrder > heartbreak.order))) {
      heartbreak = { seed: l, to: w, score: [r.wins[1 - r.winner], r.wins[r.winner]], label: m.label, order: m.playOrder, gap }
    }
  }

  let darkHorse: Awards['darkHorse'] = null
  if (!opts.randomSeeds) {
    for (let s = 1; s <= seeds; s++) {
      const f = rank.get(s)
      if (!f) continue
      const climbed = s - f.rank
      if (climbed < DARK_HORSE_MIN) continue
      if (!darkHorse || climbed > darkHorse.climbed || (climbed === darkHorse.climbed && better(s, darkHorse.seed) < 0)) {
        darkHorse = { seed: s, place: f.place, climbed }
      }
    }
  }

  let pickRate: Awards['pickRate'] = null
  let comeback: Awards['comeback'] = null
  const TIER_ORDER: PickTier[] = ['flawless', 'dominating', 'favourite']
  const COMEBACK_ORDER: ComebackTier[] = ['perfect', 'great', 'comeback']
  for (let s = 1; s <= seeds; s++) {
    const path = pathOfSeed(bracket, results, s)
    const won = path.reduce((a, p) => a + p.myWins, 0)
    const played = path.reduce((a, p) => a + p.myWins + p.oppWins, 0)
    const tier = pickTier(won, played)
    if (tier) {
      const t = TIER_ORDER.indexOf(tier)
      const have = pickRate ? TIER_ORDER.indexOf(pickRate.tier) : 99
      if (t < have || (t === have && pickRate && (won > pickRate.won || (won === pickRate.won && better(s, pickRate.seed) < 0)))) {
        pickRate = { seed: s, tier, won, played }
      }
    }
    const f = rank.get(s)
    if (path[0] && !path[0].won && f && f.rank <= 5 && path.filter((p) => p.won).length >= COMEBACK_WINS) {
      const ct: ComebackTier = f.rank === 1 ? 'perfect' : f.rank <= 3 ? 'great' : 'comeback'
      if (!comeback || COMEBACK_ORDER.indexOf(ct) < COMEBACK_ORDER.indexOf(comeback.tier) || better(s, comeback.seed) < 0) {
        comeback = { seed: s, tier: ct, place: f.place }
      }
    }
  }

  return {
    goliath,
    darkHorse,
    heartbreak: heartbreak && { seed: heartbreak.seed, to: heartbreak.to, score: heartbreak.score, label: heartbreak.label },
    pickRate,
    comeback,
  }
}

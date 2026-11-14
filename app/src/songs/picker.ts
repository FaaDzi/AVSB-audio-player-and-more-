import { FAVORITE_WEIGHT } from './favorites'
import { genreGroup } from './genres'
import type { LibrarySong } from './library'
import { getHiddenFolderKeys, getStoredOwnMusicMix, isSongHidden, type OwnMusicMix } from './phoneLibrary'

/** Share of picks that go to the genres you chose (the rest keeps other genres in the mix). */
export const CHOSEN_SHARE = 0.8

export interface PickOptions {
  /** Genre tags you chose (questionnaire sheet 7). None: every genre group is equally likely. */
  genres?: string[]
  /** Song ids each entrant has already been heard on; avoided when possible. */
  heardBy?: Record<string, Set<string>>
  entrants?: string[]
  /** Categories already played in this match. */
  avoidCategories?: string[]
  /** Favourite song ids; each gets a slightly higher chance. */
  favorites?: Set<string>
  rng?: () => number
  /** Mix ratio of own music in testing: 0 (0%), 0.25 (25%), 0.5 (50%), 0.75 (75%), 1 (100%). */
  ownMusicMix?: OwnMusicMix
  /** Hidden folders to strictly exclude from picks. Defaults to stored hidden folders. */
  hiddenFolders?: Set<string>
}

/**
 * Pick `count` songs for one match ("map pool"): every song from a different category
 * where the library allows it, avoiding songs either entrant has already been judged on.
 *
 * Genres are balanced by group (songs/genres.ts), not by song count: with no genres chosen
 * each group is equally likely; with some chosen they get CHOSEN_SHARE of the picks between
 * them and every other group shares the rest, so nothing is ever excluded.
 *
 * Own songs are filtered to strictly exclude hidden folders, and mixed according to `ownMusicMix`.
 */
export function pickSongs(library: LibrarySong[], count: number, opts: PickOptions = {}): LibrarySong[] {
  const rng = opts.rng ?? Math.random
  const hidden = opts.hiddenFolders ?? getHiddenFolderKeys()

  // 1. Strictly exclude songs in hidden folders
  const eligible = library.filter((s) => {
    if (s.phone?.folder && (hidden.has(s.phone.folder) || isSongHidden(s))) {
      return false
    }
    return true
  })

  // 2. Partition eligible pool
  const ownPool = eligible.filter((s) => !!s.phone)
  const ourPool = eligible.filter((s) => !s.phone)

  const mix: number =
    opts.ownMusicMix !== undefined
      ? opts.ownMusicMix
      : ourPool.length === 0
        ? 1
        : ownPool.length === 0
          ? 0
          : getStoredOwnMusicMix()

  const heard = new Set((opts.entrants ?? []).flatMap((e) => [...(opts.heardBy?.[e] ?? [])]))
  const weight = genreBalance(eligible, opts.genres ?? [], (s) => (opts.favorites?.has(s.id) ? FAVORITE_WEIGHT : 1))

  const picked: LibrarySong[] = []
  const usedCats = new Set<string>(opts.avoidCategories)

  for (let n = 0; n < count; n++) {
    const remainingEligible = eligible.filter((s) => !picked.includes(s))
    if (remainingEligible.length === 0) break

    const ownRemaining = remainingEligible.filter((s) => !!s.phone)
    const ourRemaining = remainingEligible.filter((s) => !s.phone)

    let candidatePool: LibrarySong[] = []

    if (mix === 0) {
      candidatePool = ourRemaining
    } else if (mix === 1) {
      candidatePool = ownRemaining.length > 0 ? ownRemaining : ourRemaining
    } else {
      const wantOwn = rng() < mix
      if (wantOwn) {
        candidatePool = ownRemaining.length > 0 ? ownRemaining : ourRemaining
      } else {
        candidatePool = ourRemaining.length > 0 ? ourRemaining : ownRemaining
      }
    }

    if (candidatePool.length === 0) {
      if (mix === 0) break // Strictly no own songs when mix is 0%
      candidatePool = remainingEligible
    }
    if (candidatePool.length === 0) break

    // strictest pool first: new category + unheard → new category → unheard → anything
    const pools = [
      candidatePool.filter((s) => (s.category === 'any' || !usedCats.has(s.category)) && !heard.has(s.id)),
      candidatePool.filter((s) => s.category === 'any' || !usedCats.has(s.category)),
      candidatePool.filter((s) => !heard.has(s.id)),
      candidatePool,
    ]
    const pool = pools.find((p) => p.length > 0)!
    const song = weightedPick(pool, weight, rng)
    picked.push(song)
    usedCats.add(song.category)
  }
  return picked
}

/**
 * Weight per song so that each genre group gets an equal share (or the chosen groups
 * CHOSEN_SHARE between them), split evenly over that group's songs in `library`.
 */
export function genreBalance(library: LibrarySong[], chosen: string[], extra: (s: LibrarySong) => number): (s: LibrarySong) => number {
  if (library.length === 0) return () => 1
  const chosenTags = new Set(chosen)
  // a song counts as chosen by its own tag (a tag can sit in two groups, e.g. rhythm-game)
  const key = (s: LibrarySong) => `${chosenTags.has(s.genre) ? 'c' : 'o'}:${genreGroup(s.genre)}`
  const sizes = new Map<string, number>()
  for (const s of library) sizes.set(key(s), (sizes.get(key(s)) ?? 0) + 1)
  const groups = [...sizes.keys()]
  const nChosen = groups.filter((g) => g.startsWith('c:')).length
  const nOther = groups.length - nChosen
  const share = (g: string) =>
    !nChosen || !nOther ? 1 / groups.length : g.startsWith('c:') ? CHOSEN_SHARE / nChosen : (1 - CHOSEN_SHARE) / nOther
  return (s) => (share(key(s)) / (sizes.get(key(s)) || 1)) * extra(s)
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0)
  if (total <= 0) {
    const idx = Math.floor(rng() * items.length)
    return items[Math.min(idx, items.length - 1)]
  }
  let r = rng() * total
  for (const t of items) {
    r -= weight(t)
    if (r <= 0) return t
  }
  return items[items.length - 1]
}

import type { Track } from './library'

/** Where Back and Forward go while shuffling: the songs actually heard, not another random pick. */
export class PlayHistory {
  private behind: Track[] = []
  private ahead: Track[] = []

  /** Moving on to a new song from `from`. */
  visit(from: Track) {
    this.behind.push(from)
    if (this.behind.length > 500) this.behind.shift()
    this.ahead = []
  }

  goBack(current: Track): Track | null {
    const previous = this.behind.pop()
    if (!previous) return null
    this.ahead.push(current)
    return previous
  }

  goForward(current: Track): Track | null {
    const next = this.ahead.pop()
    if (!next) return null
    this.behind.push(current)
    return next
  }

  peekForward(): Track | null {
    return this.ahead[this.ahead.length - 1] ?? null
  }

  /** Ids heard lately, so a shuffle doesn't repeat them while there's anything else to play. */
  recentIds(count: number): Set<string> {
    return new Set(this.behind.slice(-count).map((t) => t.id))
  }
}

/** The list a shuffle picks from: without what was just heard, unless that leaves nothing. */
export function freshPicks(list: Track[], current: Track, history: PlayHistory): Track[] {
  const recent = history.recentIds(Math.floor(list.length / 2))
  const fresh = list.filter((t) => !recent.has(t.id) && t.id !== current.id)
  return fresh.length ? [current, ...fresh] : list
}

export interface QueueRules {
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  autoplay: boolean
}

/**
 * What plays after `current` when it ends by itself, or null to stop. `random` is injectable for tests.
 * `library` is what autoplay continues from once the queue runs out.
 */
export function nextAfterEnd(list: Track[], current: Track, rules: QueueRules, library: Track[], random = Math.random, pickAutoplay?: (others: Track[]) => Track): Track | null {
  if (rules.repeat === 'one') return current
  if (!list.length) return null
  if (rules.shuffle && list.length > 1) {
    const others = list.filter((t) => t.id !== current.id)
    return others[Math.floor(random() * others.length)]
  }
  const i = list.findIndex((t) => t.id === current.id)
  if (i >= 0 && i + 1 < list.length) return list[i + 1]
  if (rules.repeat === 'all') return list[0]
  if (rules.autoplay && library.length > 1) {
    const others = library.filter((t) => t.id !== current.id)
    return pickAutoplay ? pickAutoplay(others) : others[Math.floor(random() * others.length)]
  }
  return null
}

/** What the next and previous buttons go to. They always wrap, and repeat-one doesn't hold them back. */
export function nextByButton(list: Track[], current: Track, direction: 1 | -1, shuffle: boolean, random = Math.random): Track {
  if (!list.length) return current
  if (shuffle && list.length > 1 && direction === 1) {
    const others = list.filter((t) => t.id !== current.id)
    return others[Math.floor(random() * others.length)]
  }
  const i = list.findIndex((t) => t.id === current.id)
  return list[(i + direction + list.length) % list.length]
}

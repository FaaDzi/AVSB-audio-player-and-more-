import type { Track } from './library'
import type { SongFeatures } from './analysisCore'

/** Personal taste only counts after this many Autoplay songs, as the setting says. */
export const LEARN_AFTER = 40

export interface AutoplayInputs {
  features: (id: string) => SongFeatures | undefined
  learned: Record<string, { plays: number; skips: number }>
  /** Personalized autoplay is on and has heard enough. */
  personal: boolean
}

/** How alike two songs sound, 0 to 1. Tempo counts half and double time as close. */
export function soundLikeness(a: SongFeatures, b: SongFeatures): number {
  const ratio = Math.max(a.tempo, b.tempo) / Math.max(1, Math.min(a.tempo, b.tempo))
  const tempo = 1 - Math.min(1, Math.abs(ratio - Math.round(ratio)) * 4 + (ratio > 2.2 ? 0.5 : 0))
  const bright = 1 - Math.min(1, Math.abs(a.brightness - b.brightness) * 4)
  const energy = 1 - Math.min(1, Math.abs(a.energy - b.energy) / 12)
  return (tempo + bright + energy) / 3
}

/** Higher plays sooner. My own weighting, not read from Mornye. */
export function autoplayScore(candidate: Track, current: Track, inputs: AutoplayInputs): number {
  let score = 0
  if (candidate.artist && candidate.artist === current.artist) score += 3
  if (candidate.album && candidate.album === current.album) score += 1
  if (candidate.genre && candidate.genre === current.genre) score += 2
  const mine = inputs.features(candidate.id)
  const theirs = inputs.features(current.id)
  if (mine && theirs) score += soundLikeness(mine, theirs) * 4
  if (inputs.personal) {
    const taste = inputs.learned[candidate.id]
    if (taste) score += Math.max(-6, Math.min(4, taste.plays - taste.skips * 2))
  }
  return score
}

/** One of the best few, at random, so Autoplay doesn't play the same songs in the same order every time. */
export function pickAutoplay(others: Track[], current: Track, inputs: AutoplayInputs, random = Math.random): Track {
  const scored = others.map((t) => ({ t, score: autoplayScore(t, current, inputs) })).sort((a, b) => b.score - a.score)
  const few = scored.slice(0, Math.min(12, scored.length))
  return few[Math.floor(random() * few.length)].t
}

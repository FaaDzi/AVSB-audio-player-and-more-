import type { SongLevel } from '../audio/songLevel'

/**
 * One level for a whole album: the energy average of the songs measured so far, and the loudest peak of any of them,
 * so every song in the album moves by the same amount and none can clip. Null until one is measured.
 */
export function albumLevel(levels: (SongLevel | null | undefined)[]): SongLevel | null {
  const known = levels.filter((l): l is SongLevel => Boolean(l))
  if (!known.length) return null
  const energy = known.reduce((sum, l) => sum + 10 ** (l.lufs / 10), 0) / known.length
  return { lufs: 10 * Math.log10(energy), peak: Math.max(...known.map((l) => l.peak)) }
}

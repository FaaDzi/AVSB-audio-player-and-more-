/**
 * The genre groups the questionnaire offers (sheet 7), each covering some of the song list's
 * genre tags. Song picking balances across these groups, so a genre with 40 songs doesn't
 * crowd out one with 5. Tags in no group (funk, reggae, darkwave…) form an "other" group.
 */
export const GENRE_GROUPS: { id: string; label: string; manifestTags: string[] }[] = [
  { id: 'pop', label: 'Pop', manifestTags: ['pop', 'city-pop', 'reggaeton', 'afrobeats', 'r&b', 'soul'] },
  { id: 'rock', label: 'Rock', manifestTags: ['rock', 'post-rock', 'jazz-rock', 'indie'] },
  { id: 'metal', label: 'Metal', manifestTags: ['metal'] },
  { id: 'edm', label: 'EDM', manifestTags: ['electronic', 'rhythm-game', 'trip-hop'] },
  { id: 'hip-hop', label: 'Hip-hop', manifestTags: ['hip-hop'] },
  { id: 'jazz', label: 'Jazz', manifestTags: ['jazz'] },
  { id: 'classical', label: 'Classical', manifestTags: ['classical', 'soundtrack'] },
  { id: 'acoustic', label: 'Acoustic', manifestTags: ['folk', 'country', 'latin'] },
  { id: 'j-pop', label: 'Anime and J-pop', manifestTags: ['j-pop', 'j-rock', 'rhythm-game'] },
  { id: 'k-pop', label: 'K-pop', manifestTags: ['k-pop'] },
]

/** The group a genre tag is balanced in (the first that lists it), or 'other'. */
export function genreGroup(tag: string): string {
  return GENRE_GROUPS.find((g) => g.manifestTags.includes(tag))?.id ?? 'other'
}

/** A genre/tag from an online music database (MusicBrainz), with its vote count. */
export interface WebTag {
  name: string
  count: number
}

/**
 * Tag groups that hint at a song's speciality. A song's score for a group is the share of
 * its tag votes whose name contains one of the group's words ("female vocalists" -> vocal).
 */
export const TAG_GROUPS = {
  vocal: ['vocal', 'singer', 'ballad', 'soul', 'r&b', 'rnb', 'female', 'male vocal', 'torch', 'adult contemporary', 'gospel', 'crooner', 'traditional pop'],
  acoustic: ['acoustic', 'folk', 'classical', 'jazz', 'piano', 'singer-songwriter', 'bossa', 'chamber', 'cello', 'baroque', 'country', 'blues', 'unplugged', 'neoclassical', 'son cubano', 'flamenco'],
  bass: ['hip hop', 'hip-hop', 'rap', 'trap', 'dubstep', 'drum and bass', 'bass', 'edm', 'house', 'techno', 'trip hop', 'grime', 'reggaeton', 'afrobeat', 'phonk', 'dance', 'electro'],
  busy: ['metal', 'progressive', 'math rock', 'fusion', 'hardcore', 'speedcore', 'j-core', 'breakcore', 'djent', 'big band', 'prog', 'drum', 'thrash'],
  stage: ['ambient', 'soundtrack', 'score', 'post-rock', 'orchestral', 'cinematic', 'dream pop', 'film', 'new age', 'psychedelic', 'art rock', 'experimental', 'dark wave', 'darkwave', 'ethereal'],
  bright: ['pop', 'indie', 'synth', 'vocaloid', 'idol', 'city pop', 'disco', 'funk', 'soft rock', 'j-rock', 'anime'],
} as const

export type TagGroup = keyof typeof TAG_GROUPS
export const TAG_KEYS = Object.keys(TAG_GROUPS) as TagGroup[]

/**
 * Group scores (0–1) for a song's tags: the recording's own genres/tags, else its artist's.
 * Returns null when there are no tags at all, so the guesser falls back to the sound alone.
 */
export function tagVector(recording: WebTag[], artist: WebTag[] = []): number[] | null {
  const tags = recording.length ? recording : artist
  if (!tags.length) return null
  const votes = (t: WebTag) => Math.max(1, t.count)
  const total = tags.reduce((s, t) => s + votes(t), 0)
  return TAG_KEYS.map((g) => tags.filter((t) => TAG_GROUPS[g].some((w) => t.name.toLowerCase().includes(w))).reduce((s, t) => s + votes(t), 0) / total)
}

import { pinkNoise } from '../audio/noise'
import type { RoundAudio } from '../match/MatchView'
import { clipCandidates, sliceBuffer } from './clip'
import type { LibrarySong, SongManifest } from './library'
import { loadFavorites } from './favorites'
import { pickSongs } from './picker'
import type { OwnMusicMix } from './phoneLibrary'

/** Where a song's candidate sections are remembered (v2: a list of sections, not one). */
function clipCacheKey(s: LibrarySong) {
  return `clip2:${s.id}:${s.file.size}`
}

/** Decoded clips of the last few songs/sections (~15 MB each), so one that comes up again starts instantly. */
const CLIP_CACHE_SIZE = 6
const clipCache = new Map<string, Promise<AudioBuffer>>()

/**
 * The song's clip for one round: a hand-set section if the song list pins one, otherwise one
 * of its auto-picked sections at random (all of them show off the song's speciality), so the
 * same song doesn't always play the same part.
 */
export function loadClip(ctx: BaseAudioContext, song: LibrarySong): Promise<AudioBuffer> {
  const known = knownSections(song)
  const section = known ? Math.floor(Math.random() * known.length) : null
  const key = `${clipCacheKey(song)}#${section ?? 'new'}`
  let clip = clipCache.get(key)
  if (clip) clipCache.delete(key) // re-insert below: most recently used goes last
  else clip = decodeClip(ctx, song, section)
  clipCache.set(key, clip)
  clip.catch(() => clipCache.delete(key)) // don't keep a failed decode
  while (clipCache.size > CLIP_CACHE_SIZE) clipCache.delete(clipCache.keys().next().value!)
  return clip
}

/** Sections to pick from, if known without decoding: the pinned one, or ones analysed before. */
function knownSections(song: LibrarySong): [number, number][] | null {
  if (song.clip.start !== null && song.clip.end !== null) return [[song.clip.start, song.clip.end]]
  try {
    const cached = JSON.parse(localStorage.getItem(clipCacheKey(song)) ?? 'null')
    if (Array.isArray(cached) && cached.length && cached.every((r) => Array.isArray(r) && r.length === 2)) return cached
  } catch { /* storage unavailable */ }
  return null
}

async function decodeClip(ctx: BaseAudioContext, song: LibrarySong, section: number | null): Promise<AudioBuffer> {
  const full = await ctx.decodeAudioData(await song.file.arrayBuffer())
  let sections = knownSections(song)
  if (!sections) {
    const chans = Array.from({ length: full.numberOfChannels }, (_, i) => full.getChannelData(i))
    sections = clipCandidates(chans, full.sampleRate, song.category)
    try { localStorage.setItem(clipCacheKey(song), JSON.stringify(sections)) } catch { /* ignore */ }
  }
  const [start, end] = sections[section ?? Math.floor(Math.random() * sections.length)] ?? sections[0]
  return sliceBuffer(ctx, full, start, end)
}

/** Song ids each entrant has been judged on (avoided in later matches). */
export type HeardBy = Record<string, string[]>

/**
 * Song source for one match: picks a song per round (different category each round,
 * genre-weighted, avoiding songs either entrant was already judged on) and cuts the clip.
 */
export function createRoundSource(opts: {
  ctx: BaseAudioContext
  library: LibrarySong[]
  manifest: SongManifest
  heardBy: HeardBy
  entrants: [string, string]
  /** Genre tags chosen in the questionnaire (none: all genres equally). */
  genres?: string[]
  /** Mix ratio of own music in testing: 0, 0.25, 0.5, 0.75, 1. */
  ownMusicMix?: OwnMusicMix
  /** Hidden folders to strictly exclude from picks. */
  hiddenFolders?: Set<string>
}) {
  const played: (LibrarySong | null)[] = []
  /** Next round's song, picked and decoding while the current round plays. */
  const upcoming = new Map<number, LibrarySong>()

  const pick = (round: number, skip?: LibrarySong): LibrarySong => {
    const before = played.slice(0, round).filter((s): s is LibrarySong => !!s)
    const pool = opts.library.filter((s) => !before.includes(s) && s !== skip)
    const heard = Object.fromEntries(Object.entries(opts.heardBy).map(([k, v]) => [k, new Set(v)]))
    return pickSongs(pool.length ? pool : opts.library, 1, {
      heardBy: heard,
      entrants: opts.entrants,
      avoidCategories: before.map((s) => s.category),
      genres: opts.genres,
      favorites: loadFavorites(),
      ownMusicMix: opts.ownMusicMix,
      hiddenFolders: opts.hiddenFolders,
    })[0]
  }

  const load = async (round: number, attempt: number): Promise<RoundAudio> => {
    if (opts.library.length === 0) {
      return { buffer: pinkNoise(opts.ctx, 20), title: 'Pink noise', subtitle: 'No songs loaded, test signal only' }
    }
    // a retry ("another song") needs a fresh pick, and makes the next round's early pick stale
    const song = attempt === 0 && upcoming.has(round) ? upcoming.get(round)! : pick(round, attempt > 0 ? played[round] ?? undefined : undefined)
    upcoming.clear()
    played[round] = song
    const buffer = await loadClip(opts.ctx, song)
    // get the next round ready while this one is being listened to (unused if the match ends first)
    const next = pick(round + 1)
    upcoming.set(round + 1, next)
    loadClip(opts.ctx, next).catch(() => upcoming.delete(round + 1))
    const cat = song.category === 'any' ? 'Uncategorised song' : opts.manifest.categories[song.category]
    return {
      buffer,
      title: song.artist ? `${song.artist} — ${song.title}` : song.title,
      subtitle: [cat, song.genre !== 'unknown' && song.genre, song.from && `from ${song.from}`, song.album && `${song.album}${song.year ? ` (${song.year})` : ''}`]
        .filter(Boolean).join(' · '),
    }
  }

  /** Record the songs used in this match for both entrants; returns the updated map. */
  const commit = (heardBy: HeardBy): HeardBy => {
    const next = { ...heardBy }
    for (const e of opts.entrants) {
      next[e] = [...new Set([...(next[e] ?? []), ...played.filter((s): s is LibrarySong => !!s).map((s) => s.id)])]
    }
    return next
  }

  /**
   * The first song, started early: the VS intro calls this so the song decodes while the intro
   * is on screen, and the match's own first getRound gets the same promise.
   */
  let first: Promise<RoundAudio> | null = null
  const prefetch = () => (first ??= load(0, 0))
  const getRound = (round: number, attempt: number) => (round === 0 && attempt === 0 ? prefetch() : load(round, attempt))

  return { getRound, prefetch, commit }
}

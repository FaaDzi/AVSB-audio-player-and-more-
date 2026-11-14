import { useSyncExternalStore } from 'react'
import { splitArtists, type Track } from './library'

export interface SongStat {
  plays: number
  skips: number
  /** Seconds heard. */
  heard: number
  last: number
}

export interface Listening {
  songs: Record<string, SongStat>
  /** Newest last. */
  history: { id: string; at: number }[]
  /** What personalized autoplay learns from. Resetting it leaves the statistics alone. */
  learned: Record<string, { plays: number; skips: number }>
  autoplayed: number
}

const KEY = 'shell.stats.v1'
const HISTORY_LIMIT = 500
const EMPTY: Listening = { songs: {}, history: [], learned: {}, autoplayed: 0 }

/** A song counts as played after 30 seconds or half its length, whichever comes first. Less than that is a skip. */
export const countsAsPlayed = (heard: number, length: number) => heard >= Math.min(30, length / 2)

export interface Listen {
  id: string
  heard: number
  length: number
  /** It reached its end by itself. */
  finished: boolean
  viaAutoplay: boolean
  learning: boolean
  at: number
}

export function addListen(state: Listening, l: Listen): Listening {
  const played = l.finished || countsAsPlayed(l.heard, l.length)
  const song = state.songs[l.id] ?? { plays: 0, skips: 0, heard: 0, last: 0 }
  const learned = state.learned[l.id] ?? { plays: 0, skips: 0 }
  return {
    songs: { ...state.songs, [l.id]: { plays: song.plays + (played ? 1 : 0), skips: song.skips + (played ? 0 : 1), heard: song.heard + l.heard, last: l.at } },
    history: played ? [...state.history, { id: l.id, at: l.at }].slice(-HISTORY_LIMIT) : state.history,
    learned: l.learning ? { ...state.learned, [l.id]: { plays: learned.plays + (played ? 1 : 0), skips: learned.skips + (played ? 0 : 1) } } : state.learned,
    autoplayed: state.autoplayed + (l.viaAutoplay ? 1 : 0),
  }
}

export interface Ranked { name: string; plays: number; heard: number }

export function topSongs(state: Listening, tracks: Track[], limit = 10): (Ranked & { track: Track })[] {
  const byId = new Map(tracks.map((t) => [t.id, t]))
  return Object.entries(state.songs)
    .flatMap(([id, s]) => {
      const track = byId.get(id)
      return track && s.plays ? [{ name: track.title, plays: s.plays, heard: s.heard, track }] : []
    })
    .sort((a, b) => b.plays - a.plays || b.heard - a.heard)
    .slice(0, limit)
}

export function topArtists(state: Listening, tracks: Track[], limit = 10, separators?: readonly string[]): Ranked[] {
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const totals = new Map<string, Ranked>()
  for (const [id, s] of Object.entries(state.songs)) {
    const rawArtist = byId.get(id)?.artist
    if (!rawArtist || !s.plays) continue
    const artists = splitArtists(rawArtist, separators)
    const list = artists.length ? artists : [rawArtist]
    for (const name of list) {
      const key = name.toLowerCase()
      const was = totals.get(key) ?? { name, plays: 0, heard: 0 }
      totals.set(key, { name: was.name, plays: was.plays + s.plays, heard: was.heard + s.heard })
    }
  }
  return [...totals.values()].sort((a, b) => b.plays - a.plays || b.heard - a.heard).slice(0, limit)
}

/** The statistics without these songs (hidden folders): nothing is deleted, it's only left out of the totals. */
export const withoutSongs = (state: Listening, drop: ReadonlySet<string>): Listening =>
  drop.size ? { ...state, songs: Object.fromEntries(Object.entries(state.songs).filter(([id]) => !drop.has(id))) } : state

export const totalHeard = (state: Listening) => Object.values(state.songs).reduce((sum, s) => sum + s.heard, 0)
export const totalPlays = (state: Listening) => Object.values(state.songs).reduce((sum, s) => sum + s.plays, 0)

function load(): Listening {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Listening>) }
  } catch {
    return EMPTY
  }
}

let state: Listening | null = null
const listeners = new Set<() => void>()
export const getListening = (): Listening => (state ??= load())

function save(next: Listening) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage full: kept for this session */ }
  listeners.forEach((l) => l())
}

export const recordListen = (l: Listen) => save(addListen(getListening(), l))
export const resetLearning = () => save({ ...getListening(), learned: {}, autoplayed: 0 })
export const clearListening = () => save(EMPTY)
export const useListening = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, getListening)

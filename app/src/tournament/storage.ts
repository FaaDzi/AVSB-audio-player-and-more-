import type { SlotRole } from '../prefs/scoring'
import type { Preferences } from '../prefs/types'
import type { HeardBy } from '../songs/rounds'
import type { MatchResult } from './bracket'

export interface TournamentSave {
  version: 1
  prefs: Preferences
  /** IEM ids in seed order (index 0 = seed 1). */
  entrants: string[]
  /** Optional role tags from roster setup (yours, darkhorse, stretch). */
  roles?: Record<string, SlotRole>
  results: Record<string, MatchResult>
  heardBy: HeardBy
  startedAt: string
  /** Mystery mode: ids whose unmasking animation has already been shown. */
  revealSeen?: string[]
}

export interface HistoryEntry {
  id: string
  finishedAt: string
  size: number
  championId: string
  runnerUpId: string
  thirdId: string
  entrants: string[]
  results: Record<string, MatchResult>
  prefs: Preferences
}

const KEY = 'iem-tournament-v1'
const PREFS_KEY = 'iem-prefs-v1'
const HISTORY_KEY = 'iem-history-v1'

export function loadTournament(): TournamentSave | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return s?.version === 1 ? s : null
  } catch {
    return null
  }
}

export function saveTournament(t: TournamentSave | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: progress just won't persist */
  }
}

export function loadPrefs(): Partial<Preferences> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function hasSavedProfile(): boolean {
  try {
    return localStorage.getItem(PREFS_KEY) !== null
  } catch {
    return false
  }
}

export function savePrefs(p: Preferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function appendHistory(entry: HistoryEntry) {
  try {
    const list = loadHistory().filter((x) => x.id !== entry.id)
    list.unshift(entry)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)))
  } catch {
    /* ignore */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* ignore */
  }
}

import { createContext, useContext } from 'react'
import type { LibraryData, Track } from './library'

export type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists' | 'folders'

export type Route =
  | { page: 'home' }
  | { page: 'library'; tab?: LibraryTab }
  | { page: 'tournament' }
  | { page: 'database'; kind?: 'tips' }
  | { page: 'device'; id: string }
  | { page: 'tip'; id: string }
  | { page: 'settings'; section?: string }
  | { page: 'playlist'; id: string }
  | { page: 'album'; key: string }
  | { page: 'artist'; name: string }
  | { page: 'song'; id: string }
  | { page: 'folder'; folder: string }

export type Repeat = 'off' | 'all' | 'one'
export type SidePanel = 'queue' | 'lyrics' | null

export type ToastItem = string | { message: string; action?: { label: string; onClick: () => void } }

export interface ShellState {
  data: LibraryData
  current: Track | null
  playing: boolean
  volume: number
  loading: boolean
  queue: Track[]
  repeat: Repeat
  shuffle: boolean
  autoplay: boolean
  panel: SidePanel
  nowPlaying: boolean
  play: (t: Track, list?: Track[]) => void
  step: (direction: 1 | -1) => void
  setPlaying: (p: boolean) => void
  setPosition: (s: number) => void
  setVolume: (v: number) => void
  setQueue: (q: Track[]) => void
  setRepeat: (r: Repeat) => void
  setShuffle: (s: boolean) => void
  setAutoplay: (a: boolean) => void
  setPanel: (p: SidePanel) => void
  setNowPlaying: (open: boolean) => void
  setMini: (mini: boolean) => void
  /** §112 E: the mini player's X: pause, and hide the mini player and the notification until the next play. */
  closePlayer: () => void
  /** True after closePlayer, until something plays. */
  closed: boolean
  shuffleLibrary: () => void
  showToast: (item: ToastItem) => void
  push: (r: Route) => void
  go: (r: Route) => void
  openPlaylist: (id: string) => void
  replaceData: (d: LibraryData) => void
}

export const ShellContext = createContext<ShellState | null>(null)

export function useShell(): ShellState {
  const s = useContext(ShellContext)
  if (!s) throw new Error('useShell outside Shell')
  return s
}

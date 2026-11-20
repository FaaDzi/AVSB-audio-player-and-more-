import { useSyncExternalStore } from 'react'
import type { LibraryData, Track } from './library'

const FAVORITES_KEY = 'shell.favorites.v1'
const FAVORITES_PLAYLIST_NAME = 'Favorites'

let favoritesCache: Set<string> | null = null
const listeners = new Set<() => void>()

function loadFavorites(): Set<string> {
  if (favoritesCache) return favoritesCache
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    favoritesCache = new Set(raw ? JSON.parse(raw) : [])
  } catch {
    favoritesCache = new Set()
  }
  return favoritesCache
}

function saveFavorites(set: Set<string>) {
  favoritesCache = set
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]))
  } catch {}
  listeners.forEach((l) => l())
}

/** §98: Favorites emptied: every heart on this device goes. */
export function clearFavorites() {
  saveFavorites(new Set())
}

export function isLiked(trackId: string): boolean {
  return loadFavorites().has(trackId)
}

export function subscribeFavorites(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useFavorites(): Set<string> {
  return useSyncExternalStore(subscribeFavorites, loadFavorites)
}

export function toggleLike(
  track: Track,
  libraryData?: LibraryData,
  replaceData?: (d: LibraryData) => void,
): boolean {
  const current = new Set(loadFavorites())
  const liked = !current.has(track.id)
  if (liked) current.add(track.id)
  else current.delete(track.id)
  saveFavorites(current)

  // Auto-sync with "Favorites" playlist in library
  if (libraryData && replaceData) {
    let favPlaylist = libraryData.playlists.find((p) => p.name.toLowerCase() === FAVORITES_PLAYLIST_NAME.toLowerCase())
    let nextPlaylists = [...libraryData.playlists]
    if (!favPlaylist) {
      favPlaylist = { id: `fav-${Date.now()}`, name: FAVORITES_PLAYLIST_NAME, tracks: [] }
      nextPlaylists.unshift(favPlaylist)
    }
    const currentTrackIds = new Set(favPlaylist.tracks)
    if (liked) {
      if (!currentTrackIds.has(track.id)) {
        favPlaylist = { ...favPlaylist, tracks: [track.id, ...favPlaylist.tracks] }
      }
    } else {
      favPlaylist = { ...favPlaylist, tracks: favPlaylist.tracks.filter((id) => id !== track.id) }
    }
    nextPlaylists = nextPlaylists.map((p) => (p.id === favPlaylist!.id ? favPlaylist! : p))
    replaceData({ ...libraryData, playlists: nextPlaylists })
  }

  return liked
}

/** Liked tracks get a slight 1.25x probability boost when selecting tournament contenders. */
export function likedWeight(trackId: string): number {
  return isLiked(trackId) ? 1.25 : 1.0
}


const KEY = 'song-favorites-v1'

/** Picking-weight multiplier for a favourite song: a small but real bump. */
export const FAVORITE_WEIGHT = 1.35

export function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function saveFavorites(ids: Set<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])) } catch { /* storage unavailable */ }
}

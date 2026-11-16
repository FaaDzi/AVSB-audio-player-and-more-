import { getSetting, getSettings, setSetting, type SettingValues } from './store'

export const BACKUP_APP = 'music-preferences'

export interface Backup {
  app: typeof BACKUP_APP
  version: 1
  created: string
  settings?: SettingValues
  playlists?: string
  /**
   * Everything else the app keeps (favourites, listening stats, tournaments, fit and spatial settings, fetched song
   * details and lyrics), as it sits in storage. Without it a restore brought back settings and playlists only.
   */
  storage?: Record<string, string>
}

/** Not worth carrying: rebuilt on demand (spectrum analyses are megabytes each), or the settings themselves. */
const NOT_STORED = /^(analysis_|artist_avatar_|shell\.settings\.)/

function otherStorage(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && !NOT_STORED.test(key)) out[key] = localStorage.getItem(key) ?? ''
    }
  } catch { /* no storage: nothing to add */ }
  return out
}

/** What the backup holds, from the two categories that exist so far. Audio files are never included. */
export function buildBackup(values: SettingValues, includeSettings: boolean, includeCollections: boolean, created = new Date().toISOString(), storage: Record<string, string> = {}): Backup {
  const { playlists, ...settings } = values
  return {
    app: BACKUP_APP,
    version: 1,
    created,
    ...(includeSettings ? { settings } : {}),
    ...(includeCollections && typeof playlists === 'string' ? { playlists } : {}),
    ...(includeCollections && Object.keys(storage).length ? { storage } : {}),
  }
}

/** Reads a backup file's text. Throws with a message fit to show if it isn't one of ours. */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not a backup')
  }
  const b = data as Partial<Backup> | null
  if (!b || b.app !== BACKUP_APP || b.version !== 1) throw new Error('That file is not a backup from this app')
  return b as Backup
}

export function downloadBackup() {
  const backup = buildBackup(getSettings(), Boolean(getSetting('bksettings')), Boolean(getSetting('bkcollections')), undefined, otherStorage())
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `music-preferences-backup-${backup.created.slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Replaces the saved settings and playlists with the backup's. The page reloads afterwards to use them. */
export function restoreBackup(backup: Backup) {
  for (const [id, value] of Object.entries(backup.settings ?? {})) setSetting(id, value)
  if (backup.playlists) setSetting('playlists', backup.playlists)
  for (const [key, value] of Object.entries(backup.storage ?? {})) {
    if (typeof value === 'string' && !NOT_STORED.test(key)) try { localStorage.setItem(key, value) } catch { /* full: the rest still goes in */ }
  }
}

/** What the Electron window offers the page. Absent on the dev server. */
export interface AppProcessMetric {
  pid: number
  type: string
  serviceName: string
  label: string
  workingSetMB: number
  privateMB: number | null
  cpuPercent: number
}

export interface MusicHost {
  /** Windows' folder picker; null when cancelled. */
  chooseFolder: () => Promise<string | null>
  openSong: (path: string) => Promise<boolean>
  /** Compact desktop floating widget mode for mini player. */
  setMiniMode?: (mini: boolean) => Promise<boolean>
  /** Writes a .lrc beside the song: 'saved', 'exists' (left alone) or 'refused'. */
  saveLyrics: (path: string, text: string) => Promise<'saved' | 'exists' | 'refused'>
  /** Live per-process memory/CPU metrics from Electron app.getAppMetrics(). */
  appMetrics?: () => Promise<AppProcessMetric[]>
  /** The phone link (plan §70 D1, electron/link). */
  link?: {
    status: () => Promise<LinkStatus>
    resync?: () => Promise<LinkStatus>
    ping?: () => Promise<LinkStatus>
    pair: () => Promise<{ link: string; expires: number; qr: string } | null>
    stopPairing: () => Promise<void>
    remove: (id: string) => Promise<boolean>
    /** §81 F: the owner's own name for a phone; '' goes back to the phone's name. */
    rename?: (id: string, name: string) => Promise<boolean>
    onChange: (listener: () => void) => () => void
    /** §80 A: the page's playlists (JSON of SyncState) for phones to fetch. */
    pushPlaylists?: (json: string) => void
    /** A phone sent its playlists (SyncState in PC ids). */
    onPlaylists?: (listener: (sent: unknown) => void) => () => void
    /** A phone sent a song into the first library folder's "From phone". */
    onUploaded?: (listener: () => void) => () => void
  }
}

export interface LinkStatus {
  running: boolean
  online: boolean
  id: string | null
  pairing: boolean
  lanPort?: number | null
  lanIps?: string[]
  latencyMs?: number
  unavailable?: boolean
  phones: { id: string; name: string; model?: string; os?: string; customName?: string; pairedAt: number; lastSeen: number; expires: number; connected: boolean }[]
}

export const host = (): MusicHost | undefined => (window as unknown as { musicHost?: MusicHost }).musicHost

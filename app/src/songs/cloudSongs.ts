import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { bridge } from '../fit/system'
import { isAndroid } from '../platform'
import { isBuiltinStem } from './builtinSongs'
import type { Category, SongFile, SongInfo, SongManifest } from './library'

export type SongStatus = 'builtin' | 'downloaded' | 'cloud'

export interface CatalogSong {
  name: string
  stem: string
  size: number
  localSize?: number
  cover?: string
  driveId?: string
  builtin: boolean
  /** On the device because it ships inside the app (Full build): removing it hides it, frees nothing. */
  bundled?: boolean
  status: SongStatus
  id: string
  artist: string
  title: string
  album: string
  year: number | null
  category: Category | 'any'
  also: Category[]
  genre: string
  note?: string
}

export interface StorageSummary {
  permanentCount: number
  permanentBytes: number
  downloadedCount: number
  downloadedBytes: number
  cloudCount: number
  cloudBytes: number
  totalCatalogCount: number
}

const USER_DELETED_KEY = 'iem-user-deleted-songs-v1'
const IDB_NAME = 'iem-cloud-songs-v1'
const IDB_STORE = 'songs'

export function getUserDeletedStems(): Set<string> {
  try {
    const raw = localStorage.getItem(USER_DELETED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function setUserSongDeleted(stem: string, deleted: boolean): void {
  try {
    const set = getUserDeletedStems()
    if (deleted) set.add(stem)
    else set.delete(stem)
    localStorage.setItem(USER_DELETED_KEY, JSON.stringify(Array.from(set)))
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Storage Abstraction (Android Filesystem vs Electron IPC vs IndexedDB)     */
/* -------------------------------------------------------------------------- */

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

let idbPromise: Promise<IDBDatabase> | null = null

function getIndexedDB(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not available'))
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'name' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return idbPromise
}

export interface LocalCloudSong {
  name: string
  size: number
  path?: string
}

export async function listLocalCloudSongs(): Promise<LocalCloudSong[]> {
  const b = bridge()
  if (b?.cloudSongsList) {
    try {
      return await b.cloudSongsList()
    } catch {
      return []
    }
  }

  if (isAndroid()) {
    try {
      const dir = await Filesystem.readdir({ path: 'cloud-songs', directory: Directory.Data })
      const results: LocalCloudSong[] = []
      for (const f of dir.files) {
        if (f.type === 'file' && f.name.endsWith('.opus')) {
          results.push({ name: f.name, size: f.size ?? 0 })
        }
      }
      return results
    } catch {
      return []
    }
  }

  // Web fallback: IndexedDB
  try {
    const db = await getIndexedDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const store = tx.objectStore(IDB_STORE)
      const req = store.getAll()
      req.onsuccess = () => {
        const items = (req.result as { name: string; size: number }[]) || []
        resolve(items.map((it) => ({ name: it.name, size: it.size })))
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function writeLocalCloudSong(name: string, data: ArrayBuffer): Promise<void> {
  if (isAndroid()) {
    try {
      await Filesystem.mkdir({ path: 'cloud-songs', directory: Directory.Data, recursive: true })
    } catch {
      /* exists */
    }
    const base64 = uint8ArrayToBase64(new Uint8Array(data))
    await Filesystem.writeFile({
      path: `cloud-songs/${name}`,
      directory: Directory.Data,
      data: base64,
    })
    return
  }

  // Web fallback: IndexedDB
  const db = await getIndexedDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    const req = store.put({ name, size: data.byteLength, data, updatedAt: Date.now() })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function readLocalCloudSong(name: string, filePath?: string): Promise<ArrayBuffer> {
  const b = bridge()
  if (b?.readSong && filePath) {
    const u8 = await b.readSong(filePath)
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  }

  if (isAndroid()) {
    try {
      const uriResult = await Filesystem.getUri({ path: `cloud-songs/${name}`, directory: Directory.Data })
      const webUrl = Capacitor.convertFileSrc(uriResult.uri)
      const res = await fetch(webUrl)
      if (res.ok) return await res.arrayBuffer()
    } catch {
      /* fallback to readFile */
    }
    const file = await Filesystem.readFile({ path: `cloud-songs/${name}`, directory: Directory.Data })
    return base64ToArrayBuffer(typeof file.data === 'string' ? file.data : '')
  }

  // Web fallback: IndexedDB
  const db = await getIndexedDB()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const store = tx.objectStore(IDB_STORE)
    const req = store.get(name)
    req.onsuccess = () => {
      if (req.result?.data) resolve(req.result.data)
      else reject(new Error(`Song ${name} not found in IndexedDB`))
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteLocalCloudSong(name: string): Promise<boolean> {
  const stem = name.replace(/\.[^.]+$/, '')
  // Protection: never delete built-in songs
  if (isBuiltinStem(stem)) {
    return false
  }

  // Mark as user-deleted so bundled copies in Full build are excluded as well
  setUserSongDeleted(stem, true)

  const b = bridge()
  if (b?.cloudSongsDelete) {
    await b.cloudSongsDelete(name)
  }

  if (isAndroid()) {
    try {
      await Filesystem.deleteFile({ path: `cloud-songs/${name}`, directory: Directory.Data })
    } catch {
      /* may not be in writable storage if it was bundled */
    }
  }

  // Web fallback: IndexedDB
  try {
    const db = await getIndexedDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const req = store.delete(name)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    /* ignore */
  }

  return true
}

export async function clearAllLocalCloudSongs(allStems?: string[]): Promise<void> {
  if (allStems) {
    for (const s of allStems) {
      const stem = s.replace(/\.[^.]+$/, '')
      if (!isBuiltinStem(stem)) {
        setUserSongDeleted(stem, true)
      }
    }
  }

  const b = bridge()
  if (b?.cloudSongsClear) {
    await b.cloudSongsClear()
    return
  }

  if (isAndroid()) {
    try {
      await Filesystem.rmdir({ path: 'cloud-songs', directory: Directory.Data, recursive: true })
    } catch {
      /* ignore */
    }
    return
  }

  // Web fallback: IndexedDB
  try {
    const db = await getIndexedDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const req = store.clear()
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Catalog Loading, Status Resolution & Deduplication                         */
/* -------------------------------------------------------------------------- */

export interface RawSongIndexItem {
  name: string
  size: number
  cover?: string
  builtin?: boolean
  bundled?: boolean
  driveId?: string
}

export async function fetchSongsIndex(): Promise<RawSongIndexItem[]> {
  const base = `${import.meta.env.BASE_URL}songs/`
  const res = await fetch(`${base}index.json`)
  if (!res.ok) throw new Error(`Failed to load ${base}index.json: ${res.status}`)
  return await res.json()
}

let bundledDriveMap: Record<string, string> | null = null

async function getBundledDriveMap(): Promise<Record<string, string>> {
  if (bundledDriveMap) return bundledDriveMap
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/drive_map.json`)
    if (res.ok) {
      bundledDriveMap = (await res.json()) || {}
      return bundledDriveMap!
    }
  } catch {
    /* ignore */
  }
  return {}
}

/**
 * Builds the full 300-song catalog with live status ('builtin' | 'downloaded' | 'cloud').
 */
export async function getFullCatalog(manifest: SongManifest): Promise<{
  catalog: CatalogSong[]
  summary: StorageSummary
}> {
  const rawIndex = await fetchSongsIndex()
  const localFiles = await listLocalCloudSongs()
  const localMap = new Map(localFiles.map((f) => [f.name, f.size]))
  const driveMap = await getBundledDriveMap()
  const userDeleted = getUserDeletedStems()

  const manifestByStem = new Map<string, SongInfo>()
  for (const s of manifest.songs) {
    if (s.fileName) {
      manifestByStem.set(s.fileName, s)
    }
  }

  let permanentCount = 0
  let permanentBytes = 0
  let downloadedCount = 0
  let downloadedBytes = 0
  let cloudCount = 0
  let cloudBytes = 0

  const catalog: CatalogSong[] = rawIndex.map((item) => {
    const stem = item.name.replace(/\.[^.]+$/, '')
    const isBuiltin = isBuiltinStem(stem)
    const isDeleted = userDeleted.has(stem)
    const localSize = localMap.get(item.name)
    const hasLocalFile = localSize !== undefined && localSize > 0
    const isBundled = item.bundled === true || item.builtin === true
    const isDownloaded = !isDeleted && (hasLocalFile || (!isBuiltin && isBundled))

    let status: SongStatus = 'cloud'
    if (isBuiltin) {
      status = 'builtin'
      permanentCount++
      permanentBytes += item.size
    } else if (isDownloaded) {
      status = 'downloaded'
      downloadedCount++
      downloadedBytes += hasLocalFile ? localSize! : item.size
    } else {
      status = 'cloud'
      cloudCount++
      cloudBytes += item.size
    }

    const driveId = item.driveId || driveMap[item.name]
    const m = manifestByStem.get(stem)

    return {
      name: item.name,
      stem,
      size: item.size,
      localSize: isDownloaded ? (hasLocalFile ? localSize : item.size) : undefined,
      cover: item.cover ? `${import.meta.env.BASE_URL}songs/${encodeURIComponent(item.cover)}` : undefined,
      driveId,
      builtin: isBuiltin,
      bundled: status === 'downloaded' && !hasLocalFile,
      status,
      id: m?.id || `cloud-${stem}`,
      artist: m?.artist || '',
      title: m?.title || stem,
      album: m?.album || '',
      year: m?.year ?? null,
      category: m?.category || 'any',
      also: m?.also || [],
      genre: m?.genre || 'unknown',
      note: m?.note,
    }
  })

  return {
    catalog,
    summary: {
      permanentCount,
      permanentBytes,
      downloadedCount,
      downloadedBytes,
      cloudCount,
      cloudBytes,
      totalCatalogCount: catalog.length,
    },
  }
}

/**
 * Filter songs that actually need downloading, strictly deduplicating:
 * - Skips built-in songs
 * - Skips already downloaded songs with matching/positive size
 */
export function filterMissingSongs(candidates: CatalogSong[]): CatalogSong[] {
  return candidates.filter((s) => !s.builtin && s.status === 'cloud')
}

/* -------------------------------------------------------------------------- */
/* Downloading from the shared Google Drive folder (no API key needed)        */
/* -------------------------------------------------------------------------- */

/** A public file's direct download (drive.usercontent answers with Access-Control-Allow-Origin: *). */
export const driveDownloadUrl = (driveId: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download`

/** Ogg files (every song in the folder is Opus in Ogg) start with "OggS"; Drive's error and quota pages are HTML. */
export function looksLikeOgg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53
}

/**
 * Download one song into local storage; `onBytes` gets the bytes received so far.
 *
 * Drive answers 403 to a web page's cross-site request (Sec-Fetch-Site: cross-site), so the app
 * downloads natively: the exe in its main process, Android with the Filesystem plugin straight to
 * a file. A plain browser can only try a fetch, which Drive normally refuses.
 */
export async function downloadSongFile(
  song: CatalogSong,
  signal?: AbortSignal,
  onBytes?: (loaded: number) => void,
): Promise<void> {
  if (song.builtin) return
  if (!song.driveId) throw new Error(`${song.title} isn't in the Drive folder`)
  if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
  const url = driveDownloadUrl(song.driveId)
  // the Drive files are the very files the song list describes, so a size mismatch means a bad download
  const checkSize = (got: number) => {
    if (song.size > 0 && got !== song.size) throw new Error(`Got ${got} bytes instead of ${song.size} (try again)`)
  }

  const b = bridge()
  if (b?.cloudSongsDownload) {
    const res = await b.cloudSongsDownload(song.name, song.driveId, onBytes)
    try {
      checkSize(res.size)
    } catch (e) {
      await b.cloudSongsDelete?.(song.name)
      throw e
    }
  } else if (isAndroid()) {
    const path = `cloud-songs/${song.name}`
    const sub = await Filesystem.addListener('progress', (p) => {
      if (p.url === url) onBytes?.(p.bytes)
    })
    // downloadFile doesn't reliably create the folder on a fresh install (Lite ships no songs)
    try {
      await Filesystem.mkdir({ path: 'cloud-songs', directory: Directory.Data, recursive: true })
    } catch {
      /* exists */
    }
    try {
      await Filesystem.downloadFile({ url, path, directory: Directory.Data, recursive: true, progress: true })
    } finally {
      await sub.remove()
    }
    const st = await Filesystem.stat({ path, directory: Directory.Data })
    try {
      checkSize(st.size)
    } catch (e) {
      await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {})
      throw e
    }
  } else {
    let res: Response
    try {
      res = await fetch(url, { signal })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new Error('Google Drive only lets the app download, not a browser')
    }
    if (!res.ok) throw new Error(res.status === 404 ? 'Not found on Drive' : `Drive answered ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    onBytes?.(bytes.byteLength)
    if (!looksLikeOgg(bytes)) throw new Error('Drive sent a page instead of the song (try again later)')
    checkSize(bytes.byteLength)
    await writeLocalCloudSong(song.name, bytes.buffer as ArrayBuffer)
  }
  setUserSongDeleted(song.stem, false)
}

export interface DownloadProgress {
  /** Songs finished (downloaded or failed) out of `total`. */
  current: number
  total: number
  bytesLoaded: number
  bytesTotal: number
  /** Songs downloading right now: stem -> fraction received (0-1). */
  active: Record<string, number>
  done: boolean
}

/**
 * Waits before each retry of a failed song. A dropped connection ("cannot find address") or a Drive
 * hiccup fails at once, so without a pause the queue would fail every song it reaches meanwhile.
 */
export const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000]

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done)
  })
}

/** Download `songsToDownload` (only the ones not on the device), two at a time, with live progress. */
export async function downloadSongQueue(
  songsToDownload: CatalogSong[],
  options: {
    concurrency?: number
    signal?: AbortSignal
    onProgress?: (progress: DownloadProgress) => void
    /** Called as each song lands, so the list can update without waiting for the whole queue. */
    onSongDone?: (song: CatalogSong, error?: string) => void
    /** Pauses before each retry of a failed song (tests pass short ones). */
    retryDelays?: number[]
    /** Downloads one song (tests swap it). */
    download?: typeof downloadSongFile
  } = {},
): Promise<{ successful: number; failed: { song: CatalogSong; error: string }[] }> {
  const { concurrency = 2, signal, onProgress, onSongDone, retryDelays = RETRY_DELAYS_MS, download = downloadSongFile } = options
  const toProcess = filterMissingSongs(songsToDownload)
  const total = toProcess.length
  const bytesTotal = toProcess.reduce((sum, s) => sum + s.size, 0)
  const failed: { song: CatalogSong; error: string }[] = []
  const active: Record<string, number> = {}
  let finishedBytes = 0
  let successful = 0
  let index = 0

  const report = (done = false) => {
    const inFlight = toProcess.reduce((sum, s) => sum + (active[s.stem] ?? 0) * s.size, 0)
    onProgress?.({
      current: successful + failed.length,
      total,
      bytesLoaded: finishedBytes + inFlight,
      bytesTotal,
      active: { ...active },
      done,
    })
  }

  async function worker(): Promise<void> {
    while (index < toProcess.length) {
      if (signal?.aborted) return
      const song = toProcess[index++]
      active[song.stem] = 0
      report()
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            await download(song, signal, (loaded) => {
              active[song.stem] = song.size > 0 ? Math.min(1, loaded / song.size) : 0
              report()
            })
            break
          } catch (err) {
            // a song missing from the Drive folder won't turn up by waiting
            if (signal?.aborted || !song.driveId || attempt >= retryDelays.length) throw err
            active[song.stem] = 0
            report()
            await wait(retryDelays[attempt], signal)
            if (signal?.aborted) throw err
          }
        }
        successful++
        onSongDone?.(song)
      } catch (err: unknown) {
        if (signal?.aborted) return
        const error = err instanceof Error ? err.message : String(err)
        failed.push({ song, error })
        onSongDone?.(song, error)
      } finally {
        delete active[song.stem]
        finishedBytes += song.size
      }
      report()
    }
  }

  report()
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()))
  report(true)
  if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
  return { successful, failed }
}

/* -------------------------------------------------------------------------- */
/* Converting Installed Songs to SongFile for Audio Playback                  */
/* -------------------------------------------------------------------------- */

/**
 * Loads all installed songs (10 permanent built-in + all downloaded cloud songs).
 * Guarantees offline matches never fail by picking an un-downloaded song!
 */
export async function loadInstalledSongs(): Promise<SongFile[]> {
  const base = `${import.meta.env.BASE_URL}songs/`
  let indexItems: RawSongIndexItem[] = []
  try {
    indexItems = await fetchSongsIndex()
  } catch {
    return []
  }

  const songFiles: SongFile[] = []
  const userDeleted = getUserDeletedStems()
  const builtInItems = indexItems.filter(
    (f) =>
      (f.bundled === true || f.builtin || isBuiltinStem(f.name)) &&
      (isBuiltinStem(f.name) || !userDeleted.has(f.name.replace(/\.[^.]+$/, ''))),
  )
  const builtInNames = new Set(builtInItems.map((f) => f.name))

  // 1. Permanent Built-in Songs (bundled in dist/songs or dist-android/songs)
  for (const f of builtInItems) {
    const url = base + encodeURIComponent(f.name)
    const cover = f.cover ? base + encodeURIComponent(f.cover) : undefined
    songFiles.push({
      name: f.name,
      size: f.size,
      url,
      cover,
      arrayBuffer: async () => (await fetch(url)).arrayBuffer(),
    })
  }

  // 2. Downloaded Cloud Songs (from local writable storage)
  try {
    const local = await listLocalCloudSongs()
    const rawMap = new Map(indexItems.map((it) => [it.name, it]))

    for (const f of local) {
      if (builtInNames.has(f.name)) continue // already added as built-in
      const stem = f.name.replace(/\.[^.]+$/, '')
      if (userDeleted.has(stem)) continue
      const raw = rawMap.get(f.name)
      const cover = raw?.cover ? base + encodeURIComponent(raw.cover) : undefined

      if (isAndroid()) {
        try {
          const uriRes = await Filesystem.getUri({ path: `cloud-songs/${f.name}`, directory: Directory.Data })
          const webUrl = Capacitor.convertFileSrc(uriRes.uri)
          songFiles.push({
            name: f.name,
            size: f.size,
            url: webUrl,
            cover,
            arrayBuffer: async () => {
              try {
                const r = await fetch(webUrl)
                if (r.ok) return await r.arrayBuffer()
              } catch {
                /* fallback to readFile */
              }
              const file = await Filesystem.readFile({ path: `cloud-songs/${f.name}`, directory: Directory.Data })
              return base64ToArrayBuffer(typeof file.data === 'string' ? file.data : '')
            },
          })
          continue
        } catch {
          /* fallback below */
        }
      }

      // Desktop IPC or IndexedDB
      const filePath = f.path
      songFiles.push({
        name: f.name,
        size: f.size,
        cover,
        arrayBuffer: async () => await readLocalCloudSong(f.name, filePath),
      })
    }
  } catch {
    /* local storage failed: fallback to only built-in songs */
  }

  return songFiles
}

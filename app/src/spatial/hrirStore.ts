import type { HrirSet } from './types'

/** The id of the user's imported set in SpatialSettings.hrirId. */
export const IMPORTED_ID = 'imported'

/** The imported (SOFA) HRIR set lives in IndexedDB: ~150 KB of Float32 is too much for localStorage. */
const DB = 'iem-hrir-v1'
const STORE = 'sets'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so an imported HRTF can’t be kept.'))
      return
    }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
  })
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(req.result as T)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error ?? new Error('IndexedDB write failed'))
        }
      }),
  )
}

/** Stored shape: plain arrays of Float32Array survive structured cloning as they are. */
export function saveStoredHrir(set: HrirSet): Promise<void> {
  return run<void>('readwrite', (s) => s.put(set, set.id))
}

export function loadStoredHrir(id: string): Promise<HrirSet | null> {
  return run<HrirSet | undefined>('readonly', (s) => s.get(id)).then((v) =>
    v && Array.isArray(v.ring) && v.ring.length && v.sampleRate > 0 ? v : null,
  )
}

export function deleteStoredHrir(id: string): Promise<void> {
  return run<void>('readwrite', (s) => s.delete(id))
}

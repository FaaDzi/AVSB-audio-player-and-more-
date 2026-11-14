// Types for library-scan.mjs, for vite.config.ts.
export interface LibraryFolder { path: string; subfolders: boolean; lastScan: number }
export interface Library {
  state(): { folders: (LibraryFolder & { online: boolean; count: number })[]; tracks: Record<string, unknown>[]; scanning: { found: number; read: number; folder: string } | null; version: number }
  setFolders(next: unknown): void
  scan(options?: { full?: boolean }): Promise<void>
  allowed(wanted: unknown): string | null
  coverFile(id: unknown): string | null
  lyricsFile(id: unknown): string | null
  folders(): LibraryFolder[]
}
export const MIME: Record<string, string>
export function createLibrary(options: { dataDir: string; saveCover?: (base: string, bytes: Buffer, mime?: string) => Promise<string>; log?: (line: string) => void }): Library

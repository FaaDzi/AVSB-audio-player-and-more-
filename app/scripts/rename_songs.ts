/**
 * Rename the files in songs/originals to "NNN - Artist - Title.ext" using the song list,
 * and keep songs/manifest.json (fileName) and data/song_features.json in step.
 * Every rename is logged to data/song_renames.json (new name -> old name) so it can be undone.
 *
 * Usage (from app/): npx vite-node scripts/rename_songs.ts          (dry run)
 *                    npx vite-node scripts/rename_songs.ts --apply
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { SongManifest } from '../src/songs/library'

const ROOT = join(import.meta.dirname, '..', '..')
const DIR = join(ROOT, 'songs', 'originals')
const MANIFEST = join(ROOT, 'songs', 'manifest.json')
const FEATURES = join(ROOT, 'data', 'song_features.json')
const LOG = join(ROOT, 'data', 'song_renames.json')
const apply = process.argv.includes('--apply')

const manifest: SongManifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const features: Record<string, unknown> = JSON.parse(readFileSync(FEATURES, 'utf8'))
const log: Record<string, string> = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : {}
const files = readdirSync(DIR)

/** Characters Windows (and Android storage) won't take in a file name. */
const safe = (s: string) =>
  s
    .replace(/[\\/]/g, '-')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/\*/g, '＊')
    .replace(/[?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')

let n = 0
for (const s of manifest.songs) {
  if (s.fileName === undefined) continue
  const file = files.find((f) => f.slice(0, -extname(f).length) === s.fileName)
  if (!file) continue
  const num = /^(\d+)\s*-/.exec(file)?.[1]
  const stem = safe(`${num ? num.padStart(3, '0') + ' - ' : ''}${s.artist ? s.artist + ' - ' : ''}${s.title}`)
  const target = stem + extname(file)
  if (target === file) continue
  if (files.includes(target)) throw new Error(`${target} already exists`)
  n++
  console.log(`${file}\n  -> ${target}`)
  if (!apply) continue
  renameSync(join(DIR, file), join(DIR, target))
  log[target] = log[file] ?? file
  delete log[file]
  if (features[file]) {
    features[target] = features[file]
    delete features[file]
  }
  s.fileName = stem
}
if (apply) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(FEATURES, JSON.stringify(features, null, 1))
  writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
}
console.log(`${n} file(s) ${apply ? 'renamed' : 'would be renamed (dry run; add --apply)'}`)

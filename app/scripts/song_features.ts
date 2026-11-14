/**
 * Measure every song in songs/originals with the app's own analyser (src/songs/analyze.ts),
 * decoding with the bundled ffmpeg. Resumable: results are cached in data/song_features.json.
 *
 * Usage (from app/): npx vite-node scripts/song_features.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeSong, type SongFeatures } from '../src/songs/analyze'

const ROOT = join(import.meta.dirname, '..', '..')
const SONGS = join(ROOT, 'songs', 'originals')
const OUT = join(ROOT, 'data', 'song_features.json')
const FFMPEG = join(ROOT, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
const RATE = 44100

const cache: Record<string, SongFeatures> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const files = readdirSync(SONGS).filter((f) => /\.(flac|wav|mp3|m4a|ogg|opus)$/i.test(f)).sort()

let done = 0
for (const f of files) {
  if (cache[f]) continue
  const t0 = Date.now()
  const pcm = execFileSync(FFMPEG, ['-v', 'error', '-i', join(SONGS, f), '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], {
    maxBuffer: 1 << 30,
  })
  const all = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
  const L = new Float32Array(all.length / 2), R = new Float32Array(all.length / 2)
  for (let i = 0; i < L.length; i++) {
    L[i] = all[2 * i]
    R[i] = all[2 * i + 1]
  }
  cache[f] = analyzeSong([L, R], RATE)
  writeFileSync(OUT, JSON.stringify(cache, null, 1))
  done++
  console.log(`${done}/${files.length - Object.keys(cache).length + done} ${f} (${Date.now() - t0} ms)`)
}
console.log(`done: ${Object.keys(cache).length} songs measured`)

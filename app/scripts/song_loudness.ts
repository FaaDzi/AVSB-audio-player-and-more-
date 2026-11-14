/**
 * Measure every song in songs/originals for Smart volume (BS.1770 integrated loudness + sample
 * peak, src/audio/smartVolume.ts), decoding with the bundled ffmpeg at 48 kHz like the phone does.
 * build_songs.ts copies the result into the song list, so the player doesn't measure bundled songs.
 * Resumable: results are cached in data/song_loudness.json.
 *
 * Usage (from app/): npx vite-node scripts/song_loudness.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureLoudness } from '../src/audio/smartVolume'

const ROOT = join(import.meta.dirname, '..', '..')
const SONGS = join(ROOT, 'songs', 'originals')
const OUT = join(ROOT, 'data', 'song_loudness.json')
const FFMPEG = join(ROOT, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
const RATE = 48000

const cache: Record<string, { lufs: number; peak: number }> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const files = readdirSync(SONGS).filter((f) => /\.(flac|wav|mp3|m4a|ogg|opus)$/i.test(f)).sort()

let done = 0
for (const f of files) {
  if (cache[f]) continue
  const pcm = execFileSync(FFMPEG, ['-v', 'error', '-i', join(SONGS, f), '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], {
    maxBuffer: 1 << 30,
  })
  const all = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
  const L = new Float32Array(all.length / 2), R = new Float32Array(all.length / 2)
  for (let i = 0; i < L.length; i++) {
    L[i] = all[2 * i]
    R[i] = all[2 * i + 1]
  }
  const m = measureLoudness([L, R], RATE)
  cache[f] = { lufs: Math.round(m.lufs * 100) / 100, peak: Math.round(m.peak * 10000) / 10000 }
  done++
  if (done % 20 === 0) writeFileSync(OUT, JSON.stringify(cache, null, 1))
}
writeFileSync(OUT, JSON.stringify(cache, null, 1))
console.log(`done: ${done} measured, ${Object.keys(cache).length} cached`)

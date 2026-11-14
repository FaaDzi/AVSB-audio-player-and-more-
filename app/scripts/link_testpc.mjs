// A stand-in PC for testing the phone side of the link (plan §70 D4) without the exe: the real link code
// (electron/link), Allow answered yes, a few songs from songs/lossless. Prints the pairing link; with --adb it opens the
// link on the connected phone.
// Usage (from app/): node scripts/link_testpc.mjs [--adb] [--songs 3]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import iroh from '@number0/iroh'
import { createLink } from '../electron/link/link.mjs'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lossless = path.join(app, '..', 'songs', 'lossless')
const count = Number(process.argv[process.argv.indexOf('--songs') + 1]) || 3
const files = fs.readdirSync(lossless).filter((f) => /\.flac$/i.test(f)).slice(0, count)
const tracks = files.map((f, i) => {
  const [title, artist] = f.replace(/\.flac$/i, '').split(' - ')
  return { id: `test${i}`, path: path.join(lossless, f), title, artist: artist ?? '', album: 'Link test', format: 'FLAC', lossy: false, bits: 16, rate: 44100, sec: 200, size: fs.statSync(path.join(lossless, f)).size, cover: '' }
})
const dataDir = path.join(app, '..', '.cache', 'link-testpc')
fs.mkdirSync(dataDir, { recursive: true })

const link = createLink({
  iroh,
  dataDir,
  protect: (b) => b,
  unprotect: (b) => b,
  library: { state: () => ({ tracks, version: 1 }), allowed: (p) => (p.startsWith(lossless) ? p : null), coverFile: () => null },
  pcName: () => `${os.hostname()} (test)`,
  askAllow: async ({ name }) => { console.log(`Allow ${name}? yes`); return true },
  onChange: () => {},
  log: (line) => console.log(`[link] ${line}`),
})
const { link: url } = await link.pair()
console.log(`serving ${tracks.length} songs: ${files.join(', ')}`)
console.log(`PAIR ${url}`)
if (process.argv.includes('--adb')) {
  const adb = process.env.ADB ?? 'D:/Project/Android/Sdk/platform-tools/adb.exe'
  // quoted for the phone's shell: the link has & in it
  spawnSync(adb, ['shell', `am start -a android.intent.action.VIEW -d '${url}' com.iemdreambracket.app`], { stdio: 'inherit' })
}
setInterval(() => {}, 1 << 30)

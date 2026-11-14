// Packages the new UI into release/shell/win-unpacked. Doesn't touch the old app's release/win-unpacked.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = path.join(app, '..', '.cache')
const env = {
  ...process.env,
  ELECTRON_CACHE: path.join(cache, 'electron'),
  electron_config_cache: path.join(cache, 'electron'),
  ELECTRON_BUILDER_CACHE: path.join(cache, 'electron-builder'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
}

// Packaging clears win-unpacked, and the app keeps its settings and statistics in there. They wait outside it meanwhile.
const output = path.join(app, 'release', 'shell')
const userData = path.join(output, 'win-unpacked', 'user-data')
const kept = path.join(output, 'user-data-kept')
if (existsSync(userData)) renameSync(userData, kept)
const putBack = () => {
  if (!existsSync(kept)) return
  mkdirSync(path.dirname(userData), { recursive: true })
  renameSync(kept, userData)
}

for (const command of ['npx tsc -b', 'npx vite build --config vite.shell.config.ts', 'node scripts/bundle_scanner.mjs', 'npx electron-builder --win dir --config electron-builder.shell.json']) {
  console.log(`\n> ${command}`)
  const run = spawnSync(command, { stdio: 'inherit', env, shell: true, cwd: app })
  if (run.status !== 0) {
    putBack()
    process.exit(run.status ?? 1)
  }
}
putBack()
console.log(`\nReady: ${path.join(app, 'release', 'shell', 'win-unpacked', 'AVSB.exe')}`)

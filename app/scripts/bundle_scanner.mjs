// Bundles the Local Library scanner (electron/library-scan.mjs) and music-metadata into one file for the packaged app,
// which carries no node_modules. Run by scripts/dist_shell.mjs.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [path.join(app, 'electron', 'library-scan.mjs')],
  outfile: path.join(app, 'electron', 'library-scan.bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // some dependencies call require() for Node's own modules, which an ES module doesn't have by itself
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
})
console.log('Scanner bundled')

// the phone link (plan §70 D1) with qrcode; iroh stays outside, a native module shipped in node_modules/@number0
await build({
  entryPoints: [path.join(app, 'electron', 'link', 'index.mjs')],
  outfile: path.join(app, 'electron', 'link.bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@number0/iroh'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
})
console.log('Link bundled')

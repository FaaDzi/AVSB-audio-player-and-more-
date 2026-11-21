import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist-shell')
/** What the Database page reads through data/catalog.ts, plus the averaged measurements the tournament simulates with. */
const DATABASE_FILES = ['iems.json', 'headphones.json', 'reviews.json', 'review_points.json', 'images.json', 'images_archive.json', 'images_search.json', 'images_brand_a.json', 'images_brand_b.json', 'images_brand_c.json', 'prices.json', 'squig.json', 'targets.json', 'aliases.json', 'refs.json',
  // also fetched by shared code the app uses: DAC/dongle detection (fit/detect.ts), the ear-tip guide, the song list
  'devices.json', 'eartips.json', 'eartips_jay.json', 'songs.json',
  // generic presets, speakers and the soundbar (§78 B, C)
  'generic.json', 'speakers.json', 'phone_speakers.json']

/**
 * The library list, covers and lyrics are read at /shell-fixture/ until Local Library replaces them.
 * GalleryPlayer loads the virtual speakers' data from /data/hrir/.
 */
function copyRuntimeData(): Plugin {
  return {
    name: 'copy-shell-data',
    apply: 'build',
    closeBundle() {
// (the dev server's sample library in shell-fixture/ is not shipped: it's one person's song list and covers)
      cpSync(join(here, 'public', 'data', 'hrir'), join(out, 'data', 'hrir'), { recursive: true })
      for (const file of DATABASE_FILES) cpSync(join(here, 'public', 'data', file), join(out, 'data', file))
      cpSync(join(here, 'public', 'img'), join(out, 'img'), { recursive: true })
      // tournament (§64, §65): the bursts, the VS speed lines and the recorded sounds
      cpSync(join(here, 'public', 'fx'), join(out, 'fx'), { recursive: true, filter: (f) => !/fire-\d\.webm$/.test(f) })
      cpSync(join(here, 'public', 'sfx'), join(out, 'sfx'), { recursive: true })
      // head tracking's face model and WASM (headtrack/camera.ts loads them from ./mediapipe/)
      if (existsSync(join(here, 'public', 'mediapipe'))) cpSync(join(here, 'public', 'mediapipe'), join(out, 'mediapipe'), { recursive: true })
      cpSync(join(here, 'node_modules', 'kuromoji', 'dict'), join(out, 'kuromoji-dict'), { recursive: true })
    },
  }
}

/**
 * What the built page may load (PC exe and APK; the dev server is left alone, its hot reload needs inline scripts).
 * Scripts, workers and fonts: the app's own files only, no inline or eval (WASM for head tracking is allowed).
 * Network: the app's own host (which carries /shell-host/, the native side's door to files and metadata) and LRCLIB,
 * the one service the page calls directly. Pictures may come from any https site (artist photos, cover lookups).
 * A new outside service has to be added here, or go through /shell-host/meta.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: http://127.0.0.1:*",
  "font-src 'self' data:",
  "connect-src 'self' https://lrclib.net https://api.github.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'shell-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  }
}

// Builds only the new UI, for electron/shell-main.cjs. The rest of the old app's public/ folder isn't included.
export default defineConfig({
  plugins: [react(), copyRuntimeData(), contentSecurityPolicy()],
  publicDir: false,
  worker: { format: 'es' },
  // kuromoji's own entry reads files through Node; its browser build carries what it needs
  resolve: { alias: { kuromoji: 'kuromoji/build/kuromoji.js' } },
  build: {
    outDir: out,
    sourcemap: true,
    rollupOptions: { input: join(here, 'shell.html') },
  },
})

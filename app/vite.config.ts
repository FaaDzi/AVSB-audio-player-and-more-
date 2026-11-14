import { execFile } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/**
 * Head tracking (plan §32 phase 4) runs MediaPipe offline: copy its ES-module WASM build from
 * node_modules into public/mediapipe/wasm/ and fetch the face model once if it isn't there yet.
 */
function mediapipeAssets(): Plugin {
  return {
    name: 'mediapipe-assets',
    async buildStart() {
      const src = join(here, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
      const out = join(here, 'public', 'mediapipe')
      mkdirSync(join(out, 'wasm'), { recursive: true })
      for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
        const from = join(src, f)
        const to = join(out, 'wasm', f)
        if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to)
      }
      const model = join(out, 'face_landmarker.task')
      if (existsSync(model)) return
      try {
        const res = await fetch(MODEL_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        writeFileSync(model, Buffer.from(await res.arrayBuffer()))
      } catch (e) {
        this.warn(`face_landmarker.task missing and could not be downloaded (${String(e)}); head tracking won't load`)
      }
    },
  }
}

/**
 * Dynamic Color for the new shell while it runs on the dev server: reports Windows' accent colour, which follows
 * the wallpaper when Windows is set to choose it. Electron gets this from systemPreferences once the shell moves there.
 */
function shellHost(): Plugin {
  return {
    name: 'shell-host',
    apply: 'serve',
    async configureServer(server) {
      // Local Library, the same scanner as the exe. Its data sits in .cache/dev-shell-data; the first time, songs/lossless
      // is the one folder, as before.
      const { createLibrary, MIME } = await import('./electron/library-scan.mjs')
      const dataDir = resolve(here, '..', '.cache', 'dev-shell-data')
      const library = createLibrary({ dataDir, log: (line) => server.config.logger.info(`[library] ${line}`) })
      const songs = resolve(here, '..', 'songs', 'lossless')
      if (!library.folders().length && existsSync(songs) && !existsSync(join(dataDir, 'library', 'from-old-folder'))) {
        library.setFolders([{ path: songs, subfolders: true }])
        writeFileSync(join(dataDir, 'library', 'from-old-folder'), songs)
      }
      const query = (req: { url?: string }) => new URL(req.url ?? '', 'http://x').searchParams
      const json = (res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }, value: unknown) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(value))
      }
      const sendFile = (res: import('node:http').ServerResponse, file: string | null, type: string) => {
        if (!file || !existsSync(file)) { res.statusCode = 404; res.end(); return }
        res.setHeader('Content-Type', type)
        res.setHeader('Content-Length', statSync(file).size)
        createReadStream(file).pipe(res)
      }
      server.middlewares.use('/shell-host/library', (req, res) => {
        const route = new URL(req.url ?? '', 'http://x').pathname
        if (route === '/' || route === '') return json(res, library.state())
        if (route === '/scan' && req.method === 'POST') {
          void library.scan({ full: query(req).get('full') === '1' })
          return json(res, { started: true })
        }
        if (route === '/folders' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
          req.on('end', () => {
            try { library.setFolders(JSON.parse(body)) } catch { /* bad body changes nothing */ }
            json(res, library.state().folders)
          })
          return
        }
        res.statusCode = 404
        res.end()
      })
      server.middlewares.use('/shell-host/cover', (req, res) => {
        const file = library.coverFile(query(req).get('id'))
        sendFile(res, file, { '.png': 'image/png', '.webp': 'image/webp' }[extname(file ?? '')] ?? 'image/jpeg')
      })
      server.middlewares.use('/shell-host/lyrics', (req, res) => sendFile(res, library.lyricsFile(query(req).get('id')), 'text/plain; charset=utf-8'))
      // the songs themselves: only files inside a chosen folder are ever served
      server.middlewares.use('/shell-host/audio', (req, res) => {
        const file = library.allowed(query(req).get('path'))
        sendFile(res, file, MIME[extname(file ?? '').toLowerCase()] ?? 'application/octet-stream')
      })
      // the romaji dictionary, straight from the package
      const dictionary = resolve(here, 'node_modules', 'kuromoji', 'dict')
      server.middlewares.use('/kuromoji-dict', (req, res, next) => {
        const file = resolve(dictionary, `.${new URL(req.url ?? '', 'http://x').pathname}`)
        if (!file.startsWith(dictionary + sep) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
      // song details lookup, the same allowed addresses as the exe
      const { fetchMeta } = createRequire(import.meta.url)('./electron/meta-proxy.cjs') as {
        fetchMeta: (url: string | null) => Promise<{ status: number; type: string; body: Buffer } | null>
      }
      server.middlewares.use('/shell-host/meta', (req, res) => {
        fetchMeta(new URL(req.url ?? '', 'http://x').searchParams.get('url'))
          .then((found) => {
            res.statusCode = found ? found.status : 404
            if (found) res.setHeader('Content-Type', found.type)
            res.end(found?.body)
          })
          .catch(() => { res.statusCode = 502; res.end() })
      })
      server.middlewares.use('/shell-host/accent', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        // AccentColorMenu is the accent Settings shows (0xAABBGGRR). The DWM key can hold an old colour.
        execFile(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'reg.exe'), ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent', '/v', 'AccentColorMenu'], { windowsHide: true }, (error, stdout) => {
          const value = !error && /0x[0-9a-f]{2}([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(stdout)
          res.end(JSON.stringify(value ? { accent: `#${value[3]}${value[2]}${value[1]}`.toLowerCase() } : {}))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mediapipeAssets(), shellHost()],
  server: {
    // the Android build (Gradle output, the 1 GB APK) must not trigger reloads or lock-file errors
    watch: { ignored: ['**/android/**', '**/dist-android/**', '**/release/**'] },
  },
  worker: { format: 'es' },
  // kuromoji's own entry reads files through Node; its browser build carries what it needs
  resolve: { alias: { kuromoji: 'kuromoji/build/kuromoji.js' } },
})

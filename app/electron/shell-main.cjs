// The Electron host for the new UI (src/shell). The old app keeps main.cjs until the new one replaces it.
const { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, powerSaveBlocker, protocol, safeStorage, shell, Tray, utilityProcess } = require('electron')
const os = require('node:os')
const { randomBytes } = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { fetchMeta } = require('./meta-proxy.cjs')
const { resolveFfmpegBin } = require('./ffmpeg.cjs')

// The app's data (settings, stats, the pairing key, paired phones) lives in the user's own Windows folder, not in
// the program folder (plan §84 H): an update is "delete the old folder, unzip the new one", and that used to take
// everything with it. A `user-data` folder still beside the exe (1.0, or carried over by hand) is moved across once.
const besideExe = path.join(path.dirname(process.execPath), 'user-data')
const dataDir = app.isPackaged
  ? path.join(app.getPath('appData'), 'AVSB')
  : path.join(__dirname, '..', '..', '.cache', 'electron-shell-data')
let movedData = null
if (app.isPackaged && fs.existsSync(besideExe) && !fs.existsSync(dataDir)) {
  const half = `${dataDir}.moving`
  try {
    fs.rmSync(half, { recursive: true, force: true })
    // caches rebuild themselves, and the lock belongs to whichever copy is running
    fs.cpSync(besideExe, half, { recursive: true, filter: (src) => !/(Cache|lockfile|DevToolsActivePort)$/i.test(path.basename(src)) })
    fs.renameSync(half, dataDir)
    // the old folder goes only after the whole copy is in place; if that fails it is simply left behind
    try { fs.rmSync(besideExe, { recursive: true, force: true }) } catch { /* in use: harmless, the new folder wins from now on */ }
    movedData = `Moved saved data from ${besideExe} to ${dataDir}`
  } catch (e) {
    movedData = `Could not move saved data (${e?.message ?? e}); a fresh folder is used at ${dataDir}`
  }
}
app.setPath('userData', dataDir)
app.setPath('crashDumps', path.join(dataDir, 'crashes'))
// crash reports stay in that folder and are never sent anywhere
crashReporter.start({ uploadToServer: false })

// A log that survives whatever ends the app, for working out afterwards why it closed. A session with no "Quit" line
// at its end was ended from outside, or by a crash.
const logFile = path.join(dataDir, 'logs', 'app.log')
const LOG_LIMIT_BYTES = 2e6

function logToFile(message) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // a log that can't be written must never take the app down
  }
}
if (movedData) logToFile(movedData)

try {
  if (fs.statSync(logFile).size > LOG_LIMIT_BYTES) fs.renameSync(logFile, `${logFile}.old`)
} catch {
  // no log yet
}
logToFile(`Started, version ${app.getVersion()}, process ${process.pid}`)
process.on('uncaughtException', (e) => logToFile(`Main process error: ${e.stack ?? e}`))
process.on('unhandledRejection', (e) => logToFile(`Main process rejection: ${e}`))

// one copy at a time: two would fight over the same saved data
const isFirstCopy = app.requestSingleInstanceLock()
if (!isFirstCopy) {
  logToFile('Another copy is already open, so this one is closing')
  app.exit(0)
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const DIST = path.join(__dirname, '..', 'dist-shell')
const notFound = () => new Response(null, { status: 404 })
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }

// Before Local Library (plan section 63) the app had one folder: the one chosen before, else songs/lossless above the
// app. That folder becomes the first library folder, once. On another PC neither exists, and the page asks.
const savedRootFile = () => path.join(dataDir, 'library-folder.json')

function savedRoot() {
  try {
    const { folder } = JSON.parse(fs.readFileSync(savedRootFile(), 'utf8'))
    return typeof folder === 'string' && isDir(folder) ? folder : null
  } catch {
    return null
  }
}

function nearbyRoot() {
  let dir = app.isPackaged ? path.dirname(process.execPath) : __dirname
  for (;;) {
    const candidate = path.join(dir, 'songs', 'lossless')
    if (isDir(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}


// set once the app is ready
let library = null

/** A song inside one of the library folders, from its full path, or null. Nothing outside them is ever reached. */
function songFile(wanted) {
  const file = library?.allowed(wanted)
  return file && isFile(file) ? file : null
}

const FFMPEG_BIN = resolveFfmpegBin()

function serveAudio(wanted, lowdata = false) {
  const file = songFile(wanted)
  if (!file) return notFound()
  const hasFfmpeg = FFMPEG_BIN === 'ffmpeg' || isFile(FFMPEG_BIN)
  if (lowdata && hasFfmpeg) {
    const { spawn } = require('node:child_process')
    const proc = spawn(FFMPEG_BIN, ['-v', 'error', '-i', file, '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', '-'], { windowsHide: true })
    let closed = false
    const stream = new ReadableStream({
      start(controller) {
        proc.stdout.on('data', (chunk) => {
          if (closed) return
          try {
            controller.enqueue(new Uint8Array(chunk))
          } catch {
            closed = true
            try { proc.kill() } catch {}
          }
        })
        proc.stdout.on('end', () => {
          if (closed) return
          closed = true
          try { controller.close() } catch {}
        })
        proc.on('error', (err) => {
          if (closed) return
          closed = true
          try { controller.error(err) } catch {}
        })
      },
      cancel() {
        closed = true
        try { proc.kill() } catch {}
      }
    })
    return new Response(stream, { headers: { 'Content-Type': 'audio/ogg; codecs=opus' } })
  }
  return net.fetch(pathToFileURL(file).toString())
}

/**
 * §72.B2 — Moves a song inside the chosen library folders to the Windows Recycle Bin (`shell.trashItem`),
 * along with its matching `.lrc` sidecar if one sits beside it. Refuses any path outside the library folders.
 */
async function trashTrackItem(wantedPathOrId) {
  if (!wantedPathOrId || !library) return { ok: false, error: 'not found' }
  const target = String(wantedPathOrId)
  const byId = library.state().tracks.find((t) => t.id === target || t.path === target)
  const file = songFile(byId ? byId.path : target)
  if (!file) return { ok: false, error: 'not in library' }
  try {
    await shell.trashItem(file)
    const lrc = file.slice(0, -path.extname(file).length) + '.lrc'
    if (isFile(lrc) && library.allowed(lrc)) {
      await shell.trashItem(lrc).catch(() => {})
    }
    logToFile(`Library: moved to Recycle Bin: ${file}`)
    void library.scan({ full: false })
    return { ok: true, trashed: true }
  } catch (e) {
    logToFile(`Library: couldn't move to Recycle Bin (${file}): ${e?.message ?? e}`)
    return { ok: false, error: String(e?.message ?? e) }
  }
}

async function serveTrashTrack(req, url) {
  let target = url.searchParams.get('path') || url.searchParams.get('id')
  if (!target && req.method === 'POST') {
    try {
      const body = await req.json()
      target = body?.path || body?.id
    } catch {
      // ignore malformed JSON
    }
  }
  const result = await trashTrackItem(target)
  return Response.json(result, { status: result.ok ? 200 : 404 })
}

/** Library scanner bundle lives beside shell-main.cjs in packaged builds. */
async function loadScanner() {
  const bundle = path.join(__dirname, 'library-scan.bundle.mjs')
  // development reads the source, so a stale bundle can't stand in for it
  return import(pathToFileURL(app.isPackaged ? bundle : path.join(__dirname, 'library-scan.mjs')).toString())
}

function classifyMetric(m) {
  // name is what utilityProcess.fork was given ('AVSB Streaming Host'); serviceName is the Mojo interface (node.mojom.NodeService)
  const svc = String(m.name || m.serviceName || '')
  if (m.type === 'Browser') return 'AVSB - Core & Library Host'
  if (m.type === 'Tab') return 'AVSB - Music Player UI'
  if (m.type === 'GPU') return 'AVSB - Graphics & Compositor'
  if (svc.includes('Streaming Host')) return 'AVSB - Streaming Host (Phone Link)'
  if (svc.includes('Audio') || m.type.includes('Audio')) return 'AVSB - Audio Engine'
  if (svc.includes('Network') || m.type.includes('Network')) return 'AVSB - Network Service'
  if (svc.includes('Storage')) return 'AVSB - Storage Service'
  return `AVSB - ${svc || m.type || 'Worker'}`
}

/**
 * The PC's link key at rest: encrypted with Windows' DPAPI for this Windows account. Without it (it's always there on
 * Windows) the key would be stored plain, so the log says so.
 */
const protectKey = (bytes) => {
  if (!safeStorage.isEncryptionAvailable()) {
    logToFile('Link: secure storage unavailable, link key stored unencrypted')
    return bytes
  }
  return safeStorage.encryptString(bytes.toString('base64'))
}
const unprotectKey = (stored) => (safeStorage.isEncryptionAvailable() ? Buffer.from(safeStorage.decryptString(stored), 'base64') : stored)

/** Covers are kept at most 640 px wide, as JPEG. A format nativeImage can't read is kept as it came. */
async function saveCover(base, bytes, mime) {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) {
    const file = `${base}.${/png/.test(mime || '') ? 'png' : /webp/.test(mime || '') ? 'webp' : 'jpg'}`
    await fs.promises.writeFile(file, bytes)
    return file
  }
  const small = image.getSize().width > 640 ? image.resize({ width: 640, quality: 'good' }) : image
  await fs.promises.writeFile(`${base}.jpg`, small.toJPEG(85))
  return `${base}.jpg`
}

const typeOf = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function serveFile(file, type) {
  if (!file || !isFile(file)) return notFound()
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=31536000' } })
}

  let pushLibrarySnapshot = () => {}

  /** Local Library's routes: the list, a scan, the folder list, covers and lyrics. */
  async function serveLibrary(req, url) {
    if (url.pathname === '/shell-host/library') {
      pushLibrarySnapshot()
      return Response.json(library.state())
    }
    if (url.pathname === '/shell-host/library/scan' && req.method === 'POST') {
      void library.scan({ full: url.searchParams.get('full') === '1' }).finally(() => pushLibrarySnapshot(true))
      return Response.json({ started: true })
    }
    if (url.pathname === '/shell-host/library/folders' && req.method === 'POST') {
      library.setFolders(await req.json())
      pushLibrarySnapshot(true)
      return Response.json(library.state().folders)
    }
    if (url.pathname === '/shell-host/cover') {
      const file = library.coverFile(url.searchParams.get('id'))
      return serveFile(file, typeOf[path.extname(file || '')] || 'image/jpeg')
    }
    if (url.pathname === '/shell-host/lyrics') {
      const file = library.lyricsFile(url.searchParams.get('id'))
      return file && isFile(file) ? serveFile(file, 'text/plain; charset=utf-8') : notFound()
    }
    return notFound()
  }

const MOTION_TYPES = { 'image/gif': true, 'image/webp': true }

/** A GIF or WebP stored in a FLAC's picture blocks, or null. Reads only the tags at the start of the file. */
function embeddedMotion(file) {
  if (!/\.flac$/i.test(file)) return null
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    if (head.toString('latin1') !== 'fLaC') return null
    let at = 4
    for (;;) {
      if (fs.readSync(fd, head, 0, 4, at) < 4) return null
      const last = (head[0] & 0x80) !== 0
      const type = head[0] & 0x7f
      const size = head.readUIntBE(1, 3)
      at += 4
      if (type === 6) {
        const block = Buffer.alloc(size)
        fs.readSync(fd, block, 0, size, at)
        const mimeLength = block.readUInt32BE(4)
        const mime = block.toString('latin1', 8, 8 + mimeLength)
        if (MOTION_TYPES[mime]) {
          let p = 8 + mimeLength
          p += 4 + block.readUInt32BE(p) + 16
          const length = block.readUInt32BE(p)
          return new Response(block.subarray(p + 4, p + 4 + length), { headers: { 'Content-Type': mime } })
        }
      }
      if (last) return null
      at += size
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** The song's animated cover: in the file, then beside it with the same name, then cover.gif or cover.webp in its folder. */
function serveMotion(wanted) {
  const file = songFile(wanted)
  if (!file) return notFound()
  try {
    const inFile = embeddedMotion(file)
    if (inFile) return inFile
  } catch {
    // a damaged tag block just means no animated cover
  }
  const stem = file.slice(0, -path.extname(file).length)
  const dir = path.dirname(file)
  const beside = [`${stem}.gif`, `${stem}.webp`, path.join(dir, 'cover.gif'), path.join(dir, 'cover.webp')].find(isFile)
  return beside ? net.fetch(pathToFileURL(beside).toString()) : notFound()
}

// AccentColorMenu is the accent Settings shows (0xAABBGGRR). The DWM key can hold an old colour. Same read as the dev server's.
function serveAccent() {
  const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  return new Promise((resolve) => {
    execFile(reg, ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent', '/v', 'AccentColorMenu'], { windowsHide: true }, (error, stdout) => {
      const value = !error && /0x[0-9a-f]{2}([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(stdout)
      resolve(Response.json(value ? { accent: `#${value[3]}${value[2]}${value[1]}`.toLowerCase() } : {}))
    })
  })
}

// Song details from MusicBrainz, Cover Art Archive or Deezer, only for the addresses meta-proxy.cjs allows.
async function serveMeta(wanted) {
  try {
    const found = await fetchMeta(wanted, net.fetch)
    return found ? new Response(found.body, { status: found.status, headers: { 'Content-Type': found.type } }) : notFound()
  } catch (e) {
    logToFile(`Details lookup failed: ${e}`)
    return new Response(null, { status: 502 })
  }
}

function serveStatic(pathname) {
  const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
  if (!file.startsWith(DIST + path.sep) || !isFile(file)) return notFound()
  return net.fetch(pathToFileURL(file).toString())
}

const ownPage = (url) => (url || '').startsWith('app://local')
// Nothing in the UI uses these, so they stay off.
const REFUSED = new Set(['media', 'display-capture', 'geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb'])

app.whenReady().then(async () => {
  if (!isFirstCopy) return
  const { createLibrary } = await loadScanner()
  library = createLibrary({ dataDir, saveCover, log: (line) => logToFile(`Library: ${line}`) })
  // the old single folder becomes the first library folder, once
  const oldRoot = savedRoot() ?? nearbyRoot()
  const migrated = path.join(dataDir, 'library', 'from-old-folder')
  if (!library.folders().length && oldRoot && !fs.existsSync(migrated)) {
    library.setFolders([{ path: oldRoot, subfolders: true }])
    fs.writeFileSync(migrated, oldRoot)
    logToFile(`Library: started with ${oldRoot}`)
  }

  protocol.handle('app', (req) => {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/shell-host/library') || url.pathname === '/shell-host/cover' || url.pathname === '/shell-host/lyrics') return serveLibrary(req, url)
    if (url.pathname === '/shell-host/audio') return serveAudio(url.searchParams.get('path'), url.searchParams.get('lowdata') === '1')
    if (url.pathname === '/shell-host/motion') return serveMotion(url.searchParams.get('path'))
    if (url.pathname === '/shell-host/accent') return serveAccent()
    if (url.pathname === '/shell-host/meta') return serveMeta(url.searchParams.get('url'))
    if (url.pathname === '/shell-host/trash-track') return serveTrashTrack(req, url)
    return serveStatic(url.pathname)
  })

  ipcMain.handle('choose-folder', async () => {
    const picked = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: 'Choose your music folder', properties: ['openDirectory'] })
    return picked.canceled ? null : picked.filePaths[0] ?? null
  })

  ipcMain.handle('open-song', async (_event, wanted) => {
    const file = songFile(wanted)
    // openPath answers with an error message, and an empty one means it worked
    return file ? (await shell.openPath(file)) === '' : false
  })

  ipcMain.handle('trash-track', (_event, wanted) => trashTrackItem(wanted))

  // §119: the EQ in other apps on Windows = Equalizer APO. Its config folder (registry ConfigPath, under Program Files)
  // gets an AVSB.txt include, replaced atomically on every change, and one "Include: AVSB.txt" line in config.txt.
  // The folder needs admin once: Windows asks, and only that folder's write access is granted to this user.
  let apoAskedAdmin = false
  const apoConfigDir = () => new Promise((resolve) => {
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\EqualizerAPO', '/v', 'ConfigPath'], { windowsHide: true }, (err, out) => {
      const m = !err && /ConfigPath\s+REG_\w+\s+(.+)/i.exec(String(out))
      resolve(m ? m[1].trim() : null)
    })
  })
  const apoWrite = (dir, text) => {
    const tmp = path.join(dir, `AVSB.txt.${process.pid}.tmp`)
    const crlf = (t) => t.replace(/\r?\n/g, '\r\n')
    fs.writeFileSync(tmp, crlf(`# AVSB: written by the app while "EQ in Equalizer APO" is on\n${text ?? ''}`))
    fs.renameSync(tmp, path.join(dir, 'AVSB.txt'))
    const cfg = path.join(dir, 'config.txt')
    const now = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : ''
    if (!/^\s*Include:\s*AVSB\.txt\s*$/im.test(now)) fs.appendFileSync(cfg, `${now && !now.endsWith('\n') ? '\r\n' : ''}Include: AVSB.txt\r\n`)
  }
  ipcMain.handle('apo-write', async (_event, text) => {
    if (text !== null && (typeof text !== 'string' || text.length > 20000)) return { ok: false, error: 'refused' }
    const dir = await apoConfigDir()
    if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Equalizer APO is not installed' }
    try {
      apoWrite(dir, text)
      return { ok: true }
    } catch (e) {
      if (e.code !== 'EACCES' && e.code !== 'EPERM') return { ok: false, error: String(e.message ?? e) }
      if (apoAskedAdmin) return { ok: false, error: 'No write access to the Equalizer APO folder' }
      apoAskedAdmin = true
      // one UAC prompt: give this Windows user Modify on APO's config folder only
      const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      const ps = `Start-Process icacls -ArgumentList '"${dir.replace(/'/g, "''")}" /grant "${user.replace(/'/g, "''")}:(OI)(CI)M"' -Verb RunAs -Wait -WindowStyle Hidden`
      await new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => resolve()))
      try { apoWrite(dir, text); return { ok: true } } catch (e2) { return { ok: false, error: String(e2.message ?? e2) } }
    }
  })

  ipcMain.handle('save-lyrics', async (_event, wanted, text) => {
    const file = songFile(wanted)
    if (!file || typeof text !== 'string' || !text.trim() || text.length > 200000) return 'refused'
    const lrc = file.slice(0, -path.extname(file).length) + '.lrc'
    try {
      // 'wx' fails if the file exists: the listener's own .lrc is never replaced
      await fs.promises.writeFile(lrc, text, { encoding: 'utf8', flag: 'wx' })
      return 'saved'
    } catch (e) {
      return e && e.code === 'EEXIST' ? 'exists' : 'refused'
    }
  })

  // ---- the phone link (plan §70 D1): isolated in a dedicated utilityProcess ('AVSB Streaming Host')
  let linkWorker = null
  let linkWorkerReady = false
  let lastLinkStatus = { running: false, online: false, id: null, pairing: false, phones: [] }
  let linkRpcSeq = 0
  const linkRpcPending = new Map()
  let linkWorkerRestarts = []
  let awake = null
  // §84 F: the PC has to be awake to serve a phone (a sleeping PC freezes this app; nothing can wake it from mobile
  // data). So with a phone paired the PC is kept from idle sleep (the screen still turns off): always on mains
  // power, on battery only while a phone is actually connected. Both switches are in the tray menu.
  const powerFile = path.join(dataDir, 'power.json')
  const power = { keepAwake: true, startWithWindows: false }
  try { Object.assign(power, JSON.parse(fs.readFileSync(powerFile, 'utf8'))) } catch { /* first run */ }
  const savePower = () => { try { fs.writeFileSync(powerFile, JSON.stringify(power)) } catch { /* read-only folder */ } }
  const applyAwake = () => {
    const phones = lastLinkStatus?.phones ?? []
    const want = power.keepAwake && (phones.some((p) => p.connected) || (phones.length > 0 && !powerMonitor.isOnBatteryPower()))
    if (want && awake === null) { awake = powerSaveBlocker.start('prevent-app-suspension'); logToFile('Keeping the PC awake for paired phones') }
    if (!want && awake !== null) { powerSaveBlocker.stop(awake); awake = null; logToFile('PC may sleep again') }
  }
  powerMonitor.on('on-ac', applyAwake)
  powerMonitor.on('on-battery', applyAwake)
  const applyStartup = () => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: power.startWithWindows, args: ['--hidden'] })
  }
  let winRef = null
  let isQuitting = false
  let tray = null
  let updateTrayMenu = () => {}
  let savedBounds = null
  let lastPushedVersion = -1
  // §80 A: the page's playlists as JSON, kept here so a restarted link worker gets them again
  let lastPlaylistsJson = null
  // §114 G: the page's EQ outbox, likewise
  let lastEqOutbox = null

  function loadOrCreateLinkSecretKey() {
    const keyFile = path.join(dataDir, 'link', 'key.bin')
    fs.mkdirSync(path.dirname(keyFile), { recursive: true })
    try {
      const bytes = unprotectKey(fs.readFileSync(keyFile))
      if (bytes.length === 32) return Array.from(bytes)
    } catch {
      // Missing or invalid key from another account: generate fresh key protected with DPAPI
    }
    const raw = randomBytes(32)
    try {
      fs.writeFileSync(keyFile, protectKey(raw))
    } catch (e) {
      logToFile(`Link: failed to persist key: ${e?.message ?? e}`)
    }
    return Array.from(raw)
  }

  function buildLibrarySnapshot() {
    const st = library.state()
    return {
      tracks: st.tracks,
      folders: library.folders(),
      version: st.version,
      coversDir: path.join(dataDir, 'library', 'covers'),
    }
  }

  pushLibrarySnapshot = (force = false) => {
    if (!linkWorker || !library) return
    const snap = buildLibrarySnapshot()
    if (!force && snap.version === lastPushedVersion) return
    lastPushedVersion = snap.version
    try {
      linkWorker.postMessage({ type: 'library-snapshot', ...snap })
    } catch {
      // worker restarting
    }
  }

  const linkChanged = (nextStatus) => {
    if (nextStatus) lastLinkStatus = nextStatus
    applyAwake()
    winRef?.webContents.send('link-changed')
    updateTrayMenu()
  }

  function callLinkWorker(op, arg) {
    if (!linkWorker || !linkWorkerReady) {
      if (op === 'status') return Promise.resolve(lastLinkStatus)
      if (op === 'resync') return Promise.resolve(lastLinkStatus)
      if (op === 'remove') return Promise.resolve(false)
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      const id = `c_${++linkRpcSeq}`
      const timer = setTimeout(() => {
        if (linkRpcPending.delete(id)) {
          if (op === 'status' || op === 'resync') resolve(lastLinkStatus)
          else reject(new Error(`Streaming host timed out on ${op}`))
        }
      }, 20000)
      linkRpcPending.set(id, { resolve, reject, timer })
      linkWorker.postMessage({ type: 'call', id, op, arg })
    })
  }

  function spawnLinkWorker() {
    if (isQuitting || linkWorker) return
    try {
      const worker = utilityProcess.fork(path.join(__dirname, 'link-worker.cjs'), [], {
        serviceName: 'AVSB Streaming Host',
      })
      linkWorker = worker
      linkWorkerReady = false
      const secretKey = loadOrCreateLinkSecretKey()
      const snap = buildLibrarySnapshot()
      lastPushedVersion = snap.version
      worker.on('message', async (msg) => {
        if (!msg || typeof msg !== 'object') return
        if (msg.type === 'ready') {
          linkWorkerReady = true
          linkChanged(msg.status)
          return
        }
        if (msg.type === 'init-error') {
          logToFile(`Link: worker init error: ${msg.error}`)
          return
        }
        if (msg.type === 'log') {
          logToFile(`Link: ${msg.line}`)
          return
        }
        if (msg.type === 'changed') {
          linkChanged(msg.status)
          return
        }
        // a phone's playlists: the page merges them and sends its copy back
        if (msg.type === 'playlists-put') {
          winRef?.webContents.send('link-playlists', msg.sent)
          return
        }
        // §114 G: an EQ from a phone, and a phone that took its EQs: the page saves / clears them
        if (msg.type === 'eq-put' || msg.type === 'eq-taken') {
          winRef?.webContents.send('link-eq', msg)
          return
        }
        // a song a phone sent landed in the library folder: the page scans it in
        if (msg.type === 'uploaded') {
          logToFile(`Link: song from a phone saved to ${msg.file}`)
          winRef?.webContents.send('link-uploaded')
          return
        }
        if (msg.type === 'main-rpc' && msg.op === 'ask-allow') {
          let allowed = false
          try {
            const answer = await dialog.showMessageBox(winRef, {
              type: 'question',
              buttons: ['Allow', "Don't allow"],
              defaultId: 1,
              cancelId: 1,
              title: 'Pair a phone',
              message: `Allow "${msg.payload?.name ?? 'Phone'}" to play music from this PC?`,
              detail: 'It will see your song list and can play your songs. Nothing else on this PC is shared. You can remove it any time in Settings → Pair a phone.',
            })
            allowed = answer.response === 0
          } catch {
            allowed = false
          }
          try { worker.postMessage({ type: 'main-reply', id: msg.id, result: allowed }) } catch {}
          return
        }
        if (msg.type === 'reply') {
          const entry = linkRpcPending.get(msg.id)
          if (!entry) return
          linkRpcPending.delete(msg.id)
          clearTimeout(entry.timer)
          if (msg.ok) entry.resolve(msg.result)
          else entry.reject(new Error(msg.error || 'worker call failed'))
        }
      })
      worker.on('exit', (code) => {
        if (linkWorker === worker) {
          linkWorker = null
          linkWorkerReady = false
        }
        for (const [id, entry] of linkRpcPending.entries()) {
          clearTimeout(entry.timer)
          entry.reject(new Error('Streaming host exited'))
          linkRpcPending.delete(id)
        }
        if (!isQuitting) {
          logToFile(`Link: Streaming Host process exited (code ${code})`)
          const now = Date.now()
          linkWorkerRestarts = [...linkWorkerRestarts.filter((t) => now - t < 60000), now]
          if (linkWorkerRestarts.length <= 3) {
            setTimeout(() => spawnLinkWorker(), 1000)
          } else {
            logToFile('Link: Streaming Host kept stopping; disabled automatic restart')
          }
        }
      })
      worker.postMessage({
        type: 'init',
        dataDir,
        pcName: os.hostname(),
        isPackaged: app.isPackaged,
        ffmpegPath: FFMPEG_BIN,
        secretKey,
        snapshot: snap,
      })
      if (lastPlaylistsJson) worker.postMessage({ type: 'playlists-snapshot', json: lastPlaylistsJson })
      if (lastEqOutbox) worker.postMessage({ type: 'eq-outbox', byPhone: lastEqOutbox })
    } catch (e) {
      logToFile(`Link: not available: ${e?.stack ?? e}`)
    }
  }

  spawnLinkWorker()
  const syncTimer = setInterval(() => {
    if (library && (library.state().scanning || library.state().version !== lastPushedVersion)) {
      pushLibrarySnapshot()
    }
  }, 2500)

  ipcMain.on('link-push-playlists', (_event, json) => {
    if (typeof json !== 'string' || json.length > 4 * 1024 * 1024) return
    lastPlaylistsJson = json
    try { linkWorker?.postMessage({ type: 'playlists-snapshot', json }) } catch { /* worker restarting: sent again on init */ }
  })
  ipcMain.on('link-push-eq-outbox', (_event, json) => {
    if (typeof json !== 'string' || json.length > 4 * 1024 * 1024) return
    try { lastEqOutbox = JSON.parse(json) } catch { return }
    try { linkWorker?.postMessage({ type: 'eq-outbox', byPhone: lastEqOutbox }) } catch { /* worker restarting: sent again on init */ }
  })
  ipcMain.handle('link-status', () => callLinkWorker('status'))
  ipcMain.handle('link-resync', async () => {
    pushLibrarySnapshot(true)
    return callLinkWorker('resync')
  })
  ipcMain.handle('link-ping', async () => {
    pushLibrarySnapshot(true)
    return callLinkWorker('resync')
  })
  ipcMain.handle('link-pair', () => callLinkWorker('pair'))
  ipcMain.handle('link-stop-pairing', () => callLinkWorker('stopPairing'))
  ipcMain.handle('link-remove', (_event, id) => callLinkWorker('remove', String(id)))
  ipcMain.handle('link-rename', (_event, id, name) => callLinkWorker('rename', { id: String(id), name: String(name ?? '') }))
  ipcMain.handle('app-metrics', () =>
    app
      .getAppMetrics()
      .map((m) => ({
        pid: m.pid,
        type: m.type,
        serviceName: m.serviceName || m.name || '',
        label: classifyMetric(m),
        workingSetMB: Math.round(((m.memory?.workingSetSize ?? 0) / 1024) * 10) / 10,
        privateMB: typeof m.memory?.privateBytes === 'number' ? Math.round((m.memory.privateBytes / 1024) * 10) / 10 : null,
        cpuPercent: Math.round((m.cpu?.percentCPUUsage ?? 0) * 10) / 10,
      }))
      .sort((a, b) => (b.privateMB ?? b.workingSetMB) - (a.privateMB ?? a.workingSetMB)),
  )
  app.on('before-quit', () => {
    isQuitting = true
    clearInterval(syncTimer)
    if (awake !== null) { try { powerSaveBlocker.stop(awake) } catch {} awake = null }
    try { void callLinkWorker('stop').catch(() => {}) } catch {}
    if (linkWorker) {
      const w = linkWorker
      setTimeout(() => { try { w.kill() } catch {} }, 400)
    }
  })

  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    backgroundColor: '#121212',
    show: !process.argv.includes('--hidden'), // started with Windows: tray only
    // backgroundThrottling off: songs keep playing smoothly while the window is minimised
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'shell-preload.cjs') },
  })
  winRef = win

  const refreshTray = () => {
    if (!tray) {
      const iconPath = path.join(__dirname, '..', 'public', 'icon.ico')
      try {
        tray = new Tray(iconPath)
        tray.setToolTip('AVSB - Audiophile Music Player')
        const showWin = () => {
          if (win.isMinimized()) win.restore()
          win.show()
          win.setAlwaysOnTop(true)
          win.focus()
          win.setAlwaysOnTop(false)
        }
        tray.on('click', showWin)
        tray.on('double-click', showWin)
      } catch (e) {
        logToFile(`Tray init error: ${e?.message ?? e}`)
        return
      }
    }
    const status = lastLinkStatus
    const connected = status?.phones?.filter((p) => p.connected).length ?? 0
    const total = status?.phones?.length ?? 0
    const statusLabel = connected > 0
      ? `Phone Link: ${connected} phone${connected > 1 ? 's' : ''} connected`
      : total > 0
      ? 'Phone Link: Ready / Listening'
      : 'Phone Link: Standing by'

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open AVSB', click: () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() } },
      { type: 'separator' },
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: 'Keep this PC awake for my phones', type: 'checkbox', checked: power.keepAwake, click: (item) => { power.keepAwake = item.checked; savePower(); applyAwake() } },
      { label: 'Start with Windows (in the tray)', type: 'checkbox', checked: power.startWithWindows, click: (item) => { power.startWithWindows = item.checked; savePower(); applyStartup() } },
      { type: 'separator' },
      { label: 'Quit AVSB', click: () => { isQuitting = true; app.quit() } },
    ])
    tray.setContextMenu(contextMenu)
  }
  updateTrayMenu = refreshTray
  if (process.argv.includes('--hidden')) refreshTray()

  ipcMain.handle('set-mini-mode', (_event, mini) => {
    try {
      if (mini) {
        if (!win.isAlwaysOnTop()) {
          savedBounds = win.getBounds()
        }
        win.setMinimumSize(380, 150)
        win.setSize(420, 168)
        win.setResizable(false)
        win.setAlwaysOnTop(true, 'floating')
      } else {
        win.setAlwaysOnTop(false)
        win.setResizable(true)
        win.setMinimumSize(960, 600)
        if (savedBounds) {
          win.setBounds(savedBounds)
        } else {
          win.setSize(1360, 820)
        }
      }
      return true
    } catch {
      return false
    }
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
      refreshTray()
    }
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    }
  })
  // Outside links open in the default browser, and the window itself never leaves the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!ownPage(url)) event.preventDefault()
  })
  app.on('second-instance', () => {
    logToFile('Second instance requested - bringing window to front')
    if (win) {
      if (!win.isVisible()) win.show()
      if (win.isMinimized()) win.restore()
      win.show()
      win.setAlwaysOnTop(true)
      win.focus()
      win.setAlwaysOnTop(false)
    }
  })
  powerMonitor.on('resume', () => {
    logToFile('System resumed from sleep')
    // §84 A: the link's sockets and relay connection don't survive sleep; phones couldn't reach the PC until a restart
    Promise.resolve(callLinkWorker('restart')).catch((e) => logToFile(`Link: restart after sleep failed: ${e?.message ?? e}`))
    if (win && !win.isDestroyed()) {
      win.webContents.send('system-resume')
    }
  })
  powerMonitor.on('suspend', () => {
    logToFile('System suspending to sleep')
  })
  win.on('closed', () => logToFile('Window closed'))
  win.on('unresponsive', () => logToFile('Window stopped responding'))
  win.on('responsive', () => logToFile('Window responding again'))
  app.on('child-process-gone', (_event, details) => logToFile(`${details.type} process gone: ${details.reason}, code ${details.exitCode}`))
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    // Electron's own advice for developers, which never shows in the packaged app
    if (!message.includes('Electron Security Warning')) logToFile(`Page [${level}]: ${message} (${source}:${line})`)
  })
  // the page died but the app didn't: bring it back and let it say what happened
  let restarts = []
  win.webContents.on('render-process-gone', (_event, details) => {
    logToFile(`Page process gone: ${details.reason}, code ${details.exitCode}`)
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    // a page that dies every time it opens would otherwise reload forever
    const now = Date.now()
    restarts = [...restarts.filter((at) => now - at < 60000), now]
    if (restarts.length > 3) {
      logToFile('Page keeps stopping, so it was not restarted again')
      dialog.showErrorBox('The app keeps stopping', `Details are in ${logFile}`)
      return
    }
    void win.loadURL(`app://local/shell.html?recovered=${encodeURIComponent(details.reason)}`)
  })
  const session = win.webContents.session
  session.setPermissionRequestHandler((_wc, permission, done, details) => done(ownPage(details.requestingUrl) && !REFUSED.has(permission)))
  // checks only: output device *names* for DAC detection (My gear; never the microphone) and USB HID for DSP cables
  session.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (!ownPage(origin)) return false
    if (permission === 'media') return (details && details.mediaType) !== 'audio' && (details && details.mediaType) !== 'video'
    if (permission === 'hid') return true
    return !REFUSED.has(permission)
  })
  // WebHID for DSP cables (My gear → Make it neutral): take the first KT Micro device, or cancel if none
  session.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    callback(details.deviceList.find((d) => d.vendorId === 0x31b2)?.deviceId ?? '')
  })
  session.setDevicePermissionHandler((details) => details.deviceType === 'hid' && ownPage(details.origin))
  void win.loadURL('app://local/shell.html')
})

app.on('window-all-closed', () => app.quit())
app.on('quit', (_event, code) => logToFile(`Quit, code ${code}`))

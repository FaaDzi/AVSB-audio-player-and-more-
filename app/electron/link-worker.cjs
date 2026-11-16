// Dedicated Electron utilityProcess hosting the Phone Link (iroh QUIC + local LAN HTTP server + ffmpeg transcoding)
// so heavy streaming/cryptographic I/O never stalls the Electron Main/Library or Renderer UI threads.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const port = process.parentPort
if (!port) {
  throw new Error('link-worker must be spawned via Electron utilityProcess.fork')
}

const within = (folder, file) => {
  const rel = path.relative(folder, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

let snapshot = {
  tracks: [],
  folders: [],
  version: 0,
  covers: {},
  coversDir: '',
}

function excluded(f, file) {
  return (f.exclude ?? []).some((x) => within(x, file))
}

function allowedFile(wanted) {
  if (typeof wanted !== 'string' || !wanted) return null
  const file = path.resolve(wanted)
  const hit = snapshot.folders.find(
    (f) => within(f.path, file) && (f.subfolders || path.dirname(file) === path.resolve(f.path)) && !excluded(f, file),
  )
  return hit ? file : null
}

function coverFile(id) {
  const key = String(id ?? '')
  if (!/^[0-9a-f]{16}$/.test(key)) return null
  const known = snapshot.covers[key]
  if (known && fs.existsSync(known)) return known
  if (snapshot.coversDir) {
    for (const ext of ['.jpg', '.png', '.webp']) {
      const candidate = path.join(snapshot.coversDir, `${key}${ext}`)
      if (fs.existsSync(candidate)) {
        snapshot.covers[key] = candidate
        return candidate
      }
    }
  }
  return null
}

// §80 A: the page's playlists as JSON, numbered so a phone can skip an unchanged copy
let playlists = { json: '{"lists":[],"deleted":{}}', version: 0 }

let linkLib = null
let link = null
let rpcCounter = 0
const pendingMain = new Map()

function callMain(op, payload) {
  return new Promise((resolve) => {
    const id = `m_${++rpcCounter}`
    pendingMain.set(id, resolve)
    port.postMessage({ type: 'main-rpc', id, op, payload })
  })
}

port.on('message', async (event) => {
  const msg = event?.data
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'main-reply') {
    const resolve = pendingMain.get(msg.id)
    if (resolve) {
      pendingMain.delete(msg.id)
      resolve(msg.result)
    }
    return
  }

  if (msg.type === 'library-snapshot') {
    snapshot = {
      tracks: Array.isArray(msg.tracks) ? msg.tracks : snapshot.tracks,
      folders: Array.isArray(msg.folders) ? msg.folders : snapshot.folders,
      version: typeof msg.version === 'number' ? msg.version : snapshot.version,
      covers: msg.covers && typeof msg.covers === 'object' ? msg.covers : snapshot.covers,
      coversDir: typeof msg.coversDir === 'string' ? msg.coversDir : snapshot.coversDir,
    }
    return
  }

  if (msg.type === 'playlists-snapshot') {
    if (typeof msg.json === 'string' && msg.json !== playlists.json) playlists = { json: msg.json, version: playlists.version + 1 }
    return
  }

  if (msg.type === 'init') {
    try {
      if (msg.snapshot) {
        snapshot = {
          tracks: msg.snapshot.tracks ?? [],
          folders: msg.snapshot.folders ?? [],
          version: msg.snapshot.version ?? 0,
          covers: msg.snapshot.covers ?? {},
          coversDir: msg.snapshot.coversDir ?? '',
        }
      }
      const modPath = msg.isPackaged
        ? path.join(__dirname, 'link.bundle.mjs')
        : path.join(__dirname, 'link', 'index.mjs')
      linkLib = await import(pathToFileURL(modPath).toString())
      const iroh = await linkLib.loadIroh()
      link = linkLib.createLink({
        iroh,
        dataDir: msg.dataDir,
        secretKey: Array.isArray(msg.secretKey) ? msg.secretKey : undefined,
        protect: (b) => b,
        unprotect: (b) => b,
        ffmpegPath: msg.ffmpegPath,
        library: {
          state: () => ({ tracks: snapshot.tracks, version: snapshot.version }),
          allowed: allowedFile,
          coverFile,
        },
        pcName: () => msg.pcName,
        playlists: {
          state: () => playlists,
          put: (sent) => port.postMessage({ type: 'playlists-put', sent }),
        },
        uploads: {
          // songs sent from a phone go into the first library folder, in "From phone"
          dir: () => (snapshot.folders[0]?.path ? path.join(snapshot.folders[0].path, 'From phone') : null),
          done: (file) => port.postMessage({ type: 'uploaded', file }),
        },
        askAllow: (phone) => callMain('ask-allow', phone).catch(() => false),
        onChange: () => port.postMessage({ type: 'changed', status: link?.status?.() }),
        log: (line) => port.postMessage({ type: 'log', line }),
      })
      if (msg.autoStart || link.status().phones.length > 0) {
        await link.start().catch((e) => port.postMessage({ type: 'log', line: `couldn't start: ${e?.message ?? e}` }))
      }
      port.postMessage({ type: 'ready', status: link.status() })
    } catch (e) {
      port.postMessage({ type: 'init-error', error: String(e?.stack ?? e) })
    }
    return
  }

  if (msg.type === 'call') {
    const reply = (ok, result, error) => port.postMessage({ type: 'reply', id: msg.id, ok, result, error })
    if (!link) return reply(false, null, 'link not ready')
    try {
      switch (msg.op) {
        case 'status':
          return reply(true, link.status())
        case 'resync':
          return reply(true, await link.resync())
        case 'pair': {
          const opened = await link.pair()
          const qr = await linkLib.qrSvg(opened.link)
          return reply(true, { ...opened, qr })
        }
        case 'stopPairing':
          link.stopPairing()
          return reply(true, undefined)
        case 'remove':
          return reply(true, link.remove(String(msg.arg ?? '')))
        case 'rename':
          return reply(true, link.rename(String(msg.arg?.id ?? ''), String(msg.arg?.name ?? '')))
        case 'restart':
          await link.restart()
          return reply(true, link.status())
        case 'stop':
          await link.stop()
          return reply(true, true)
        default:
          return reply(false, null, `unknown op: ${msg.op}`)
      }
    } catch (e) {
      return reply(false, null, String(e?.message ?? e))
    }
  }
})

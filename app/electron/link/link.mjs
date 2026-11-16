// The PC end of the phone link (plan §70 D1, §73.C). Kept free of Electron: shell-main.cjs hands in key protection, the
// library, the Allow prompt and a logger, so the whole thing runs (and is tested) in plain Node too.
//
// Every network path is the same iroh connection: QUIC + TLS 1.3 keyed by the two Ed25519 keys, end to end, relay or
// not. A connection from a key that isn't paired is closed before any request is read, unless the pairing window is
// open, and then the only thing it may send is one pairing claim.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createPairing, cleanName } from './pairing.mjs'
import { ALPN, BadRequest, header, parseRequest, REQUEST_MAX, wireTrack } from './protocol.mjs'

/** Bytes per QUIC write: smoother packet pacing and smaller GC pressure than 256 KB. */
const CHUNK = 64 * 1024
/** Bytes per HTTP read stream slab on local Wi-Fi. */
const LAN_CHUNK = 256 * 1024
/** How far a signed LAN request's time may be from the PC's clock. */
const LAN_SIG_WINDOW_MS = 60_000

/** The signature a phone puts on a LAN HTTP request: HMAC-SHA256 over the method, the path with its query, and the time. */
export const lanSignature = (key, method, url, t) => createHmac('sha256', key).update(`${method}\n${url}\n${t}`).digest()

/** Upload cap over all phones together (§70 D1): 60 Mbps. */
const CAP_BYTES_PER_SEC = (60 * 1e6) / 8
/** Requests one phone may have going at once (a song, the next song, covers). */
const STREAMS_PER_PHONE = 64
/** Threshold above which a lossless file counts as Hi-Res for live CD-quality downscaling (§73.C2). */
const HIRES_SIZE_BYTES = 25 * 1024 * 1024
/** Max downscaled tracks cached in PC RAM (LRU) so zero duplicate files are ever written to the PC hard drive. */
const MAX_DOWNSCALE_RAM_TRACKS = 2
/** Max encoded low-data bytes cached in PC RAM per track. */
const MAX_LOWDATA_CACHE_BYTES = 20 * 1024 * 1024
/** Pre-allocated deterministic slab for network throughput benchmarks (zero alloc during tests). */
const BENCH_SLAB = Buffer.alloc(64 * 1024, 0x5a)

const alpnBytes = Array.from(Buffer.from(ALPN))
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function toByteArray(buf) {
  const n = buf.length
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = buf[i]
  return out
}

function resolveFfmpeg(explicit) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    explicit,
    process.env.AVSB_FFMPEG_BIN,
    process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', 'bin', exe) : null,
    path.resolve(here, '..', '..', 'tools', 'ffmpeg', 'bin', exe),
    path.resolve(here, '..', '..', '..', 'tools', 'ffmpeg', 'bin', exe),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return 'ffmpeg'
}

function localIpv4s() {
  const addrs = []
  const ifaces = os.networkInterfaces()
  for (const entries of Object.values(ifaces)) {
    for (const info of entries ?? []) {
      if (!info || info.internal || info.family !== 'IPv4') continue
      if (info.address.startsWith('169.254.')) continue
      addrs.push(info.address)
    }
  }
  // only home-network addresses go to the phone (review item 9): a public or VPN address is never offered
  return addrs.filter(isPrivateIp).sort((a, b) => rankIp(a) - rankIp(b))
}
const rankIp = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3)

/** A home-network (RFC 1918), link-local or loopback IPv4 address, also in its "::ffff:" IPv6 spelling. */
export function isPrivateIp(raw) {
  const ip = String(raw ?? '').replace(/^::ffff:/i, '')
  return /^(10\.|192\.168\.|127\.|169\.254\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === '::1'
}

function parseHttpRange(headerVal, size) {
  if (!headerVal || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(headerVal).trim())
  if (!m) return null
  if (m[1] === '' && m[2] === '') return null
  let start
  let end
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]))
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return 'invalid'
  return { start, end }
}

/**
 * Pure-JS in-memory WAV downscaler (24/32-bit or >48 kHz PCM/Float WAV -> 16-bit / 44.1 or 48 kHz CD-quality WAV Buffer).
 * Returns null if the WAV structure is non-standard or already 16-bit <= 48 kHz, so caller safely falls back.
 */
function downscaleWavInMemory(buf) {
  if (buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null

  let fmtOffset = -1
  let fmtSize = 0
  let dataOffset = -1
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > buf.length) break
    if (id === 'fmt ') {
      fmtOffset = body
      fmtSize = size
    } else if (id === 'data') {
      dataOffset = body
      dataSize = size
      break
    }
    offset = body + size + (size & 1)
  }
  if (fmtOffset < 0 || dataOffset < 0 || fmtSize < 16 || dataSize <= 0) return null

  let audioFormat = buf.readUInt16LE(fmtOffset)
  const channels = buf.readUInt16LE(fmtOffset + 2)
  const sampleRate = buf.readUInt32LE(fmtOffset + 4)
  const bitsPerSample = buf.readUInt16LE(fmtOffset + 14)
  if (audioFormat === 0xfffe && fmtSize >= 40) {
    audioFormat = buf.readUInt16LE(fmtOffset + 24)
  }
  if ((audioFormat !== 1 && audioFormat !== 3) || channels < 1 || channels > 8) return null
  if (bitsPerSample <= 16 && sampleRate <= 48000) return null

  const bytesPerSample = bitsPerSample >> 3
  const frameBytes = bytesPerSample * channels
  if (frameBytes <= 0) return null
  const totalFrames = Math.floor(dataSize / frameBytes)
  if (totalFrames <= 0) return null

  // Pick 44100 Hz for 88.2/176.4 kHz families, or 48000 Hz for 96/192 kHz families (or 44100 Hz default)
  const targetRate = sampleRate <= 48000 ? sampleRate : (sampleRate % 44100 === 0 ? 44100 : 44100)
  const ratio = sampleRate / targetRate
  const outFrames = Math.max(1, Math.floor(totalFrames / ratio))
  const outDataBytes = outFrames * channels * 2
  const out = Buffer.allocUnsafe(44 + outDataBytes)

  // Write standard 44-byte 16-bit PCM RIFF/WAVE header
  out.write('RIFF', 0, 4, 'ascii')
  out.writeUInt32LE(36 + outDataBytes, 4)
  out.write('WAVE', 8, 4, 'ascii')
  out.write('fmt ', 12, 4, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(targetRate, 24)
  out.writeUInt32LE(targetRate * channels * 2, 28)
  out.writeUInt16LE(channels * 2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 4, 'ascii')
  out.writeUInt32LE(outDataBytes, 40)

  const readSample = (frameIdx, ch) => {
    const pos = dataOffset + frameIdx * frameBytes + ch * bytesPerSample
    if (audioFormat === 3 && bitsPerSample === 32) {
      return buf.readFloatLE(pos)
    }
    if (bitsPerSample === 24) {
      const b0 = buf[pos]
      const b1 = buf[pos + 1]
      const b2 = buf[pos + 2]
      const val = (b2 << 16) | (b1 << 8) | b0
      const signed = val & 0x800000 ? val | ~0xffffff : val
      return signed / 8388608
    }
    if (bitsPerSample === 32) {
      return buf.readInt32LE(pos) / 2147483648
    }
    if (bitsPerSample === 16) {
      return buf.readInt16LE(pos) / 32768
    }
    return 0
  }

  let writePos = 44
  for (let i = 0; i < outFrames; i++) {
    const srcPos = i * ratio
    const idx0 = Math.min(totalFrames - 1, Math.floor(srcPos))
    const idx1 = Math.min(totalFrames - 1, idx0 + 1)
    const frac = srcPos - idx0
    for (let ch = 0; ch < channels; ch++) {
      const s0 = readSample(idx0, ch)
      const s1 = idx1 !== idx0 ? readSample(idx1, ch) : s0
      const s = s0 + (s1 - s0) * frac
      const clamped = Math.max(-1, Math.min(1, s))
      const pcm16 = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)))
      out.writeInt16LE(pcm16, writePos)
      writePos += 2
    }
  }
  return { buffer: out, type: 'audio/wav' }
}

/**
 * Pipes a Hi-Res FLAC/WAV file through ffmpeg in memory (`pipe:1`) to 16-bit / 44.1 kHz FLAC with zero disk files.
 * Resolves to null if ffmpeg is unavailable or fails so caller falls back safely to raw file streaming.
 */
function downscaleWithFfmpegInMemory(file, ffmpegBin = 'ffmpeg') {
  return new Promise((resolve) => {
    let settled = false
    const finish = (val) => {
      if (!settled) {
        settled = true
        resolve(val)
      }
    }
    let proc
    try {
      proc = spawn(ffmpegBin, [
        '-v', 'error',
        '-i', file,
        '-vn',
        '-map_metadata', '-1',
        '-sample_fmt', 's16',
        '-ar', '44100',
        '-f', 'flac',
        'pipe:1',
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return finish(null)
    }
    const chunks = []
    let total = 0
    const MAX_OUT = 60 * 1024 * 1024
    const timer = setTimeout(() => {
      try { proc.kill() } catch {}
      finish(null)
    }, 15000)

    proc.stdout.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_OUT) {
        try { proc.kill() } catch {}
        clearTimeout(timer)
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    proc.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && total > 64) {
        finish({ buffer: Buffer.concat(chunks, total), type: 'audio/flac' })
      } else {
        finish(null)
      }
    })
  })
}

/**
 * Spawns ffmpeg to transcode to 128 kbps Ogg/Opus and yields live chunks as they encode so playback
 * starts after the first audio frames (~150 ms) rather than buffering the entire song in RAM first.
 */
function openLiveOpusEncoder(file, ffmpegBin, activeProcs) {
  let proc
  try {
    proc = spawn(ffmpegBin, [
      '-v', 'error',
      '-i', file,
      '-vn',
      '-map_metadata', '-1',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-application', 'audio',
      '-page_duration', '20000',
      '-f', 'ogg',
      'pipe:1',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
  activeProcs?.add(proc)

  const queue = []
  let ended = false
  let exitCode = null
  let procErr = null
  let notify = null
  let aborted = false
  let startupTimer = null

  const wake = () => {
    if (notify) {
      const fn = notify
      notify = null
      fn()
    }
  }

  proc.stdout.on('data', (chunk) => {
    if (aborted || !chunk?.length) return
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    queue.push(chunk)
    if (queue.length >= 16) proc.stdout.pause()
    wake()
  })
  proc.on('error', (err) => {
    procErr = err
    ended = true
    activeProcs?.delete(proc)
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    wake()
  })
  proc.on('close', (code) => {
    exitCode = code
    ended = true
    activeProcs?.delete(proc)
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    wake()
  })

  const kill = () => {
    if (aborted) return
    aborted = true
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    activeProcs?.delete(proc)
    try { proc.kill() } catch {}
    ended = true
    wake()
  }

  const nextChunk = async () => {
    while (!queue.length && !ended) {
      await new Promise((r) => { notify = r })
    }
    if (queue.length) {
      const c = queue.shift()
      if (queue.length < 8) proc.stdout.resume()
      return c
    }
    return null
  }

  const waitFirst = () => new Promise((resolve) => {
    startupTimer = setTimeout(() => {
      kill()
      resolve(null)
    }, 5000)
    void nextChunk().then((chunk) => {
      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }
      resolve(chunk)
    })
  })

  return { waitFirst, nextChunk, kill, succeeded: () => !procErr && !aborted && exitCode === 0 }
}

/**
 * @param {{
 *   iroh: any,
 *   dataDir: string,
 *   protect: (b: Buffer) => Buffer, unprotect: (b: Buffer) => Buffer,
 *   library: { state: () => { tracks: any[], version: number }, allowed: (p: string) => string | null, coverFile: (id: string) => string | null },
 *   pcName: () => string,
 *   playlists?: { state: () => { json: string, version: number }, put: (sent: { lists: any[], deleted: object }) => void },
 *   uploads?: { dir: () => string | null, done: (file: string) => void },
 *   askAllow: (phone: { id: string, name: string }) => Promise<boolean>,
 *   onChange?: () => void,
 *   log?: (line: string) => void,
 *   bind?: string[],
 *   relay?: boolean,
 * }} opts
 */
export function createLink(opts) {
  const { iroh, dataDir, protect, unprotect, library, pcName, askAllow, onChange = () => {}, log = () => {} } = opts
  // §80 A: the PC's playlists (JSON kept by the page) and where songs sent from a phone go
  const playlists = opts.playlists ?? { state: () => ({ json: '{"lists":[],"deleted":{}}', version: 0 }), put: () => {} }
  const uploads = opts.uploads ?? { dir: () => null, done: () => {} }
  const ffmpegBin = resolveFfmpeg(opts.ffmpegPath)
  const dir = path.join(dataDir, 'link')
  fs.mkdirSync(dir, { recursive: true })
  const keyFile = path.join(dir, 'key.bin')
  const phonesFile = path.join(dir, 'phones.json')

  /** 2-track in-memory LRU cache for downscaled Hi-Res songs: trackId -> { mtimeMs, size, buffer, type }. */
  const downscaledRamCache = new Map()
  /** 2-track in-memory LRU cache for low-data 128 kbps Opus streams: trackId -> { buffer, type }. */
  const lowDataRamCache = new Map()
  const activeProcs = new Set()

  const pairing = createPairing({
    load: () => {
      try { return JSON.parse(fs.readFileSync(phonesFile, 'utf8')) } catch { return [] }
    },
    save: (phones) => fs.writeFileSync(phonesFile, JSON.stringify(phones, null, 2)),
  })

  /** The PC's secret key, encrypted at rest (Windows DPAPI through Electron's safeStorage). */
  function secretKey() {
    if (Array.isArray(opts.secretKey) && opts.secretKey.length === 32) {
      return opts.secretKey
    }
    try {
      const bytes = unprotect(fs.readFileSync(keyFile))
      if (bytes.length === 32) return Array.from(bytes)
    } catch {
      // none yet, or it can't be read (another Windows account): make a new one, phones pair again
    }
    const key = iroh.SecretKey.generate().toBytes()
    fs.writeFileSync(keyFile, protect(Buffer.from(key)))
    return key
  }

  let ep = null
  let online = false
  let watches = []
  let restarting = null
  let lanServer = null
  let lanPort = 0
  let lanToken = randomBytes(32).toString('hex')
  let lanTokenBuf = Buffer.from(lanToken, 'utf8')
  const isLoopbackBind = opts.relay === false && Boolean(opts.bind?.length) && opts.bind.every((b) => String(b).startsWith('127.0.0.1'))
  const lanServerInfo = () => {
    if (!lanServer || !lanPort) return null
    const ips = isLoopbackBind ? ['127.0.0.1'] : localIpv4s()
    if (!ips.length) return null
    return { port: lanPort, ips, token: lanToken }
  }
  /** Live connections by phone id, so Remove can close them at once. */
  const live = new Map()

  // ---- the shared upload cap: a token bucket every song chunk draws from
  let tokens = CAP_BYTES_PER_SEC
  let refilled = Date.now()
  async function spend(n) {
    for (;;) {
      const t = Date.now()
      tokens = Math.min(CAP_BYTES_PER_SEC, tokens + ((t - refilled) / 1000) * CAP_BYTES_PER_SEC)
      refilled = t
      if (tokens >= n) { tokens -= n; return }
      await new Promise((r) => setTimeout(r, Math.ceil(((n - tokens) / CAP_BYTES_PER_SEC) * 1000)))
    }
  }

  async function readRequest(recv) {
    let buf = Buffer.alloc(0)
    while (!buf.includes(10)) {
      const part = await recv.read(REQUEST_MAX)
      if (!part || part.length === 0) break
      buf = Buffer.concat([buf, Buffer.from(part)])
      if (!buf.includes(10) && buf.length > REQUEST_MAX) throw new BadRequest('request too large')
    }
    const nl = buf.indexOf(10)
    const req = parseRequest(nl < 0 ? buf : buf.subarray(0, nl + 1))
    // a body (playlists-put, upload) may have come in with the request line: kept, out of sight of the request itself
    Object.defineProperty(req, 'rest', { value: nl < 0 ? Buffer.alloc(0) : buf.subarray(nl + 1) })
    return req
  }

  /** Reads exactly `bytes` of body (the part that came with the request first) into `sink`; false if it ended early. */
  async function readBody(recv, req, bytes, sink) {
    let got = 0
    const first = req.rest.subarray(0, bytes)
    if (first.length) { await sink(first); got += first.length }
    while (got < bytes) {
      const part = await recv.read(Math.min(CHUNK, bytes - got))
      if (!part || part.length === 0) return false
      await sink(Buffer.from(part))
      got += part.length
    }
    return true
  }

  const send = (bi, buf) => bi.send.writeAll(toByteArray(buf))

  const BURST_BYTES = 512 * 1024

  async function sendBuffer(bi, buf, from, type) {
    const size = buf.length
    const start = Math.min(from, size)
    await send(bi, header({ ok: true, type, size, from: start, bytes: size - start }))
    let sent = 0
    for (let at = start; at < size; ) {
      const end = Math.min(size, at + CHUNK)
      const slice = buf.subarray(at, end)
      if (sent >= BURST_BYTES) {
        await spend(slice.length)
      }
      sent += slice.length
      await send(bi, slice)
      at = end
    }
  }

  async function sendFile(bi, file, from, type) {
    const size = fs.statSync(file).size
    const start = Math.min(from, size)
    await send(bi, header({ ok: true, type, size, from: start, bytes: size - start }))
    const fd = await fs.promises.open(file, 'r')
    try {
      let sent = 0
      const chunk = Buffer.alloc(CHUNK)
      for (let at = start; at < size; ) {
        const { bytesRead } = await fd.read(chunk, 0, Math.min(CHUNK, size - at), at)
        if (!bytesRead) break
        if (sent >= BURST_BYTES) {
          await spend(bytesRead)
        }
        sent += bytesRead
        await send(bi, chunk.subarray(0, bytesRead))
        at += bytesRead
      }
    } finally {
      await fd.close()
    }
  }

  /**
   * §73.C2 — Automatic In-Memory PC Downscaler (CD-Quality 16-bit / 44.1 kHz):
   * When the phone requests a Hi-Res lossless song (.flac or .wav > 25 MB or > 48 kHz / > 16-bit) and hasn't requested
   * `raw`, downscales it on-the-fly in memory with a 2-track RAM LRU cache. Zero duplicate files touch the PC disk.
   * Always falls back to streaming original file bytes if downscaling isn't applicable or fails.
   */
  async function getDownscaledOrNull(track, file) {
    try {
      const ext = path.extname(file).toLowerCase()
      if (ext !== '.flac' && ext !== '.wav') return null
      const st = await fs.promises.stat(file)
      const isHiRes =
        (track.bits && track.bits > 16) ||
        (track.rate && track.rate > 48000) ||
        st.size > HIRES_SIZE_BYTES
      if (!isHiRes) return null

      const cached = downscaledRamCache.get(track.id)
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        // Refresh LRU order
        downscaledRamCache.delete(track.id)
        downscaledRamCache.set(track.id, cached)
        return cached
      }

      let result = null
      if (ext === '.wav' && st.size <= 220 * 1024 * 1024) {
        const raw = await fs.promises.readFile(file)
        result = downscaleWavInMemory(raw)
      }
      if (!result) {
        result = await downscaleWithFfmpegInMemory(file, ffmpegBin)
      }
      if (!result || !result.buffer || result.buffer.length >= st.size) return null

      const entry = { mtimeMs: st.mtimeMs, size: st.size, buffer: result.buffer, type: result.type }
      downscaledRamCache.set(track.id, entry)
      while (downscaledRamCache.size > MAX_DOWNSCALE_RAM_TRACKS) {
        const oldest = downscaledRamCache.keys().next().value
        downscaledRamCache.delete(oldest)
      }
      log(`downscaled ${path.basename(file)} in RAM (${(st.size / 1048576).toFixed(1)} MB → ${(result.buffer.length / 1048576).toFixed(1)} MB)`)
      return entry
    } catch {
      return null
    }
  }

  const TYPES = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
  const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

  function cacheLowData(trackId, cacheChunks, cacheBytes) {
    if (!cacheChunks.length || cacheBytes <= 64 || cacheBytes > MAX_LOWDATA_CACHE_BYTES) return
    if (lowDataRamCache.has(trackId)) lowDataRamCache.delete(trackId)
    while (lowDataRamCache.size >= 2) {
      const oldest = lowDataRamCache.keys().next().value
      if (oldest) lowDataRamCache.delete(oldest)
    }
    lowDataRamCache.set(trackId, { buffer: Buffer.concat(cacheChunks, cacheBytes), type: 'audio/ogg' })
  }

  async function streamLowDataIroh(bi, trackId, file) {
    const enc = openLiveOpusEncoder(file, ffmpegBin, activeProcs)
    if (!enc) return false
    const first = await enc.waitFirst()
    if (!first) {
      enc.kill()
      return false
    }
    await send(bi, header({ ok: true, type: 'audio/ogg', from: 0, streaming: true, lowData: true, transcoded: true }))
    const cacheChunks = []
    let cacheBytes = 0
    let keepCaching = true
    const collect = (c) => {
      if (!keepCaching) return
      if (cacheBytes + c.length > MAX_LOWDATA_CACHE_BYTES) {
        keepCaching = false
        cacheChunks.length = 0
        return
      }
      cacheChunks.push(c)
      cacheBytes += c.length
    }
    try {
      collect(first)
      await send(bi, first)
      for (;;) {
        const chunk = await enc.nextChunk()
        if (!chunk) break
        collect(chunk)
        await send(bi, chunk)
      }
      if (keepCaching && enc.succeeded()) {
        cacheLowData(trackId, cacheChunks, cacheBytes)
      }
    } catch (e) {
      enc.kill()
      throw e
    }
    return true
  }

  function sendBufferHttp(req, res, buf, type, extraHeaders = {}) {
    const size = buf.length
    const parsed = parseHttpRange(req.headers.range, size)
    if (parsed === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    if (parsed) {
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(parsed.end - parsed.start + 1),
        'Cache-Control': 'no-store',
        ...extraHeaders,
      })
      res.end(buf.subarray(parsed.start, parsed.end + 1))
      return
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    })
    res.end(buf)
  }

  function sendFileHttp(req, res, file, type, extraHeaders = {}) {
    let st
    try { st = fs.statSync(file) } catch { res.writeHead(404); res.end('not found'); return }
    const size = st.size
    const parsed = parseHttpRange(req.headers.range, size)
    if (parsed === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    }
    let readOpts = { highWaterMark: LAN_CHUNK }
    if (parsed) {
      headers['Content-Range'] = `bytes ${parsed.start}-${parsed.end}/${size}`
      headers['Content-Length'] = String(parsed.end - parsed.start + 1)
      res.writeHead(206, headers)
      readOpts = { start: parsed.start, end: parsed.end, highWaterMark: LAN_CHUNK }
    } else {
      headers['Content-Length'] = String(size)
      res.writeHead(200, headers)
    }
    const rs = fs.createReadStream(file, readOpts)
    rs.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.destroy()
    })
    res.on('close', () => rs.destroy())
    rs.pipe(res)
  }

  async function streamLowDataHttp(req, res, trackId, file) {
    const cached = lowDataRamCache.get(trackId)
    if (cached) {
      lowDataRamCache.delete(trackId)
      lowDataRamCache.set(trackId, cached)
      sendBufferHttp(req, res, cached.buffer, cached.type, { 'X-AVSB-Transcoded': '1' })
      return
    }
    const enc = openLiveOpusEncoder(file, ffmpegBin, activeProcs)
    if (!enc) {
      sendFileHttp(req, res, file, typeOf(file))
      return
    }
    let clientClosed = false
    const onClose = () => {
      clientClosed = true
      enc.kill()
    }
    res.on('close', onClose)
    const first = await enc.waitFirst()
    if (!first || clientClosed) {
      res.off('close', onClose)
      enc.kill()
      if (!clientClosed) sendFileHttp(req, res, file, typeOf(file))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'audio/ogg; codecs=opus',
      'X-AVSB-Transcoded': '1',
      'Cache-Control': 'no-store',
    })
    const cacheChunks = []
    let cacheBytes = 0
    let keepCaching = true
    const writeChunk = async (buf) => {
      if (clientClosed) return false
      if (keepCaching) {
        if (cacheBytes + buf.length > MAX_LOWDATA_CACHE_BYTES) {
          keepCaching = false
          cacheChunks.length = 0
        } else {
          cacheChunks.push(buf)
          cacheBytes += buf.length
        }
      }
      if (!res.write(buf)) {
        await new Promise((resolve) => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve() }
          res.on('drain', done)
          res.on('close', done)
        })
      }
      return !clientClosed
    }
    try {
      if (await writeChunk(first)) {
        for (;;) {
          const chunk = await enc.nextChunk()
          if (!chunk || !(await writeChunk(chunk))) break
        }
      }
      if (!clientClosed && keepCaching && enc.succeeded()) {
        cacheLowData(trackId, cacheChunks, cacheBytes)
      }
      if (!clientClosed) res.end()
    } finally {
      res.off('close', onClose)
    }
  }

  function authorizeLan(req) {
    // §81: the token never crosses the Wi-Fi. The phone signs each request (method, path, the time) with it, so
    // someone listening in has nothing to reuse beyond that same request for a minute.
    const m = /^AVSB t=(\d{1,16}), sig=([0-9a-f]{64})$/.exec(req.headers.authorization || '')
    if (!m || Math.abs(Date.now() - Number(m[1])) > LAN_SIG_WINDOW_MS) return false
    return timingSafeEqual(Buffer.from(m[2], 'hex'), lanSignature(lanTokenBuf, req.method, req.url, m[1]))
  }

  async function handleLanHttp(req, res) {
    // the server listens on every interface; only callers on the home network get an answer (review item 9)
    if (!isPrivateIp(req.socket.remoteAddress)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!authorizeLan(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end('{"ok":false,"error":"unauthorized"}')
      return
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const p = url.pathname
    if (p === '/ping') {
      const { version } = library.state()
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, library: version }))
      return
    }
    if (p === '/bench') {
      const rawBytes = Number.parseInt(url.searchParams.get('bytes') || '1048576', 10)
      const total = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number.isFinite(rawBytes) ? rawBytes : 1048576))
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(total),
        'Cache-Control': 'no-store',
      })
      let left = total
      let closed = false
      const onClose = () => { closed = true }
      res.on('close', onClose)
      try {
        while (left > 0 && !closed) {
          const slice = BENCH_SLAB.subarray(0, Math.min(BENCH_SLAB.length, left))
          left -= slice.length
          if (!res.write(slice) && left > 0) {
            await new Promise((resolve) => {
              const done = () => { res.off('drain', done); res.off('close', done); resolve() }
              res.on('drain', done)
              res.on('close', done)
            })
          }
        }
        if (!closed) res.end()
      } finally {
        res.off('close', onClose)
      }
      return
    }
    if (p.startsWith('/cover/')) {
      const id = decodeURIComponent(p.slice(7))
      if (!ID_RE.test(id)) { res.writeHead(400); res.end('bad id'); return }
      const file = library.coverFile(id)
      if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
      sendFileHttp(req, res, file, typeOf(file), { 'Cache-Control': 'max-age=31536000' })
      return
    }
    if (p.startsWith('/song/')) {
      const id = decodeURIComponent(p.slice(6))
      if (!ID_RE.test(id)) { res.writeHead(400); res.end('bad id'); return }
      const t = library.state().tracks.find((x) => x.id === id)
      const file = t && !t.offline ? library.allowed(t.path) : null
      if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return }
      if (url.searchParams.get('lowdata') === '1') {
        await streamLowDataHttp(req, res, t.id, file)
        return
      }
      if (url.searchParams.get('raw') !== '1' && path.extname(file).toLowerCase() === '.wav') {
        const cached = downscaledRamCache.get(t.id)
        if (cached) {
          sendBufferHttp(req, res, cached.buffer, cached.type)
          return
        }
        const downscaled = await getDownscaledOrNull(t, file)
        if (downscaled) {
          sendBufferHttp(req, res, downscaled.buffer, downscaled.type)
          return
        }
      }
      sendFileHttp(req, res, file, typeOf(file))
      return
    }
    res.writeHead(404)
    res.end('not found')
  }

  async function startLanServer() {
    if (opts.lanHttp === false || lanServer) return
    const host = isLoopbackBind ? '127.0.0.1' : '0.0.0.0'
    lanToken = randomBytes(32).toString('hex')
    lanTokenBuf = Buffer.from(lanToken, 'utf8')
    await new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        void handleLanHttp(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.destroy()
        })
      })
      srv.once('error', (err) => {
        log(`LAN HTTP disabled: ${err?.message ?? err}`)
        resolve()
      })
      srv.listen(0, host, () => {
        const addr = srv.address()
        lanPort = typeof addr === 'object' && addr ? addr.port : 0
        lanServer = srv
        log(`LAN HTTP ready on port ${lanPort}`)
        resolve()
      })
    })
  }

  async function stopLanServer() {
    if (!lanServer) return
    const srv = lanServer
    lanServer = null
    lanPort = 0
    await new Promise((resolve) => {
      try { srv.closeAllConnections?.() } catch {}
      srv.close(() => resolve())
    })
  }

  async function serve(bi, req, phoneId) {
    if (req.op === 'hello' || req.op === 'ping') {
      if (req.op === 'hello' && pairing.seen(phoneId, req)) onChange()
      const { version } = library.state()
      const lan = lanServerInfo()
      return send(bi, header({
        ok: true,
        name: pcName(),
        library: version,
        // §81 A: the phone asks every few seconds and fetches the playlists when this number moved
        playlists: playlists.state().version,
        // the PC's clock, for the time in the phone's signed LAN requests
        now: Date.now(),
        protocol: 2,
        ...(lan ? { lan } : {}),
        // §84 A: where the PC is right now (its relay moves, its port changes with every start). The phone keeps
        // this in place of the address from the day it paired.
        ...(req.op === 'hello' && ep ? { ticket: iroh.EndpointTicket.fromAddr(ep.addr()).toString() } : {}),
      }))
    }
    if (req.op === 'bench') {
      await send(bi, header({ ok: true, type: 'application/octet-stream', size: req.bytes, bytes: req.bytes }))
      let left = req.bytes
      while (left > 0) {
        const n = Math.min(CHUNK, left)
        await send(bi, BENCH_SLAB.subarray(0, n))
        left -= n
      }
      return
    }
    if (req.op === 'library') {
      const { tracks, version } = library.state()
      if (req.since === version) return send(bi, header({ ok: true, version, same: true }))
      const body = Buffer.from(JSON.stringify(tracks.filter((t) => !t.offline).map(wireTrack)), 'utf8')
      await send(bi, header({ ok: true, version, type: 'application/json', bytes: body.length }))
      return send(bi, body)
    }
    if (req.op === 'playlists') {
      const { json, version } = playlists.state()
      if (req.since === version) return send(bi, header({ ok: true, version, same: true }))
      const body = Buffer.from(json, 'utf8')
      await send(bi, header({ ok: true, version, type: 'application/json', bytes: body.length }))
      return send(bi, body)
    }
    if (req.op === 'playlists-put') {
      const parts = []
      if (!(await readBody(bi.recv, req, req.bytes, (b) => { parts.push(b) }))) return send(bi, header({ ok: false, error: 'cut off' }))
      let sent
      try { sent = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return send(bi, header({ ok: false, error: 'not JSON' })) }
      if (!sent || !Array.isArray(sent.lists) || typeof sent.deleted !== 'object') return send(bi, header({ ok: false, error: 'bad playlists' }))
      playlists.put(sent)
      return send(bi, header({ ok: true }))
    }
    if (req.op === 'upload') {
      const dir = uploads.dir()
      if (!dir) return send(bi, header({ ok: false, error: 'no library folder' }))
      fs.mkdirSync(dir, { recursive: true })
      // never over a file that's there: "name (2).flac"
      const ext = path.extname(req.name)
      let file = path.join(dir, req.name)
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${req.name.slice(0, -ext.length)} (${n})${ext}`)
      const part = `${file}.part`
      const out = fs.createWriteStream(part)
      const write = (b) => new Promise((resolve, reject) => { out.write(b, (e) => (e ? reject(e) : resolve())) })
      let whole = false
      try {
        whole = await readBody(bi.recv, req, req.bytes, write)
      } catch (e) {
        log(`couldn't save a song from a phone: ${e?.message ?? e}`)
      } finally {
        await new Promise((resolve) => out.end(resolve))
      }
      // a cut-off transfer leaves nothing half-written in the library
      if (!whole) { fs.rmSync(part, { force: true }); return send(bi, header({ ok: false, error: 'cut off' })) }
      fs.renameSync(part, file)
      log(`received ${path.basename(file)} from a phone (${req.bytes} bytes)`)
      uploads.done(file)
      return send(bi, header({ ok: true, name: path.basename(file) }))
    }
    if (req.op === 'cover') {
      const file = library.coverFile(req.id)
      if (!file || !fs.existsSync(file)) return send(bi, header({ ok: false, error: 'not found' }))
      return sendFile(bi, file, 0, typeOf(file))
    }
    if (req.op === 'song') {
      // by id, then through the library's own check that the file sits inside a chosen folder
      const t = library.state().tracks.find((x) => x.id === req.id)
      const file = t && !t.offline ? library.allowed(t.path) : null
      if (!file || !fs.existsSync(file)) return send(bi, header({ ok: false, error: 'not found' }))

      if (req.lowData) {
        const cached = lowDataRamCache.get(t.id)
        if (cached) {
          lowDataRamCache.delete(t.id)
          lowDataRamCache.set(t.id, cached)
          return sendBuffer(bi, cached.buffer, req.from, cached.type)
        }
        if ((req.from ?? 0) === 0 && await streamLowDataIroh(bi, t.id, file)) {
          return
        }
        // a live Opus stream can't start partway in, and raw file bytes would be a different format from the part
        // already received: say so, and the phone asks again from the start (review item 14)
        if ((req.from ?? 0) > 0) return send(bi, header({ ok: false, error: 'low data resumes from the start' }))
      }

      if (!req.raw && (req.from ?? 0) === 0) {
        const cached = downscaledRamCache.get(t.id)
        if (cached) {
          downscaledRamCache.delete(t.id)
          downscaledRamCache.set(t.id, cached)
          return sendBuffer(bi, cached.buffer, 0, cached.type)
        }
        if (path.extname(file).toLowerCase() === '.wav') {
          const downscaled = await getDownscaledOrNull(t, file)
          if (downscaled) return sendBuffer(bi, downscaled.buffer, 0, downscaled.type)
        }
      }
      return sendFile(bi, file, req.from, typeOf(file))
    }
    return send(bi, header({ ok: false, error: 'not allowed' }))
  }

  /** An unknown key with the window open: one stream, one claim, then the owner decides. */
  async function pairOver(conn, phoneId) {
    const bi = await conn.acceptBi()
    let req
    try {
      req = await readRequest(bi.recv)
    } catch {
      return false
    }
    if (req.op !== 'pair') return false
    const verdict = pairing.claim(req.secret, phoneId)
    const name = cleanName(req.name)
    log(`pairing claim from ${name} (${phoneId.slice(0, 10)}…): ${verdict}`)
    if (verdict !== 'ask') {
      await send(bi, header({ ok: false, error: verdict })).catch(() => {})
      await bi.send.finish().catch(() => {})
      onChange()
      return false
    }
    onChange()
    const allowed = await askAllow({ id: phoneId, name }).catch(() => false)
    if (allowed) pairing.add(phoneId, name, req)
    await send(bi, header(allowed ? { ok: true, name: pcName() } : { ok: false, error: 'declined' })).catch(() => {})
    await bi.send.finish().catch(() => {})
    log(allowed ? `paired ${name}` : `${name} was not allowed`)
    onChange()
    return allowed
  }

  async function handle(incoming) {
    const conn = await (await incoming.accept()).connect()
    const phoneId = conn.remoteId().toString()
    if (!pairing.admit(phoneId)) {
      const paired = pairing.isOpen() && (await pairOver(conn, phoneId).catch(() => false))
      if (!paired) {
        conn.close(1n, Array.from(Buffer.from('not paired')))
        return
      }
      pairing.admit(phoneId)
    }
    const known = pairing.phones().find((p) => p.id === phoneId)
    const name = known?.customName || known?.name || 'Phone'
    log(`${name} connected`)
    const conns = live.get(phoneId) ?? new Set()
    conns.add(conn)
    live.set(phoneId, conns)
    onChange()
    let active = 0
    try {
      for (;;) {
        const bi = await conn.acceptBi()
        if (!pairing.admit(phoneId)) {
          conn.close(2n, Array.from(Buffer.from('removed')))
          break
        }
        if (active >= STREAMS_PER_PHONE) {
          void send(bi, header({ ok: false, error: 'busy' })).then(() => bi.send.finish()).catch(() => {})
          continue
        }
        active++
        void (async () => {
          try {
            const req = await readRequest(bi.recv)
            await serve(bi, req, phoneId)
          } catch (e) {
            if (e instanceof BadRequest) await send(bi, header({ ok: false, error: e.message })).catch(() => {})
          } finally {
            active--
            await bi.send.finish().catch(() => {})
          }
        })()
      }
    } catch {
      // the phone went away
    } finally {
      conns.delete(conn)
      if (!conns.size) live.delete(phoneId)
      log(`${name} disconnected`)
      onChange()
    }
  }

  return {
    async start() {
      if (ep) return
      await startLanServer()
      const b = iroh.Endpoint.builder()
      if (opts.relay === false) b.applyN0DisableRelay()
      else b.applyN0()
      b.secretKey(secretKey())
      b.alpns([alpnBytes])
      for (const a of opts.bind ?? []) b.bindAddr(a)
      ep = await b.bind()
      const mine = ep
      log(`link up as ${ep.id().fmtShort()}`)
      void ep.online().then(() => { if (ep === mine) { online = true; onChange() } }, () => {})
      // §84 A: "online" follows the relay for as long as the endpoint lives, and the log says which relay it is
      // (off the home network the relay is the only way in, and nothing used to say whether it was up)
      try {
        watches = [
          ep.watchHomeRelay((a, b) => {
            // the native callback comes as (error, value)
            const urls = Array.isArray(a) ? a : Array.isArray(b) ? b : []
            if (ep !== mine || opts.relay === false) return
            log(urls.length ? `relay: ${urls.join(', ')}` : 'relay: none (phones away from this network cannot reach the PC)')
            online = urls.length > 0
            onChange()
          }),
        ]
      } catch (e) {
        log(`relay watch unavailable: ${e?.message ?? e}`)
      }
      void (async () => {
        for (;;) {
          const incoming = await mine.acceptNext().catch(() => null)
          if (incoming) { handle(incoming).catch((e) => log(`connection error: ${e?.message ?? e}`)); continue }
          // the endpoint stopped accepting. If nobody stopped it on purpose, bring it back: it used to stay dead
          // (and count as running) until the app was restarted.
          if (ep !== mine) return
          log('link stopped accepting, restarting')
          await new Promise((r) => setTimeout(r, 1000))
          if (ep === mine) await this.restart().catch((e) => log(`couldn't restart: ${e?.message ?? e}`))
          return
        }
      })()
      onChange()
    },

    /** §84 A: a fresh endpoint with the same key (after sleep the old one's sockets and relay link can be dead). */
    restart() {
      // one at a time (Windows reports a resume twice), and only when it was running
      restarting = (restarting ?? Promise.resolve()).then(async () => {
        if (!ep) return
        await this.stop()
        await this.start()
      })
      return restarting
    },

    async stop() {
      for (const p of activeProcs) {
        try { p.kill() } catch {}
      }
      activeProcs.clear()
      await stopLanServer()
      if (!ep) return
      const e = ep
      ep = null
      online = false
      for (const w of watches) void w.stop().catch(() => {})
      watches = []
      downscaledRamCache.clear()
      lowDataRamCache.clear()
      await e.close().catch(() => {})
      live.clear()
      onChange()
    },

    status() {
      const lan = lanServerInfo()
      return {
        running: Boolean(ep),
        online,
        id: ep ? ep.id().toString() : null,
        pairing: pairing.isOpen(),
        lanPort: lan?.port ?? null,
        lanIps: lan?.ips ?? [],
        phones: pairing.phones().map((p) => ({ ...p, connected: live.has(p.id) })),
      }
    },

    /** §73.C3 — Pre-warms or restarts the PC endpoint if phones are paired and returns live status. */
    async resync() {
      if (!ep && pairing.phones().length > 0) {
        await this.start()
      }
      onChange()
      return this.status()
    },

    /** Opens the 5-minute pairing window. The link the phone scans: the PC's address (ticket), its name and the secret. */
    async pair() {
      await this.start()
      // the ticket carries the relay: wait for it (a few seconds at most), or a phone paired right after start
      // only gets this network's addresses
      if (opts.relay !== false) await Promise.race([ep.online(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {})
      const { secret, expires } = pairing.open()
      const ticket = iroh.EndpointTicket.fromAddr(ep.addr()).toString()
      const link = `iemdream://pair?t=${encodeURIComponent(ticket)}&s=${secret}&n=${encodeURIComponent(pcName())}`
      onChange()
      return { link, expires }
    },

    stopPairing() {
      pairing.close()
      onChange()
    },

    /** Drops the phone's key and closes it right away. */
    remove(id) {
      const removed = pairing.remove(id)
      // the LAN token is shared by every phone: a new one locks the removed phone out of LAN HTTP too. The others get
      // a 401, fall back to iroh, and pick the new token up from their next hello.
      lanToken = randomBytes(32).toString('hex')
      lanTokenBuf = Buffer.from(lanToken, 'utf8')
      for (const conn of live.get(id) ?? []) conn.close(2n, Array.from(Buffer.from('removed')))
      live.delete(id)
      onChange()
      return removed
    },

    /** §81 F: the owner's own name for a phone ('' = the phone's name again). */
    rename(id, name) {
      const done = pairing.rename(id, name)
      onChange()
      return done
    },

    /** For tests: this end's address. */
    addr: () => ep?.addr(),
  }
}

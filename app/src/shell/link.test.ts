// The phone link's PC end (plan §70 D1): pairing rules, request checks, and a real iroh connection on this machine
// (relay off, loopback only) standing in for a phone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import iroh from '@number0/iroh'
import { createPairing, EXPIRE_MS, MAX_PHONES, MAX_WRONG, PAIR_WINDOW_MS } from '../../electron/link/pairing.mjs'
import { ALPN, BadRequest, parseRequest, splitHeader } from '../../electron/link/protocol.mjs'
import { createLink, isPrivateIp, lanSignature } from '../../electron/link/link.mjs'

const fixed = (b: number) => (n: number) => Buffer.alloc(n, b)

function pairingAt(start = 1_000_000) {
  let t = start
  let saved: unknown[] = []
  const p = createPairing({ load: () => saved, save: (x: unknown[]) => { saved = x }, now: () => t, random: fixed(7) })
  return { p, tick: (ms: number) => { t += ms }, saved: () => saved }
}
const SECRET = '07'.repeat(16)

describe('pairing', () => {
  it('lets a phone in only after a right claim and the owner’s Allow', () => {
    const { p } = pairingAt()
    expect(p.admit('phone1')).toBe(false)
    expect(p.claim(SECRET, 'phone1')).toBe('closed')
    expect(p.open().secret).toBe(SECRET)
    expect(p.claim(SECRET, 'phone1')).toBe('ask')
    expect(p.admit('phone1')).toBe(false) // not until Allow
    p.add('phone1', 'Xiaomi 14')
    expect(p.admit('phone1')).toBe(true)
  })

  it('uses a secret once, and expires it after 5 minutes', () => {
    const { p, tick } = pairingAt()
    p.open()
    expect(p.claim(SECRET, 'a')).toBe('ask')
    expect(p.claim(SECRET, 'b')).toBe('closed')
    p.open()
    tick(PAIR_WINDOW_MS)
    expect(p.claim(SECRET, 'c')).toBe('closed')
  })

  it('closes the window after five wrong secrets', () => {
    const { p } = pairingAt()
    p.open()
    for (let i = 0; i < MAX_WRONG; i++) expect(p.claim('00'.repeat(16), 'x')).toBe('wrong')
    expect(p.claim(SECRET, 'x')).toBe('closed')
    expect(p.claim('not hex at all', 'x')).toBe('closed')
  })

  it('takes five phones at most', () => {
    const { p } = pairingAt()
    for (let i = 0; i < MAX_PHONES; i++) p.add(`p${i}`, `Phone ${i}`)
    p.open()
    expect(p.claim(SECRET, 'sixth')).toBe('full')
    expect(p.add('sixth', 'Sixth')).toBe(false)
  })

  it('expires a pairing after 7 days unused; each connection restarts the 7 days', () => {
    const { p, tick } = pairingAt()
    p.add('a', 'A')
    p.add('b', 'B')
    tick(EXPIRE_MS - 1000)
    expect(p.admit('a')).toBe(true) // renewed
    tick(2000)
    expect(p.admit('b')).toBe(false)
    expect(p.phones().map((x: { id: string }) => x.id)).toEqual(['a'])
  })

  it('removes a phone, and cleans its name', () => {
    const { p } = pairingAt()
    p.add('a', '  My\u0000 phone\n with a very long name that keeps going and going ')
    expect(p.phones()[0].name).toBe('My phone with a very long name that keep')
    expect(p.remove('a')).toBe(true)
    expect(p.admit('a')).toBe(false)
  })
})

describe('what a phone says about itself (plan §81 F)', () => {
  it('keeps its name, model number and Android version, and the owner’s own name until the pairing goes', () => {
    const { p, tick } = pairingAt()
    p.add('phone1', '23127PN0CG')
    expect(p.seen('phone1', { name: 'Xiaomi 14', model: '23127PN0CG', os: 'Android 15' })).toBe(true)
    expect(p.seen('phone1', { name: 'Xiaomi 14', model: '23127PN0CG', os: 'Android 15' })).toBe(false) // nothing new
    expect(p.seen('stranger', { name: 'x' })).toBe(false)
    expect(p.rename('phone1', '  Daily phone  ')).toBe(true)
    p.seen('phone1', { name: 'Renamed in Android' })
    expect(p.phones()[0]).toMatchObject({ name: 'Renamed in Android', model: '23127PN0CG', os: 'Android 15', customName: 'Daily phone' })
    p.rename('phone1', '')
    expect(p.phones()[0].customName).toBeUndefined()
    p.rename('phone1', 'Daily phone')
    tick(EXPIRE_MS) // 7 days without connecting: the pairing goes, and the name with it
    expect(p.phones()).toEqual([])
  })
})

describe('requests', () => {
  const req = (o: unknown) => Buffer.from(`${JSON.stringify(o)}\n`)
  it('accepts the known ones', () => {
    expect(parseRequest(req({ op: 'song', id: 'abc123', from: 10 }))).toEqual({ op: 'song', id: 'abc123', from: 10 })
    expect(parseRequest(req({ op: 'song', id: 'abc123', lowData: true, raw: true }))).toEqual({ op: 'song', id: 'abc123', from: 0, lowData: true, raw: true })
    expect(parseRequest(req({ op: 'library' }))).toEqual({ op: 'library', since: -1 })
    expect(parseRequest(req({ op: 'ping' }))).toEqual({ op: 'ping' })
    expect(parseRequest(req({ op: 'bench', bytes: 2048 }))).toEqual({ op: 'bench', bytes: 64 * 1024 })
    expect(parseRequest(req({ op: 'bench', bytes: 262144 }))).toEqual({ op: 'bench', bytes: 262144 })
  })
  it('refuses paths, unknown ops, oversize and broken requests', () => {
    expect(() => parseRequest(req({ op: 'song', id: '../../etc/passwd' }))).toThrow(BadRequest)
    expect(() => parseRequest(req({ op: 'song', id: 'C:\\Windows\\win.ini' }))).toThrow(BadRequest)
    expect(() => parseRequest(req({ op: 'file', path: 'x' }))).toThrow(BadRequest)
    expect(() => parseRequest(req({ op: 'song', id: 'a', from: -1 }))).toThrow(BadRequest)
    expect(() => parseRequest(Buffer.alloc(5000, 32))).toThrow(BadRequest)
    expect(() => parseRequest(Buffer.from('{"op":"hello"'))).toThrow(BadRequest)
  })
})

// ---- a real connection: the PC end serving a two-song library, a "phone" endpoint asking for things
const root = mkdtempSync(join(tmpdir(), 'mp-link-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const music = join(root, 'Music')
mkdirSync(music, { recursive: true })
const song = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251))
writeFileSync(join(music, 'a.flac'), song)
// Valid tiny 0.4s mono PCM WAV for real-time piped ffmpeg Opus streaming test
const wavSamples = 17640
const wavBuf = Buffer.alloc(44 + wavSamples * 2)
wavBuf.write('RIFF', 0, 4, 'ascii')
wavBuf.writeUInt32LE(36 + wavSamples * 2, 4)
wavBuf.write('WAVE', 8, 4, 'ascii')
wavBuf.write('fmt ', 12, 4, 'ascii')
wavBuf.writeUInt32LE(16, 16)
wavBuf.writeUInt16LE(1, 20)
wavBuf.writeUInt16LE(1, 22)
wavBuf.writeUInt32LE(44100, 24)
wavBuf.writeUInt32LE(88200, 28)
wavBuf.writeUInt16LE(2, 32)
wavBuf.writeUInt16LE(16, 34)
wavBuf.write('data', 36, 4, 'ascii')
wavBuf.writeUInt32LE(wavSamples * 2, 40)
for (let i = 0; i < wavSamples; i++) {
  wavBuf.writeInt16LE(Math.round(Math.sin((i / 44100) * 440 * Math.PI * 2) * 8000), 44 + i * 2)
}
writeFileSync(join(music, 'tone.wav'), wavBuf)
writeFileSync(join(root, 'secret.txt'), 'not for phones')
const tracks = [
  { id: 'aaaaaaaaaaaa', path: join(music, 'a.flac').replace(/\\/g, '/'), title: 'A', cover: '' },
  { id: 'bbbbbbbbbbbb', path: join(music, 'tone.wav').replace(/\\/g, '/'), title: 'Tone', cover: '' },
]
const library = {
  state: () => ({ tracks, version: 3 }),
  allowed: (p: string) => (p.replace(/\\/g, '/').startsWith(music.replace(/\\/g, '/')) ? p : null),
  coverFile: () => null,
}

async function ask(conn: any, request: object) {
  const bi = await conn.openBi()
  await bi.send.writeAll(Array.from(Buffer.from(`${JSON.stringify(request)}\n`)))
  await bi.send.finish()
  const all = Buffer.from(await bi.recv.readToEnd(10_000_000))
  const split = splitHeader(all)!
  return { head: split.head, body: split.rest }
}

async function askWithBody(conn: any, request: object, body: Buffer) {
  const bi = await conn.openBi()
  await bi.send.writeAll(Array.from(Buffer.from(`${JSON.stringify(request)}\n`)))
  await bi.send.writeAll(Array.from(body))
  await bi.send.finish()
  return splitHeader(Buffer.from(await bi.recv.readToEnd(1_000_000)))!.head
}

describe('link over iroh (loopback, no relay)', { timeout: 30_000 }, () => {
  let allowNext = true
  // §80 A: playlists the page keeps, and songs a phone sends
  const playlistJson = JSON.stringify({ lists: [{ id: 'p1', name: 'Mix', tracks: ['aaaaaaaaaaaa'], updated: 1 }], deleted: {} })
  const putLists: unknown[] = []
  const received: string[] = []
  const inbox = join(music, 'From phone')
  const pc = createLink({
    iroh,
    dataDir: root,
    protect: (b: Buffer) => b,
    unprotect: (b: Buffer) => b,
    library,
    pcName: () => 'TEST-PC',
    askAllow: async () => allowNext,
    playlists: { state: () => ({ json: playlistJson, version: 1 }), put: (sent: unknown) => { putLists.push(sent) } },
    uploads: { dir: () => inbox, done: (file: string) => { received.push(file) } },
    relay: false,
    bind: ['127.0.0.1:0'],
  })

  async function phone() {
    const b = iroh.Endpoint.builder()
    b.applyN0DisableRelay()
    b.bindAddr('127.0.0.1:0')
    return b.bind()
  }

  it('closes an unpaired phone, pairs one with the secret, then serves it', async () => {
    const { link } = await pc.pair()
    pc.stopPairing()
    const secret = new URL(link.replace('iemdream://', 'http://x/')).searchParams.get('s')!
    const p1 = await phone()
    // window closed: the connection is dropped before any request is answered
    const c0 = await p1.connect(pc.addr(), Array.from(Buffer.from(ALPN)))
    await expect(ask(c0, { op: 'hello' })).rejects.toBeTruthy()

    const fresh = await pc.pair()
    const s2 = new URL(fresh.link.replace('iemdream://', 'http://x/')).searchParams.get('s')!
    expect(s2).not.toBe(secret)
    const c1 = await p1.connect(pc.addr(), Array.from(Buffer.from(ALPN)))
    const paired = await ask(c1, { op: 'pair', secret: s2, name: 'Test phone' })
    expect(paired.head).toEqual({ ok: true, name: 'TEST-PC' })
    expect(pc.status().phones.map((x: { name: string }) => x.name)).toEqual(['Test phone'])

    const hello = await ask(c1, { op: 'hello', name: 'Xiaomi 14', model: '23127PN0CG', os: 'Android 15' })
    expect(hello.head).toMatchObject({ ok: true, name: 'TEST-PC', library: 3, protocol: 2 })
    // §81 A/F: the playlists' number rides along, and the phone's own details are kept; a PC-side rename wins at a glance
    expect(hello.head.playlists).toBeTypeOf('number')
    expect(Math.abs(hello.head.now - Date.now())).toBeLessThan(5000)
    expect(pc.status().phones[0]).toMatchObject({ name: 'Xiaomi 14', model: '23127PN0CG', os: 'Android 15' })
    expect(pc.rename(pc.status().phones[0].id, 'Mine')).toBe(true)
    expect(pc.status().phones[0]).toMatchObject({ name: 'Xiaomi 14', customName: 'Mine' })
    expect(hello.head.lan?.port).toBeGreaterThan(0)
    expect(hello.head.lan?.ips).toContain('127.0.0.1')
    expect(hello.head.lan?.token).toBeTypeOf('string')

    // Real bulk benchmark over iroh
    const irohBench = await ask(c1, { op: 'bench', bytes: 131_072 })
    expect(irohBench.head).toMatchObject({ ok: true, bytes: 131_072 })
    expect(irohBench.body.length).toBe(131_072)

    // Authenticated direct LAN HTTP channel + 206 Partial Content + piped Opus lowData
    const lanBase = `http://127.0.0.1:${hello.head.lan.port}`
    const unauth = await fetch(`${lanBase}/ping`)
    expect(unauth.status).toBe(401)

    // §81: the token itself is refused; each request is signed with it (method, path, time)
    expect((await fetch(`${lanBase}/ping`, { headers: { Authorization: `Bearer ${hello.head.lan.token}` } })).status).toBe(401)
    const signed = (path: string, t = Date.now(), method = 'GET') =>
      ({ Authorization: `AVSB t=${t}, sig=${lanSignature(Buffer.from(hello.head.lan.token, 'utf8'), method, path, String(t)).toString('hex')}` })
    expect((await fetch(`${lanBase}/ping`, { headers: signed('/bench?bytes=131072') })).status).toBe(401) // signed for another path
    expect((await fetch(`${lanBase}/ping`, { headers: signed('/ping', Date.now() - 5 * 60_000) })).status).toBe(401) // too old
    expect((await fetch(`${lanBase}/ping`, { headers: signed('/ping') })).status).toBe(200)
    const lanBench = await fetch(`${lanBase}/bench?bytes=131072`, { headers: signed('/bench?bytes=131072') })
    expect(lanBench.status).toBe(200)
    expect((await lanBench.arrayBuffer()).byteLength).toBe(131_072)

    const partial = await fetch(`${lanBase}/song/aaaaaaaaaaaa`, { headers: { ...signed('/song/aaaaaaaaaaaa'), Range: 'bytes=1000-1999' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 1000-1999/${song.length}`)
    expect(Buffer.from(await partial.arrayBuffer()).equals(song.subarray(1000, 2000))).toBe(true)

    const ffmpegExe = resolve(process.cwd(), '..', 'tools', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (existsSync(ffmpegExe)) {
      const opusRes = await fetch(`${lanBase}/song/bbbbbbbbbbbb?lowdata=1`, { headers: signed('/song/bbbbbbbbbbbb?lowdata=1') })
      expect(opusRes.status).toBe(200)
      expect(opusRes.headers.get('content-type')).toContain('audio/ogg')
      const opusBytes = Buffer.from(await opusRes.arrayBuffer())
      expect(opusBytes.subarray(0, 4).toString('ascii')).toBe('OggS')
    }
    const lib = await ask(c1, { op: 'library' })
    const list = JSON.parse(lib.body.toString('utf8'))
    expect(list[0]).toMatchObject({ id: 'aaaaaaaaaaaa', title: 'A' })
    expect(list[0].path).toBeUndefined() // where it sits on the PC isn't sent

    const whole = await ask(c1, { op: 'song', id: 'aaaaaaaaaaaa' })
    expect(whole.head).toMatchObject({ ok: true, size: song.length, bytes: song.length })
    expect(whole.body.equals(song)).toBe(true)
    const rest = await ask(c1, { op: 'song', id: 'aaaaaaaaaaaa', from: 100_000 })
    expect(rest.body.equals(song.subarray(100_000))).toBe(true)

    expect((await ask(c1, { op: 'song', id: 'nothere' })).head).toEqual({ ok: false, error: 'not found' })
    expect((await ask(c1, { op: 'song', id: '../secret.txt' })).head.ok).toBe(false)

    // §80 A: playlists both ways, and a song sent from the phone
    const lists = await ask(c1, { op: 'playlists' })
    expect(JSON.parse(lists.body.toString('utf8')).lists[0]).toMatchObject({ id: 'p1', tracks: ['aaaaaaaaaaaa'] })
    expect((await ask(c1, { op: 'playlists', since: 1 })).head).toEqual({ ok: true, version: 1, same: true })
    const mine = Buffer.from(JSON.stringify({ lists: [{ id: 'p2', name: 'Phone', tracks: ['phone:42'], updated: 5 }], deleted: {} }))
    expect(await askWithBody(c1, { op: 'playlists-put', bytes: mine.length }, mine)).toEqual({ ok: true })
    expect(putLists).toEqual([JSON.parse(mine.toString('utf8'))])
    const file = Buffer.alloc(300_000, 9)
    const sentSong = await askWithBody(c1, { op: 'upload', name: '../../Artist - Song.flac', bytes: file.length }, file)
    expect(sentSong).toEqual({ ok: true, name: 'Artist - Song.flac' })
    expect(received).toEqual([join(inbox, 'Artist - Song.flac')])
    expect(readFileSync(received[0]).equals(file)).toBe(true)
    // the same name again doesn't overwrite; a cut-off one leaves nothing behind
    expect(await askWithBody(c1, { op: 'upload', name: 'Artist - Song.flac', bytes: 10 }, Buffer.alloc(10))).toEqual({ ok: true, name: 'Artist - Song (2).flac' })
    expect(await askWithBody(c1, { op: 'upload', name: 'Cut.flac', bytes: 1000 }, Buffer.alloc(10))).toEqual({ ok: false, error: 'cut off' })
    expect(existsSync(join(inbox, 'Cut.flac')) || existsSync(join(inbox, 'Cut.flac.part'))).toBe(false)
    expect((await askWithBody(c1, { op: 'upload', name: 'run.exe', bytes: 10 }, Buffer.alloc(10))).ok).toBe(false)

    // Remove closes it at once, and it can't come back without pairing again
    pc.remove(pc.status().phones[0].id)
    await expect(ask(c1, { op: 'hello' })).rejects.toBeTruthy()
    // ...and its LAN token stops working too
    expect((await fetch(`${lanBase}/ping`, { headers: signed('/ping') })).status).toBe(401)
    const c2 = await p1.connect(pc.addr(), Array.from(Buffer.from(ALPN)))
    await expect(ask(c2, { op: 'hello' })).rejects.toBeTruthy()
    await p1.close()
  })

  it('a declined phone is not added', async () => {
    allowNext = false
    const { link } = await pc.pair()
    const s = new URL(link.replace('iemdream://', 'http://x/')).searchParams.get('s')!
    const p2 = await phone()
    const c = await p2.connect(pc.addr(), Array.from(Buffer.from(ALPN)))
    expect((await ask(c, { op: 'pair', secret: s, name: 'Stranger' })).head).toEqual({ ok: false, error: 'declined' })
    expect(pc.status().phones).toEqual([])
    await p2.close()
    await pc.stop()
  })
})

describe('LAN server callers (review item 9)', () => {
  it('answers the home network only', () => {
    for (const ip of ['192.168.1.20', '10.0.0.5', '172.20.3.4', '::ffff:192.168.0.9', '127.0.0.1', '169.254.10.1']) expect(isPrivateIp(ip)).toBe(true)
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '::ffff:1.2.3.4', '']) expect(isPrivateIp(ip)).toBe(false)
  })
})

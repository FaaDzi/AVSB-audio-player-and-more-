// Who may connect to this PC (plan §70 "Security"). Pure logic: no network, no Electron, so it's tested on its own.
//
// - A phone is known by its public key (its iroh endpoint id). Only known phones get anything; an unknown key may only
//   send a pairing claim, and only while the pairing window is open.
// - Pairing: a one-time 128-bit secret, good for 5 minutes and one use. Five wrong claims close the window. A right
//   claim still waits for the PC owner's Allow.
// - At most 5 phones. A pairing unused for 7 days expires; every connection restarts the 7 days (owner, 2026-11-06).
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const MAX_PHONES = 5
export const PAIR_WINDOW_MS = 5 * 60_000
export const EXPIRE_MS = 7 * 24 * 60 * 60_000
export const MAX_WRONG = 5
const NAME_MAX = 40

/** A phone's own name, as shown on the PC: printable, trimmed, short. */
export const cleanName = (name) =>
  String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, NAME_MAX) || 'Phone'

/**
 * @param {{ load: () => any, save: (phones: any[]) => void, now?: () => number, random?: (n: number) => Buffer }} io
 */
export function createPairing({ load, save, now = Date.now, random = randomBytes }) {
  /** @type {{ id: string, name: string, model?: string, os?: string, customName?: string, pairedAt: number, lastSeen: number }[]} */
  const loaded = load()
  let phones = (Array.isArray(loaded) ? loaded : []).filter((p) => p && typeof p.id === 'string' && typeof p.lastSeen === 'number')
  /** @type {{ secret: Buffer, expires: number, wrong: number } | null} */
  let window = null

  const prune = () => {
    const live = phones.filter((p) => now() - p.lastSeen < EXPIRE_MS)
    if (live.length !== phones.length) {
      phones = live
      save(phones)
    }
  }

  return {
    /** Paired phones that haven't expired. */
    phones() {
      prune()
      return phones.map((p) => ({ ...p, expires: p.lastSeen + EXPIRE_MS }))
    },

    /** May this key connect? Restarts its 7 days when it may. */
    admit(id) {
      prune()
      const p = phones.find((x) => x.id === id)
      if (!p) return false
      p.lastSeen = now()
      save(phones)
      return true
    },

    /** Opens (or reopens) the pairing window with a fresh secret. */
    open() {
      window = { secret: random(16), expires: now() + PAIR_WINDOW_MS, wrong: 0 }
      return { secret: window.secret.toString('hex'), expires: window.expires }
    },

    close() {
      window = null
    },

    /** Is the window open right now (not expired, not used up)? */
    isOpen() {
      if (window && now() >= window.expires) window = null
      return window !== null
    },

    /**
     * A phone's claim. 'ask' means the secret was right and the window is now used up: ask the owner, then call add().
     * @returns {'ask' | 'closed' | 'wrong' | 'full' | 'known'}
     */
    claim(secretHex, id) {
      if (!this.isOpen()) return 'closed'
      prune()
      if (phones.some((p) => p.id === id)) return 'known'
      if (phones.length >= MAX_PHONES) return 'full'
      const given = /^[0-9a-f]{32}$/i.test(String(secretHex ?? '')) ? Buffer.from(String(secretHex), 'hex') : Buffer.alloc(16)
      if (!timingSafeEqual(given, window.secret)) {
        window.wrong += 1
        if (window.wrong >= MAX_WRONG) window = null
        return 'wrong'
      }
      window = null // one use
      return 'ask'
    },

    /** The owner tapped Allow. */
    add(id, name, about = {}) {
      prune()
      if (phones.some((p) => p.id === id) || phones.length >= MAX_PHONES) return false
      const t = now()
      phones.push({ id, name: cleanName(name), pairedAt: t, lastSeen: t })
      save(phones)
      this.seen(id, about)
      return true
    },

    /** What a paired phone says about itself (§81 F): its name, model number and Android version. True when it changed. */
    seen(id, about) {
      const p = phones.find((x) => x.id === id)
      if (!p) return false
      const next = { ...p }
      for (const k of ['name', 'model', 'os']) if (typeof about?.[k] === 'string' && about[k].trim()) next[k] = cleanName(about[k])
      if (next.name === p.name && next.model === p.model && next.os === p.os) return false
      Object.assign(p, next)
      save(phones)
      return true
    },

    /** The PC owner's own name for a phone; empty goes back to the phone's name. Kept for as long as the pairing is. */
    rename(id, customName) {
      const p = phones.find((x) => x.id === id)
      if (!p) return false
      const name = String(customName ?? '').trim() ? cleanName(customName) : ''
      if (name) p.customName = name
      else delete p.customName
      save(phones)
      return true
    },

    remove(id) {
      const before = phones.length
      phones = phones.filter((p) => p.id !== id)
      if (phones.length !== before) save(phones)
      return phones.length !== before
    },
  }
}

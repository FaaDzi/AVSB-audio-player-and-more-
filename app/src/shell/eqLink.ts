// §114 G: saved EQs between the PC and its phones. The PC keeps an outbox per phone (in its settings, so an EQ for a
// phone that is away waits for it); a phone takes its EQs when the link says something moved, and sends its own EQs
// to the PC only. Phone to phone goes through the PC: it lands there, then the PC sends it on.
import { useEffect } from 'react'
import { host } from './host'
import { phoneLink } from './linkClient'
import { getPresets, readPreset, setPresets, withPreset, type SavedPreset } from './eqState'
import { PRESETS } from './settings/CustomPages'
import { getSetting, setSetting } from './settings/store'

type Outbox = Record<string, SavedPreset[]>

const readOutbox = (): Outbox => {
  try {
    const o = JSON.parse(String(getSetting('eqoutbox') ?? '{}')) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Outbox) : {}
  } catch {
    return {}
  }
}
const writeOutbox = (o: Outbox) => {
  setSetting('eqoutbox', JSON.stringify(o))
  host()?.link?.pushEqOutbox?.(JSON.stringify(o))
}

/** A name no saved or built-in preset has yet: "Name", then "Name (2)", "Name (3)", … */
export function freeName(name: string, taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(name) && !PRESETS[name]) return name
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`) && !PRESETS[`${name} (${i})`]) return `${name} (${i})`
}

/** Saves an EQ that arrived over the link (checked like an imported file) and answers its name, or null if it isn't one. */
export function receiveEq(sent: unknown): string | null {
  let p: SavedPreset
  try {
    p = readPreset(JSON.stringify(sent))
  } catch {
    return null
  }
  const saved = getPresets()
  // the very same EQ again isn't a copy
  const same = saved.find((s) => s.name === p.name && JSON.stringify(s) === JSON.stringify(p))
  if (same) return same.name
  const named = { ...p, name: freeName(p.name, saved.map((s) => s.name)) }
  setPresets(withPreset(saved, named))
  return named.name
}

/** PC: queues the EQ for each of these phones; a connected one picks it up within seconds. */
export function sendEqToPhones(p: SavedPreset, phoneIds: string[]) {
  const o = readOutbox()
  for (const id of phoneIds) o[id] = [...(o[id] ?? []).filter((q) => q.name !== p.name), p]
  writeOutbox(o)
}

/** Phone: sends the EQ to the PC. */
export async function sendEqToPc(p: SavedPreset): Promise<void> {
  if (!phoneLink?.putEq) throw new Error('Not linked to a PC')
  await phoneLink.putEq({ json: JSON.stringify(p) })
}

export const canSendToPc = () => Boolean(phoneLink?.putEq)
export const canSendToPhones = () => Boolean(host()?.link?.pushEqOutbox)

/** Mounted once (Shell): takes EQs in on either side and tells the owner. */
export function useEqLink(showToast: (msg: string) => void) {
  useEffect(() => {
    const link = host()?.link
    if (!link?.pushEqOutbox) return
    link.pushEqOutbox(JSON.stringify(readOutbox()))
    return link.onEq?.((msg) => {
      if (msg.type === 'eq-taken') {
        const o = readOutbox()
        delete o[msg.phoneId]
        writeOutbox(o)
        return
      }
      const name = receiveEq(msg.preset)
      if (name) showToast(`${name} from ${msg.from}`)
    })
  }, [showToast])

  useEffect(() => {
    const link = phoneLink
    if (!link?.eqInbox) return
    let busy = false
    const pull = async () => {
      if (busy) return
      busy = true
      try {
        const r = await link.eqInbox!()
        const got = r?.json ? (JSON.parse(r.json) as unknown) : null
        if (!Array.isArray(got)) return
        const names = got.map(receiveEq).filter((n): n is string => Boolean(n))
        if (names.length) showToast(names.length === 1 ? `${names[0]} from your PC` : `${names.length} EQs from your PC`)
      } catch {
        // not connected: the next change tries again
      } finally {
        busy = false
      }
    }
    void pull()
    const sub = link.addListener('changed', () => { void pull() })
    return () => { void sub.then((s) => s.remove()) }
  }, [showToast])
}

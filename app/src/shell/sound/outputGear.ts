// §119: on the PC, My gear's device follows the Windows output. Each output endpoint remembers the device last used
// on it (a DAC with IEMs, the onboard speakers with speakers), and switching output in Windows brings that device
// back. A new output that Windows names like speakers (onboard, HDMI/DisplayPort audio, S/PDIF…) offers your speakers
// once. The endpoint is what's reliable: a USB DAC calls itself "Speakers" too, so the name alone never decides.
import { useEffect, useRef } from 'react'
import { defaultOutput, onDeviceChange } from '../../fit/system'
import { isAndroid } from '../../platform'
import type { ToastItem } from '../context'
import { loadDatabase } from '../database/catalog'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { getGear, setActive } from './gear'
import { gearName } from './phoneSpeaker'
import { isSpeakerDevice } from './gearProfiles'

/** Outputs Windows (and its drivers) name as speakers or a screen: onboard codecs, HDMI/DP audio, S/PDIF, monitors. */
const SPEAKERISH = /^(speakers?|speaker\/hp|line out|digital (audio|output)|s\/?pdif|realtek|nvidia|amd|intel|hdmi|displayport|monitor|tv)\b|\b(high definition audio|display audio|hdmi|displayport|s\/?pdif|optical|realtek|sst audio|smart sound)\b/i
/** Names that are clearly an ear device or a DAC, which never count as speakers whatever else the label says. */
const EARISH = /\b(headphones?|headset|earphones?|earbuds?|hands-free|dac|dongle|usb audio|amp)\b/i

export const looksLikeSpeakers = (label: string) => SPEAKERISH.test(label) && !EARISH.test(label)

/** Strips "Default - " and Windows' "(2- …)" duplicates so one endpoint keeps one key. */
export const outputKey = (label: string) => label.replace(/^Default - /i, '').replace(/\(\d+- /, '(').trim().toLowerCase()

export interface OutputDecision { kind: 'switch' | 'offer' | 'stay'; id: string | null }

/** What to do when the output becomes `label`, given the remembered map and your devices. Pure, for tests. */
export function decideForOutput(label: string, map: Record<string, string>, owned: string[], active: string | null): OutputDecision {
  const remembered = map[outputKey(label)]
  if (remembered && owned.includes(remembered)) return remembered === active ? { kind: 'stay', id: active } : { kind: 'switch', id: remembered }
  if (looksLikeSpeakers(label) && !(active && isSpeakerDevice(active))) {
    const speakers = owned.find((id) => isSpeakerDevice(id))
    if (speakers) return { kind: 'offer', id: speakers }
  }
  return { kind: 'stay', id: active }
}

const readMap = (): Record<string, string> => {
  try { return JSON.parse(String(getSetting('gearbyoutput') ?? '{}')) as Record<string, string> } catch { return {} }
}

/** The PC hook: follows the output, remembers your picks per output. Off with Settings → My gear → Follow the output. */
export function useOutputFollow(toast: (t: ToastItem) => void) {
  const current = useRef<string | null>(null)
  useEffect(() => {
    if (isAndroid()) return
    let live = true
    const name = async (id: string) => {
      const db = await loadDatabase().catch(() => null)
      return gearName(id, db?.catalog.byId.get(id)?.name)
    }
    const look = () => void defaultOutput().then(async (o) => {
      if (!live || !o) return
      const changed = current.current !== null && current.current !== o.label
      current.current = o.label
      if (!changed || getSetting('followoutput') === false) return
      const gear = getGear()
      const d = decideForOutput(o.label, readMap(), gear.owned.map((x) => x.id), gear.active)
      if (!d.id || d.kind === 'stay') return
      const before = gear.active
      const label = o.label.replace(/^Default - /i, '')
      if (d.kind === 'switch') {
        setActive(d.id)
        toast({ message: `${label}: ${await name(d.id)}`, action: { label: 'Undo', onClick: () => setActive(before) } })
      } else {
        const id = d.id
        toast({ message: `${label} sounds like speakers`, action: { label: `Use ${await name(id)}`, onClick: () => setActive(id) } })
      }
    }, () => {})
    look()
    const off = onDeviceChange(look)
    // whatever device you pick while on an output is the one that output remembers
    let lastActive = getGear().active
    const unsub = subscribeSettings(() => {
      const a = getGear().active
      if (a === lastActive) return
      lastActive = a
      if (a && current.current) setSetting('gearbyoutput', JSON.stringify({ ...readMap(), [outputKey(current.current)]: a }))
    })
    return () => { live = false; off(); unsub() }
  }, [toast])
}

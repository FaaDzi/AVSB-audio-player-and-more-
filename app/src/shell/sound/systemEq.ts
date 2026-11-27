// §119: AVSB's EQ in other apps. Android: DynamicsProcessing on their sessions (SystemEq.kt). PC: Equalizer APO,
// kept live through an include file (electron main). Both follow every EQ / Sound change, a moment after it settles.
import { registerPlugin } from '@capacitor/core'
import { useEffect } from 'react'
import { isAndroid } from '../../platform'
import { playingCurveDb } from '../engine'
import { getEq } from '../eqState'
import { getSetting, setSetting, subscribeSettings } from '../settings/store'
import { logLine } from '../logs'
import type { ToastItem } from '../context'

interface SystemEqPlugin { set(o: { on: boolean; freqs?: number[]; gains?: number[]; preamp?: number }): Promise<{ on: boolean; sessions?: number }> }
const plugin = isAndroid() ? registerPlugin<SystemEqPlugin>('SystemEq') : null

/** 1/3-octave centres, 20 Hz–20 kHz (31 bands, as Wavelet and a graphic EQ use). */
export const THIRD_OCTAVES = Array.from({ length: 31 }, (_, i) => Math.round(20 * 2 ** (i / 3) * 10) / 10)

/** APO's GraphicEQ line for a curve: "GraphicEQ: 20 1.2; 25 0.8; …". */
export const apoGraphicEq = (freqs: number[], gains: number[], preamp: number) =>
  `Preamp: ${preamp.toFixed(1)} dB\nGraphicEQ: ${freqs.map((f, i) => `${f} ${gains[i].toFixed(1)}`).join('; ')}\n`

interface ApoBridge { apoWrite?: (text: string | null) => Promise<{ ok: boolean; error?: string }> }

export function useSystemEq(toast: (t: ToastItem) => void) {
  useEffect(() => {
    let timer = 0
    let last = ''
    const push = () => {
      const on = getSetting('systemeq') === true
      const gains = on ? playingCurveDb(THIRD_OCTAVES).map((g) => Math.round(g * 10) / 10) : []
      // headroom for the boosts, plus your preamp: the other app gets no limiter of AVSB's own
      const preamp = on ? Math.round((Math.min(0, -Math.max(0, ...gains)) + (getEq().on ? getEq().preamp : 0)) * 10) / 10 : 0
      const key = JSON.stringify([on, gains, preamp])
      // off from the start: nothing to undo, so APO and the Android service are never touched (no admin prompt)
      if (!on && last === '') { last = key; return }
      if (key === last) return
      last = key
      if (plugin) void plugin.set(on ? { on, freqs: THIRD_OCTAVES, gains, preamp } : { on: false }).catch((e: unknown) => logLine('WARN', 'EQ', `Other apps: ${String(e)}`))
      else {
        const apo = (window as unknown as { musicHost?: ApoBridge }).musicHost?.apoWrite
        if (apo) void apo(on ? apoGraphicEq(THIRD_OCTAVES, gains, preamp) : null).then((r) => { if (!r.ok) { logLine('WARN', 'EQ', `Equalizer APO: ${r.error ?? 'not written'}`); toast(r.error === 'Equalizer APO is not installed' ? 'Install Equalizer APO first (equalizerapo.com), then turn this on again' : `Equalizer APO: ${r.error ?? 'not written'}`); setSetting('systemeq', false) } })
      }
    }
    push()
    const unsub = subscribeSettings(() => { window.clearTimeout(timer); timer = window.setTimeout(push, 400) })
    return () => { unsub(); window.clearTimeout(timer) }
  }, [toast])
}

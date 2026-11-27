// §118: playing a listening preset's sound: its EQ worked out against the gear (no blind adds), its spatial mode
// (the one before is kept so Plain, or a preset without one, puts it back), and the hand-over with the owner's own EQs.
import { loadSpatial, updateSpatial } from '../../spatial/settings'
import type { SpatialSettings } from '../../spatial/types'
import { isListeningName, listeningName, presetFilters, type ListeningPreset } from '../../wireless/listeningPresets'
import { gearDeviation } from '../engine'
import { getEq, getPresets, setEq } from '../eqState'

const SPATIAL_BEFORE = 'listen-spatial-before'

/** The owner's own saved EQ playing now (a preset would replace it), or null. */
export function userEqInUse(): string | null {
  const eq = getEq()
  return eq.on && !isListeningName(eq.preset) && getPresets().some((p) => p.name === eq.preset) ? eq.preset : null
}

/** The listening preset playing now (by its EQ name), or null. */
export const listeningInUse = (): string | null => {
  const eq = getEq()
  return eq.on && isListeningName(eq.preset) ? eq.preset : null
}

function restoreSpatial() {
  try {
    const before = localStorage.getItem(SPATIAL_BEFORE)
    if (!before) return
    localStorage.removeItem(SPATIAL_BEFORE)
    updateSpatial(JSON.parse(before) as Partial<SpatialSettings>)
  } catch { /* nothing to put back */ }
}

export function applyListeningSound(p: ListeningPreset) {
  if (p.group === 'plain') {
    if (listeningInUse()) setEq({ on: false })
    restoreSpatial()
    return
  }
  const d = gearDeviation()
  setEq({ on: true, mode: 'advanced+', filters: presetFilters(p, d?.grid ?? null, d?.dev ?? null), preamp: p.preamp, preset: listeningName(p), edited: false })
  if (p.spatial) {
    try { if (!localStorage.getItem(SPATIAL_BEFORE)) localStorage.setItem(SPATIAL_BEFORE, JSON.stringify(loadSpatial())) } catch { /* only for putting it back */ }
    updateSpatial(p.spatial)
  } else restoreSpatial()
}

import { loadEarCorrection } from './earCorrection'
import { clampHeadCm, scaleItd, AVERAGE_HEAD_CM } from './headSize'
import { hrirVersion, loadHrirSet } from './hrir'
import type { HeadTracking, SpatialMode, SpatialSettings, SpatialStageApi } from './types'

const KEY = 'spatial-v1'
export const SPATIAL_MODES: SpatialMode[] = ['off', 'crossfeed', 'speakers', 'room', '360']
const TRACKING: HeadTracking[] = ['off', 'webcam', 'phone-camera', 'earbuds', 'rough']
export const DEFAULT_SPATIAL: SpatialSettings = { mode: 'off', hrirId: 'generic', headTracking: 'off', headCm: null, headCmBy: null, xfAmount: 100, xfAngle: 30, frontFollows: true, modeBeforeTracking: null }
export const XF_AMOUNT_RANGE = [0, 150] as const
export const XF_ANGLE_RANGE = [30, 90] as const
const inRange = (v: unknown, [lo, hi]: readonly [number, number], dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt

/** Fills in defaults and drops anything unknown (an old or hand-edited save). */
export function sanitizeSpatial(v: unknown): SpatialSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<SpatialSettings>
  return {
    mode: SPATIAL_MODES.includes(o.mode as SpatialMode) ? (o.mode as SpatialMode) : DEFAULT_SPATIAL.mode,
    hrirId: typeof o.hrirId === 'string' && o.hrirId ? o.hrirId : DEFAULT_SPATIAL.hrirId,
    headTracking: TRACKING.includes(o.headTracking as HeadTracking) ? (o.headTracking as HeadTracking) : DEFAULT_SPATIAL.headTracking,
    headCm: typeof o.headCm === 'number' && Number.isFinite(o.headCm) ? clampHeadCm(o.headCm) : null,
    headCmBy: typeof o.headCm === 'number' && Number.isFinite(o.headCm) && (o.headCmBy === 'you' || o.headCmBy === 'camera') ? o.headCmBy : null,
    xfAmount: inRange(o.xfAmount, XF_AMOUNT_RANGE, DEFAULT_SPATIAL.xfAmount),
    xfAngle: inRange(o.xfAngle, XF_ANGLE_RANGE, DEFAULT_SPATIAL.xfAngle),
    frontFollows: o.frontFollows !== false,
    modeBeforeTracking: SPATIAL_MODES.includes(o.modeBeforeTracking as SpatialMode) ? (o.modeBeforeTracking as SpatialMode) : null,
  }
}

export function loadSpatial(): SpatialSettings {
  try {
    return sanitizeSpatial(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_SPATIAL }
  }
}

const listeners = new Set<(s: SpatialSettings) => void>()

/** Saves and tells every subscriber (players, settings screen). */
export function saveSpatial(s: SpatialSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
  for (const cb of [...listeners]) cb(s)
}

export function updateSpatial(patch: Partial<SpatialSettings>) {
  saveSpatial({ ...loadSpatial(), ...patch })
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onSpatialChange(cb: (s: SpatialSettings) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * Keeps a player's stage on the saved settings: applies them now and on every change, loading the
 * HRIR set when it changes (the stage stays dry until a set has arrived). Returns the unsubscribe.
 */
export function followSpatialSettings(stage: SpatialStageApi): () => void {
  let hrirId = ''
  const apply = (s: SpatialSettings) => {
    // the version changes when a set is replaced under the same id (a new SOFA import)
    const want = `${s.hrirId}#${hrirVersion(s.hrirId)}#${s.headCm ?? ''}`
    if (s.mode !== 'off' && s.mode !== 'crossfeed' && want !== hrirId) {
      hrirId = want
      loadHrirSet(s.hrirId)
        .catch(() => (s.hrirId === DEFAULT_SPATIAL.hrirId ? Promise.reject(new Error('no HRIR')) : loadHrirSet(DEFAULT_SPATIAL.hrirId)))
        .then((set) => {
          // your head width moves the far ear's timing (headSize.ts); average leaves the set as measured
          if (hrirId === want) stage.setHrir(scaleItd(set, (s.headCm ?? AVERAGE_HEAD_CM) / AVERAGE_HEAD_CM))
        })
        .catch(() => {
          hrirId = ''
        })
    }
    stage.setCrossfeed?.(s.xfAmount, s.xfAngle)
    stage.setMode(s.mode)
  }
  // the virtual speakers' ear-gain correction: automatic, fetched once
  void loadEarCorrection().then((f) => f && stage.setEarCorrection?.(f))
  apply(loadSpatial())
  return onSpatialChange(apply)
}

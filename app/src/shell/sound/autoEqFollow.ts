// §110: an applied AutoEQ follows a new HRTF, but only while it is still exactly what AutoEQ applied.
import type { Biquad } from '../../eq/biquad'
import { airMode } from '../../audio/filter'
import { loadFit } from '../../fit/fit'
import { kindOfIem } from '../../data/catalog'
import { loadSpatial, onSpatialChange } from '../../spatial/settings'
import { loadDatabase } from '../database/catalog'
import { autoEq, eqScene } from '../eqStudio'
import { getEq, presetFrom, setEq, type EqState } from '../eqState'
import { logLine } from '../logs'
import { getSetting, setSetting } from '../settings/store'
import { getLab, hrtfTilt, loadDf } from '../settings/EqStudio'
import { loadRefsOnce } from '../tournament/engine'
import { getGear } from './gear'
import { isHeadphoneDevice, isSpeakerDevice, setSessionAutosave } from './gearProfiles'
import { familyOf } from './soundCurve'

const KEY = 'autoeqlast'
const AUTOSAVE = 'Custom EQ 1 (Autosaved)'
export interface AppliedAutoEq { device: string | null; hrirId: string; filters: Biquad[]; preamp: number }

/** Called when AutoEQ is applied: what it set, for which gear and HRTF. */
export function rememberAutoEq(device: string | null, filters: Biquad[], preamp: number) {
  setSetting(KEY, JSON.stringify({ device, hrirId: loadSpatial().hrirId, filters, preamp } satisfies AppliedAutoEq))
}

function lastAutoEq(): AppliedAutoEq | null {
  try {
    return JSON.parse(String(getSetting(KEY) ?? 'null')) as AppliedAutoEq | null
  } catch {
    return null
  }
}

/** True while the EQ is still what AutoEQ applied for `device` (any edit, preset or other gear makes it yours). */
export function untouched(last: AppliedAutoEq | null, eq: EqState, device: string | null): last is AppliedAutoEq {
  return Boolean(
    last && last.device === device && eq.on && eq.mode === 'advanced+' && eq.preset === AUTOSAVE &&
    eq.preamp === last.preamp && JSON.stringify(eq.filters) === JSON.stringify(last.filters),
  )
}

async function reapply(hrirId: string) {
  const device = getGear().active
  const last = lastAutoEq()
  if (!untouched(last, getEq(), device) || last.hrirId === hrirId) return
  const lab = getLab(device)
  if (!lab.hrtf || lab.aim.kind === 'off') return
  const [db, refs, df] = await Promise.all([loadDatabase(), loadRefsOnce(), loadDf()])
  // the user may have changed something while that loaded
  if (!untouched(lastAutoEq(), getEq(), device) || getGear().active !== device || loadSpatial().hrirId !== hrirId) return
  const d = device ? db.catalog.byId.get(device) : undefined
  const strength = isSpeakerDevice(device) ? 0 : isHeadphoneDevice(device) || (d && kindOfIem(d) === 'headphones') ? 0.5 : 1
  const grid = db.catalog.data.grid
  const scene = eqScene({ catalog: db.catalog, refs, fit: loadFit(), airMode: airMode() }, device, { ...lab, hrtf: hrtfTilt(df, hrirId, grid, strength)?.curve ?? null })
  const r = autoEq(scene, lab.filters, lab.gentle ? 'standard' : 'precise', familyOf(db.catalog, device) === 'iem')
  if (!r) return
  const eq = getEq()
  const preamp = eq.headroom ? 0 : r.preamp
  setEq({ mode: 'advanced+', filters: r.filters, preamp, on: true, preset: AUTOSAVE })
  setSessionAutosave(device, presetFrom({ ...eq, filters: r.filters, preamp }, AUTOSAVE, device))
  rememberAutoEq(device, r.filters, preamp)
  logLine('INFO', 'EQ', `AutoEQ redone for HRTF ${hrirId}: ${r.afterDb.toFixed(1)} dB off target`)
}

/** Started once at launch. */
export function followAutoEq() {
  let hrirId = loadSpatial().hrirId
  onSpatialChange((s) => {
    if (s.hrirId === hrirId) return
    hrirId = s.hrirId
    void reapply(hrirId).catch((e) => logLine('WARN', 'EQ', `AutoEQ redo failed: ${e}`))
  })
}

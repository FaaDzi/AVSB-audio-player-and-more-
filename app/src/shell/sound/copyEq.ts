// 'Copy this EQ': extracts the frequency response correction curve from the active
// reference target or gear imitation at its exact percentage (e.g. 78%), bakes it
// into biquad parametric filters using fitParametric(), saves it as Custom EQ 1,
// turns off the target simulation (to prevent double-EQ), and loads it into the Equalizer.
import { loadDatabase } from '../database/catalog'
import { loadRefs } from '../../audio/reference'
import { loadFit } from '../../fit/fit'
import { soundCurve, type SoundEnv } from './soundCurve'
import { getSound, setSound } from './soundState'
import { getGear } from './gear'
import { fitParametric, PARAMETRIC_20 } from '../../eq/parametric'
import { BANDS, getPresets, setEq, setPresets, withPreset, type SavedPreset } from '../eqState'
import { applyProfileItem } from './gearProfiles'

export async function copyCurrentAimToEq(requestedName?: string): Promise<{ success: boolean; presetName?: string; error?: string }> {
  const sound = getSound()
  if (sound.aim.kind === 'off') {
    return { success: false, error: 'No reference target or audio gear imitation is active.' }
  }

  const gear = getGear()
  const [db, refs] = await Promise.all([loadDatabase(), loadRefs()])
  const env: SoundEnv = {
    catalog: db.catalog,
    refs,
    fit: loadFit(),
    airMode: 'auto',
  }

  const effectiveSound = { ...sound, deviceId: sound.deviceId ?? gear.active }
  const res = soundCurve(env, effectiveSound)
  if (!res.curve) {
    return { success: false, error: 'Could not calculate frequency response curve.' }
  }

  const fitted = fitParametric(db.catalog.data.grid, res.curve, PARAMETRIC_20)
  const presets = getPresets()

  // Determine preset name: Custom EQ 1 (or increment if user wants unique, or use requestedName)
  let presetName = requestedName
  if (!presetName) {
    presetName = 'Custom EQ 1'
    let counter = 1
    while (presets.some((p) => p.name === presetName)) {
      counter++
      presetName = `Custom EQ ${counter}`
    }
  }

  const newPreset: SavedPreset = {
    name: presetName,
    mode: 'advanced+',
    count: 10,
    gains: BANDS[10].map(() => 0),
    filters: fitted.filters,
    preamp: Math.round(fitted.preampDb * 10) / 10,
    bass: 0,
    treble: 0,
  }

  // Save to presets list
  setPresets(withPreset(presets, newPreset))

  // Activate in EQ
  setEq({
    on: true,
    mode: 'advanced+',
    preset: presetName,
    filters: fitted.filters,
    preamp: Math.round(fitted.preampDb * 10) / 10,
    bass: 0,
    treble: 0,
  })

  // Turn aim off so we don't double-filter the audio
  applyProfileItem(null)
  setSound({ aim: { kind: 'off' }, bypass: false })

  return { success: true, presetName }
}

// §107 E: "User made EQ" in the sound circle: the EQ presets you saved for the gear in use.
import { getPresets, presetFields, setEq, useEq, type SavedPreset } from '../eqState'
import { applyProfileItem } from './gearProfiles'
import { setSound } from './soundState'

/** Your saved presets made for `device`, and the one the EQ plays now (null when none of them, or the EQ is off). */
export function useMyEq(device: string | null) {
  // useEq re-renders on every settings change, which covers the saved presets too
  const eq = useEq()
  const mine = getPresets().filter((p) => p.device === device)
  const active = eq.on ? mine.find((p) => p.name === eq.preset) ?? null : null
  return { mine, active }
}

/** Plays a saved preset; the circle's target goes to Raw so nothing is applied twice (as AutoEQ does). */
export function applyMyEq(p: SavedPreset, device: string | null) {
  applyProfileItem(null, device)
  setSound({ aim: { kind: 'off' }, bypass: false })
  setEq({ ...presetFields(p), on: true })
}

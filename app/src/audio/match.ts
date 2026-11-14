import { correctionCurve, designFir, type CorrectionOptions } from './filter'
import { firPeak } from './headroom'
import { filteredLoudnessDb, type Spectrum } from './loudness'

/**
 * Highest sample level a match may reach (dBFS): under full scale by the peak estimate's error
 * (MATCH_WINDOWS windows land within 0.65 dB of filtering the whole clip, measured on real songs)
 * plus a little for the L/R balance trim.
 */
const TRUE_PEAK_CEILING_DB = -1

/** How many of the clip's loudest windows (headroom.ts loudWindows) to measure each side's peak on; 64 missed by up to 1.6 dB. */
export const MATCH_WINDOWS = 256

const LEVEL_MATCH_KEY = 'level-match-v1'

/** "Match loudness" (default) or off: each side keeps its own level, the way an unmatched recording plays. */
export function levelMatchOn(): boolean {
  try {
    return localStorage.getItem(LEVEL_MATCH_KEY) !== '0'
  } catch {
    return true
  }
}

export function setLevelMatchOn(on: boolean) {
  try {
    localStorage.setItem(LEVEL_MATCH_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export interface SideFilter {
  /** Correction curve on the data grid (dB), before gain. */
  curveDb: Float64Array
  taps: Float32Array
  /** Loudness-matching gain (dB). */
  gainDb: number
}

export interface PreparedMatch {
  sides: SideFilter[]
  /** Shared gain: the song's Smart volume level, lowered only as far as keeps every side's measured peak under full scale (with no windows: every side's largest boost at or below 0 dB). */
  masterDb: number
}

/**
 * Build one loudness-matched filter per candidate so they can be A/B'd on a device
 * whose response is `reference` (the user's IEM, or the target for unknown/speakers).
 */
export function prepareMatch(params: {
  grid: ArrayLike<number>
  candidates: ArrayLike<number>[]
  reference: ArrayLike<number>
  options: CorrectionOptions | CorrectionOptions[]
  spectrum: Spectrum
  sampleRate: number
  taps?: number
  /**
   * The song's loudest windows (headroom.ts loudWindows). A filter that never boosts can still
   * raise sample peaks (it shifts phase), and with no limiter on this path a hot master would
   * clip into a buzz; with these the master also keeps each side's true peak under full scale.
   */
  windows?: Float32Array[][]
  /** The song's Smart volume gain (dB, audio/smartVolume.ts), shared by every side so fairness is untouched. */
  levelDb?: number
  /** Loudness-match the sides (default: the saved setting, see levelMatchOn). Off, the louder IEM stays louder. */
  levelMatch?: boolean
}): PreparedMatch {
  const { grid, candidates, reference, options, spectrum, sampleRate, taps, windows, levelDb = 0 } = params
  const matched = params.levelMatch ?? levelMatchOn()
  const curves = candidates.map((c, i) => {
    const opt = Array.isArray(options) ? options[i] : options
    return correctionCurve(grid, c, reference, opt)
  })
  const loudness = curves.map((c) => filteredLoudnessDb(spectrum, grid, c))
  const quietest = Math.min(...loudness)

  const sides = curves.map((curveDb, i) => ({
    curveDb,
    taps: designFir(grid, curveDb, sampleRate, taps),
    // unmatched, every side gets one shared gain (the loudest lands where matched sides would), so their own level gap stays
    gainDb: matched ? quietest - loudness[i] : quietest - Math.max(...loudness),
  }))
  // the same master for both sides, so A and B stay equally loud
  if (windows?.length) {
    // the measured peak is what can clip; the curve's largest boost is a worst case that on real
    // songs sat 2-12 dB above it, which on top of Smart volume left rounds that much too quiet
    const truePeak = Math.max(...sides.map((s) => firPeak(windows, s.taps) * 10 ** (s.gainDb / 20)))
    return { sides, masterDb: truePeak > 0 ? Math.min(levelDb, TRUE_PEAK_CEILING_DB - 20 * Math.log10(truePeak)) : levelDb }
  }
  // no song to measure: keep every side's largest boost at or below 0 dB
  const peak = Math.max(...sides.map((s) => Math.max(...s.curveDb) + s.gainDb))
  return { sides, masterDb: levelDb - Math.max(0, peak) }
}

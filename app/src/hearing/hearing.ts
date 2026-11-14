/**
 * A rough, relative hearing check (HEADPHONE_SIM_RESEARCH.md §3.6), for awareness only: nothing is
 * compensated, so every candidate still sounds as it should. Without a calibrated output level only
 * differences mean anything: high frequencies against 1 kHz, and left against right.
 *
 * Thresholds are in dB of the test tone's digital level; your device's own response at each frequency
 * is added (its FR is at the eardrum, like the reference thresholds below), then compared with the
 * typical eardrum threshold of young normal hearing relative to 1 kHz. Not a medical test.
 */
export type Ear = 'L' | 'R'
export const HEARING_FREQS = [1000, 4000, 8000] as const
export type HearingFreq = (typeof HEARING_FREQS)[number]

/** Typical eardrum thresholds relative to 1 kHz (ISO 389-7 free-field thresholds + free-field-to-eardrum gain, rounded). */
const NORMAL_REL_DB: Record<HearingFreq, number> = { 1000: 0, 4000: 2, 8000: 11 }
/** Beyond this much worse than typical (dB) the treble warning shows; this test can't resolve finer. */
export const HF_LOSS_WARN_DB = 15
export const LR_WARN_DB = 10

export interface HearingResult {
  testedAt: string
  /** Lowest level heard (dBFS) per ear and frequency; null = not heard even at the loudest step. */
  thresholds: Record<Ear, Record<HearingFreq, number | null>>
  /** How much worse than typical the 4–8 kHz thresholds are, relative to 1 kHz (dB, worse ear). */
  hfLossDb: number
  /** Largest left/right threshold difference (dB). */
  lrDiffDb: number
}

const KEY = 'hearing-v1'

export function loadHearing(): HearingResult | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

export function saveHearing(r: HearingResult | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** The loudest step the test plays (dBFS); a tone not heard there counts as this + 10 dB. */
export const LOUDEST_DB = -10

/**
 * Summarise thresholds. `deviceDb(f)` is your device's FR at `f` (dB, any level): a device quiet in
 * the treble needs more signal there, which isn't hearing loss.
 */
export function summarise(thresholds: HearingResult['thresholds'], deviceDb: (f: number) => number): HearingResult {
  const level = (ear: Ear, f: HearingFreq) => (thresholds[ear][f] ?? LOUDEST_DB + 10) + deviceDb(f)
  const loss = (ear: Ear) =>
    Math.max(...([4000, 8000] as const).map((f) => level(ear, f) - level(ear, 1000) - NORMAL_REL_DB[f]))
  const lr = Math.max(...HEARING_FREQS.map((f) => Math.abs((thresholds.L[f] ?? LOUDEST_DB + 10) - (thresholds.R[f] ?? LOUDEST_DB + 10))))
  return {
    testedAt: new Date().toISOString(),
    thresholds,
    hfLossDb: Math.round(Math.max(loss('L'), loss('R'))),
    lrDiffDb: Math.round(lr),
  }
}

/** One-line caveat for results, or null when nothing stands out. */
export function hearingNote(r: HearingResult | null): string | null {
  if (!r) return null
  const notes: string[] = []
  if (r.hfLossDb >= HF_LOSS_WARN_DB) {
    notes.push(`Your hearing check found quieter high frequencies (about ${r.hfLossDb} dB below typical), so treble differences are harder to hear and your picks lean on bass and mids.`)
  }
  if (r.lrDiffDb >= LR_WARN_DB) {
    notes.push(`Your ears differed by about ${r.lrDiffDb} dB in the hearing check; set the balance in Settings → Fit check.`)
  }
  return notes.length ? notes.join(' ') : null
}

/** Step of a method-of-limits run: louder by 10 dB until heard, then quieter by 5 dB until gone. */
export interface Staircase {
  level: number
  rising: boolean
  lastHeard: number | null
  done: boolean
}

export const START_DB = -50
const FLOOR_DB = -95

export function newStaircase(): Staircase {
  return { level: START_DB, rising: true, lastHeard: null, done: false }
}

export function stepStaircase(s: Staircase, heard: boolean): Staircase {
  if (s.rising) {
    if (heard) return { level: s.level - 5, rising: false, lastHeard: s.level, done: s.level - 5 < FLOOR_DB }
    return s.level + 10 > LOUDEST_DB ? { ...s, done: true } : { ...s, level: s.level + 10 }
  }
  if (heard) return { ...s, level: s.level - 5, lastHeard: s.level, done: s.level - 5 < FLOOR_DB }
  return { ...s, done: true }
}

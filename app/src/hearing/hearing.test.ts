import { describe, expect, it } from 'vitest'
import { hearingNote, newStaircase, stepStaircase, summarise, type HearingResult } from './hearing'

const flat = () => 0
const both = (t: HearingResult['thresholds']['L']) => ({ L: { ...t }, R: { ...t } })

describe('hearing check', () => {
  it('the staircase rises until heard, then falls until gone, keeping the last level heard', () => {
    let s = newStaircase() // −50
    s = stepStaircase(s, false) // −40
    s = stepStaircase(s, true) // heard at −40 → −45
    s = stepStaircase(s, true) // heard at −45 → −50
    s = stepStaircase(s, false)
    expect(s.done).toBe(true)
    expect(s.lastHeard).toBe(-45)
  })

  it('typical thresholds raise no note; a 20 dB treble drop does', () => {
    expect(hearingNote(summarise(both({ 1000: -70, 4000: -68, 8000: -59 }), flat))).toBeNull()
    expect(hearingNote(summarise(both({ 1000: -70, 4000: -68, 8000: -39 }), flat))).toMatch(/high frequencies/)
  })

  it('a device quiet in the treble is not read as hearing loss', () => {
    const quietTreble = (f: number) => (f >= 8000 ? -20 : 0)
    expect(summarise(both({ 1000: -70, 4000: -68, 8000: -39 }), quietTreble).hfLossDb).toBeLessThan(15)
  })

  it('flags a left/right difference', () => {
    const r = summarise({ L: { 1000: -70, 4000: -68, 8000: -59 }, R: { 1000: -55, 4000: -68, 8000: -59 } }, flat)
    expect(r.lrDiffDb).toBe(15)
    expect(hearingNote(r)).toMatch(/balance/)
  })
})

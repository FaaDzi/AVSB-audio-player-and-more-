import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { gearForRoute, gearName, isPhoneSpeaker, phoneSpeakerId } = await import('./phoneSpeaker')

describe('the phone speaker as a device (plan §86 G)', () => {
  it('takes over when the speaker plays, and hands back the earphones when they return', () => {
    const on = gearForRoute(true, 'ziigaat-odyssey', null, 'both')
    expect(on).toEqual({ active: 'phone-speaker-both', before: 'ziigaat-odyssey' })
    expect(gearForRoute(false, on!.active, on!.before, 'both')).toEqual({ active: 'ziigaat-odyssey', before: null })
  })
  it('changes nothing when it already fits', () => {
    expect(gearForRoute(true, phoneSpeakerId('top'), 'x', 'both')).toBeNull()
    expect(gearForRoute(false, 'ziigaat-odyssey', null, 'both')).toBeNull()
  })
  it('with no earphone chosen before, going back leaves no device', () => {
    expect(gearForRoute(false, phoneSpeakerId('bottom'), null, 'bottom')).toEqual({ active: null, before: null })
  })
  it('has a name of its own, since no catalog lists it', () => {
    expect(isPhoneSpeaker('phone-speaker-top')).toBe(true)
    expect(gearName('phone-speaker-top')).toBe('Phone speaker (top)')
    expect(gearName('moondrop-chu', 'Moondrop Chu')).toBe('Moondrop Chu')
  })
})

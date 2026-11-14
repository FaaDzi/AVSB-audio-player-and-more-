import { describe, it, expect } from 'vitest'
import { generateEqualizerApoConfig } from '../settings/SavedEqPage'
import type { SavedPreset } from '../eqState'

describe('Saved EQ & Export Engine', () => {
  it('generates compliant Equalizer APO config from parametric filters', () => {
    const preset: SavedPreset = {
      name: 'Harman Simulation 78%',
      mode: 'advanced+',
      count: 10,
      gains: [],
      filters: [
        { kind: 'lowshelf', fc: 105, gain: 4.5, q: 0.71 },
        { kind: 'peak', fc: 1250, gain: -2.3, q: 1.8 },
        { kind: 'highshelf', fc: 8000, gain: 3.1, q: 0.71 },
      ],
      preamp: -3.5,
      bass: 0,
      treble: 0,
    }

    const apo = generateEqualizerApoConfig(preset)
    expect(apo).toContain('Preamp: -3.5 dB')
    expect(apo).toContain('Filter 1: ON LSC Fc 105 Hz Gain +4.5 dB Q 0.71')
    expect(apo).toContain('Filter 2: ON PK Fc 1250 Hz Gain -2.3 dB Q 1.80')
    expect(apo).toContain('Filter 3: ON HSC Fc 8000 Hz Gain +3.1 dB Q 0.71')
  })

  it('generates compliant Equalizer APO config from graphic bands', () => {
    const preset: SavedPreset = {
      name: 'Vocal Boost',
      mode: 'advanced',
      count: 10,
      gains: [0, 0, 0, 1, 3, 4, 2, 0, 0, 0],
      filters: [],
      preamp: -2.0,
      bass: 0,
      treble: 0,
    }

    const apo = generateEqualizerApoConfig(preset)
    expect(apo).toContain('Preamp: -2.0 dB')
    expect(apo).toContain('Filter 1: ON PK Fc 250 Hz Gain +1.0 dB Q 1.41')
    expect(apo).toContain('Filter 2: ON PK Fc 500 Hz Gain +3.0 dB Q 1.41')
    expect(apo).toContain('Filter 3: ON PK Fc 1000 Hz Gain +4.0 dB Q 1.41')
  })
})


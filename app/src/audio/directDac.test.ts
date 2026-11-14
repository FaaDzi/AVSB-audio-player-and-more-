import { describe, expect, it } from 'vitest'
import { directBlocker, directQuality, type ChainState, type DirectInfo } from './directDac'

const plain: ChainState = { setting: true, eqOn: false, soundOn: false, spatialMode: 'off', automix: false, normalize: true, levelKnown: true }

describe('Direct to DAC hand-over (plan §77)', () => {
  it('goes direct when nothing changes the sound', () => {
    expect(directBlocker(plain)).toBeNull()
  })
  it('volume levelling is a plain gain, so it stays on', () => {
    expect(directBlocker({ ...plain, normalize: true, levelKnown: true })).toBeNull()
    expect(directBlocker({ ...plain, normalize: false, levelKnown: false })).toBeNull()
  })
  it('names what keeps a song on the web player', () => {
    expect(directBlocker({ ...plain, setting: false })).toBe('Direct off')
    expect(directBlocker({ ...plain, eqOn: true })).toBe('EQ on')
    expect(directBlocker({ ...plain, soundOn: true })).toBe('Sound on')
    expect(directBlocker({ ...plain, spatialMode: 'crossfeed' })).toBe('Spatial on')
    expect(directBlocker({ ...plain, automix: true })).toBe('AutoMix on')
  })
  it('a song with levelling on and no level yet is measured on the web player first', () => {
    expect(directBlocker({ ...plain, levelKnown: false })).toBe('Measuring')
  })
})

describe('Direct to DAC chip', () => {
  const info: DirectInfo = { path: 'x', rate: 96000, bits: 24, channels: 2, mime: 'audio/flac', duration: 200, dacRate: 96000, dacBits: 24 }
  it('shows the rate the DAC runs at', () => {
    expect(directQuality(info)).toEqual(['Direct to DAC', '24-bit', '96 kHz'])
    expect(directQuality({ ...info, rate: 44100, bits: 16, dacRate: 44100, dacBits: 16 })).toEqual(['Direct to DAC', '16-bit', '44.1 kHz'])
  })
  it('says so when the DAC does not take the rate', () => {
    expect(directQuality({ ...info, rate: 88200, dacRate: 0, dacBits: 0 })).toEqual(['Direct to DAC', '24-bit', '88.2 kHz converted'])
  })
})

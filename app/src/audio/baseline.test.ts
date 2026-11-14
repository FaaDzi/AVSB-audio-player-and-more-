import { describe, expect, it } from 'vitest'
import { baselineFr, frDb, medianFr, type Iem, type IemData } from './data'

const iem = (name: string, fr: number[]): Iem => ({
  id: name,
  name,
  source: 'x',
  sources: ['x'],
  fr,
  metrics: { subBass: 0, midBass: 0, lowerMids: 0, upperMids: 0, lowerTreble: 0, air: 0 },
})

// grid: 100 Hz, 500 Hz (the levelling band), 5 kHz; fr in tenths of a dB
const data: IemData = {
  grid: [100, 500, 5000],
  frScale: 0.1,
  target: { name: 't', fr: [0, 0, 0] },
  bands: {} as IemData['bands'],
  calibration: {},
  iems: [
    iem('Wired A', [100, 0, 0]),
    iem('Wired B', [140, 20, 20]), // same shape as A, 2 dB louder
    iem('Soundcore Liberty 4', [60, 0, -50]),
    iem('Galaxy Buds 3', [80, 0, -30]),
  ],
}

describe('Cannot find mine', () => {
  it('medianFr levels each curve first, so a louder copy does not shift the shape', () => {
    expect([...medianFr(data, data.iems.slice(0, 2))]).toEqual([11, 0, 0])
  })

  it('earbuds get the wireless models typical curve, headphones and "I don\'t know" the target', () => {
    const base = { mode: 'iem' as const, unlistedGear: true }
    expect([...baselineFr(data, { ...base, listeningOn: 'earbuds' })]).toEqual([7, 0, -4])
    expect([...baselineFr(data, { ...base, listeningOn: 'headphones' })]).toEqual([...frDb(data, data.target.fr)])
    expect([...baselineFr(data, { mode: 'iem', listeningOn: 'earbuds' })]).toEqual([...frDb(data, data.target.fr)])
  })
})

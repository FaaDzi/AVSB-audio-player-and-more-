import { describe, expect, it, vi } from 'vitest'
import { fft } from './fft'
import { correctionCurve, firResponseDb, IEM_OPTIONS, minPhaseFir, softCap, SPEAKER_OPTIONS } from './filter'
import { filteredLoudnessDb, kWeightPower, longTermSpectrum, loudnessMatchDb } from './loudness'
import { loudWindows } from './headroom'
import { prepareMatch } from './match'
import { GalleryPlayer } from './galleryPlayer'
import { ABPlayer } from './player'

const GRID = Array.from({ length: 241 }, (_, i) => 20 * 2 ** (i / 24))
const flat = (v = 0) => GRID.map(() => v)

describe('fft', () => {
  it('round-trips', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i * 0.1)
    const im = new Float64Array(64)
    const orig = re.slice()
    fft(re, im)
    fft(re, im, true)
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 9))
  })

  it('puts a pure tone in the right bin', () => {
    const n = 256
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 10 * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    expect(re[10]).toBeCloseTo(n / 2, 6)
    expect(Math.abs(re[11])).toBeLessThan(1e-9)
  })
})

describe('minPhaseFir', () => {
  it('follows the requested magnitude within 0.5 dB from 40 Hz to 16 kHz', () => {
    // bass shelf + presence dip + treble peak
    const curve = GRID.map((f) => 6 / (1 + (f / 120) ** 2) - 4 * Math.exp(-((Math.log2(f / 3000) / 0.4) ** 2)) + 3 * Math.exp(-((Math.log2(f / 9000) / 0.3) ** 2)))
    const taps = minPhaseFir(GRID, curve, 48000, 4096)
    const test = GRID.filter((f) => f >= 40 && f <= 16000)
    const got = firResponseDb(taps, 48000, test)
    test.forEach((f, i) => {
      const want = curve[GRID.indexOf(f)]
      expect(Math.abs(got[i] - want), `at ${f.toFixed(0)} Hz`).toBeLessThan(0.5)
    })
  })

  it('concentrates energy at the start (minimum phase)', () => {
    const curve = GRID.map((f) => (f < 200 ? 8 : 0))
    const taps = minPhaseFir(GRID, curve, 48000, 4096)
    const energy = (a: number, b: number) => taps.slice(a, b).reduce((s, v) => s + v * v, 0)
    expect(energy(0, 512) / energy(0, 4096)).toBeGreaterThan(0.95)
  })
})

describe('correctionCurve', () => {
  it('is candidate minus reference', () => {
    const c = correctionCurve(GRID, flat(3), flat(1), { ...IEM_OPTIONS, holdAir: false })
    c.forEach((v) => expect(v).toBeCloseTo(2, 9))
  })

  it('holds the correction back above 10 kHz: full below, half from 14 kHz', () => {
    const c = correctionCurve(GRID, flat(4), flat(0), { ...IEM_OPTIONS, holdAir: true })
    GRID.forEach((f, i) => {
      if (f <= 10000) expect(c[i]).toBeCloseTo(4, 9)
      else if (f >= 14000) expect(c[i]).toBeCloseTo(2, 9)
      else expect(c[i]).toBeGreaterThan(2)
    })
  })

  it('caps bass boost in speaker mode', () => {
    const c = correctionCurve(GRID, flat(20), flat(0), { ...SPEAKER_OPTIONS, holdAir: false })
    expect(c[0]).toBe(SPEAKER_OPTIONS.lowBoostDb)
    expect(c[GRID.length - 1]).toBe(SPEAKER_OPTIONS.maxBoostDb)
  })

  it('bends into the cap (soft knee) instead of a hard corner', () => {
    expect(softCap(5, 9)).toBe(5) // well under: untouched
    expect(softCap(9, 9)).toBeCloseTo(8.5) // at the cap: half the knee below
    expect(softCap(10, 9)).toBeLessThan(9)
    expect(softCap(11, 9)).toBe(9)
    // continuous across the knee edges
    expect(softCap(7.0001, 9)).toBeCloseTo(7, 3)
    expect(softCap(10.9999, 9)).toBeCloseTo(9, 3)
  })
})

describe('loudness', () => {
  it('K-weighting is about +4 dB at high frequencies and ~0 dB at 1 kHz', () => {
    expect(10 * Math.log10(kWeightPower(1000))).toBeCloseTo(0.7, 0)
    expect(10 * Math.log10(kWeightPower(10000))).toBeGreaterThan(3.5)
    expect(10 * Math.log10(kWeightPower(30))).toBeLessThan(-1)
  })

  it('a flat +6 dB filter is 6 dB louder', () => {
    const noise = Float32Array.from({ length: 48000 }, () => Math.random() * 2 - 1)
    const spec = longTermSpectrum([noise], 48000)
    const a = filteredLoudnessDb(spec, GRID, flat(0))
    const b = filteredLoudnessDb(spec, GRID, flat(6))
    expect(b - a).toBeCloseTo(6, 6)
  })

  it('prepareMatch makes the candidates equally loud with no positive peak', () => {
    const noise = Float32Array.from({ length: 48000 }, () => Math.random() * 2 - 1)
    const spec = longTermSpectrum([noise], 48000)
    const bassy = GRID.map((f) => (f < 200 ? 10 : 0))
    const m = prepareMatch({ grid: GRID, candidates: [bassy, flat(-2)], reference: flat(0), options: IEM_OPTIONS, spectrum: spec, sampleRate: 48000, taps: 1024 })
    const la = filteredLoudnessDb(spec, GRID, m.sides[0].curveDb, m.sides[0].gainDb)
    const lb = filteredLoudnessDb(spec, GRID, m.sides[1].curveDb, m.sides[1].gainDb)
    expect(la).toBeCloseTo(lb, 6)
    for (const s of m.sides) expect(Math.max(...s.curveDb) + s.gainDb + m.masterDb).toBeLessThanOrEqual(1e-9)
  })

  it('prepareMatch with levelMatch off keeps the candidates’ own loudness gap', () => {
    const noise = Float32Array.from({ length: 48000 }, () => Math.random() * 2 - 1)
    const spec = longTermSpectrum([noise], 48000)
    const m = prepareMatch({ grid: GRID, candidates: [flat(3), flat(0)], reference: flat(0), options: { ...IEM_OPTIONS, holdAir: false }, spectrum: spec, sampleRate: 48000, taps: 1024, levelMatch: false })
    const la = filteredLoudnessDb(spec, GRID, m.sides[0].curveDb, m.sides[0].gainDb)
    const lb = filteredLoudnessDb(spec, GRID, m.sides[1].curveDb, m.sides[1].gainDb)
    expect(la - lb).toBeCloseTo(3, 1)
    for (const s of m.sides) expect(Math.max(...s.curveDb) + s.gainDb + m.masterDb).toBeLessThanOrEqual(1e-9)
  })

  it('gallery EQ on a bass-heavy song: matched on the song, a treble-up curve plays as loud as no EQ', () => {
    // brown-ish noise: much more bass than the pink noise the default match assumes
    let y = 0
    const song = Float32Array.from({ length: 96000 }, () => (y = 0.98 * y + (Math.random() * 2 - 1) * 0.1))
    const spec = longTermSpectrum([song], 48000, 4096, 40)
    const bright = GRID.map((f) => (f < 300 ? -6 : 0))
    const off = filteredLoudnessDb(spec, GRID, flat(0))
    expect(filteredLoudnessDb(spec, GRID, bright, loudnessMatchDb(GRID, bright, spec)) - off).toBeCloseTo(0, 6)
    // the pink-noise default under-compensates here: this was the "every EQ is quieter" bug
    expect(filteredLoudnessDb(spec, GRID, bright, loudnessMatchDb(GRID, bright)) - off).toBeLessThan(-1)
  })

  it('prepareMatch with the song windows keeps a full-scale song under full scale', () => {
    const song = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000))
    const spec = longTermSpectrum([song], 48000)
    const base = { grid: GRID, candidates: [flat(0), flat(0)], reference: flat(0), options: IEM_OPTIONS, spectrum: spec, sampleRate: 48000, taps: 1024 }
    expect(prepareMatch(base).masterDb).toBeCloseTo(0, 6)
    expect(prepareMatch({ ...base, windows: loudWindows([song], 8) }).masterDb).toBeLessThanOrEqual(-0.95)
  })

  it('prepareMatch with the song windows keeps the Smart volume level when the song has headroom', () => {
    // a quiet 1 kHz tone: a +10 dB bass boost can't raise its peak, so the round must not be turned down for it
    // (the curve's worst-case boost used to come off as well: rounds played 2-12 dB under the target)
    const song = Float32Array.from({ length: 48000 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000))
    const spec = longTermSpectrum([song], 48000)
    const bassy = GRID.map((f) => (f < 200 ? 10 : 0))
    const base = { grid: GRID, candidates: [flat(0), bassy], reference: flat(0), options: IEM_OPTIONS, spectrum: spec, sampleRate: 48000, taps: 1024, levelDb: 3 }
    expect(prepareMatch(base).masterDb).toBeLessThan(-6) // no windows: the worst case still applies
    expect(prepareMatch({ ...base, windows: loudWindows([song], 8) }).masterDb).toBeCloseTo(3, 6)
  })

  it('longTermSpectrum with maxFrames reads only that many frames, spread over the buffer', () => {
    const noise = Float32Array.from({ length: 48000 * 10 }, () => Math.random() * 2 - 1)
    const full = longTermSpectrum([noise], 48000)
    const few = longTermSpectrum([noise], 48000, 4096, 50)
    const db = (s: typeof full) => filteredLoudnessDb(s, GRID, flat(0))
    expect(Math.abs(db(full) - db(few))).toBeLessThan(0.3)
  })
})

function mockAudioContext() {
  const scheduled: { node: string; param: string; method: string; args: unknown[] }[] = []

  const makeParam = (nodeName: string, paramName: string, initialVal = 1) => {
    let val = initialVal
    return {
      get value() { return val },
      set value(v: number) { val = v },
      setValueAtTime: (v: number, t: number) => {
        val = v
        scheduled.push({ node: nodeName, param: paramName, method: 'setValueAtTime', args: [v, t] })
      },
      linearRampToValueAtTime: (v: number, t: number) => {
        val = v
        scheduled.push({ node: nodeName, param: paramName, method: 'linearRampToValueAtTime', args: [v, t] })
      },
      setTargetAtTime: (v: number, t: number, tau: number) => {
        val = v
        scheduled.push({ node: nodeName, param: paramName, method: 'setTargetAtTime', args: [v, t, tau] })
      },
      cancelScheduledValues: (t: number) => {
        scheduled.push({ node: nodeName, param: paramName, method: 'cancelScheduledValues', args: [t] })
      },
    }
  }

  let nodeId = 0
  const makeNode = (type: string) => {
    const id = `${type}_${++nodeId}`
    const n: Record<string, unknown> = {
      id,
      gain: makeParam(id, 'gain'),
      threshold: makeParam(id, 'threshold', -1),
      knee: makeParam(id, 'knee', 2),
      ratio: makeParam(id, 'ratio', 20),
      attack: makeParam(id, 'attack', 0.005),
      release: makeParam(id, 'release', 0.25),
      frequency: makeParam(id, 'frequency', 1000),
      Q: makeParam(id, 'Q', 1),
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      connect: (target: unknown) => target,
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    }
    return n
  }

  const dest = makeNode('destination')
  const ctx: Record<string, unknown> = {
    currentTime: 1.0,
    sampleRate: 48000,
    destination: dest,
    resume: async () => {},
    createGain: () => makeNode('gain'),
    createConvolver: () => {
      const n = makeNode('convolver')
      n.normalize = false
      n.buffer = null
      return n
    },
    createDynamicsCompressor: () => makeNode('compressor'),
    createWaveShaper: () => makeNode('shaper'),
    createAnalyser: () => makeNode('analyser'),
    createChannelSplitter: () => makeNode('splitter'),
    createChannelMerger: () => makeNode('merger'),
    createBiquadFilter: () => makeNode('biquad'),
    createIIRFilter: () => makeNode('iir'),
    createDelay: () => {
      const n = makeNode('delay')
      n.delayTime = makeParam(n.id as string, 'delayTime', 0)
      return n
    },
    createBufferSource: () => makeNode('source'),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
      copyToChannel: () => {},
    }),
  }

  return { ctx, scheduled }
}

describe('click-free transitions in galleryPlayer & player', () => {
  it('GalleryPlayer crossfades the old EQ stage into the new one, then drops the old one', () => {
    vi.useFakeTimers()
    try {
      const { ctx, scheduled } = mockAudioContext()
      const gp = new GalleryPlayer(ctx as unknown as AudioContext)
      const buf = (ctx as unknown as AudioContext).createBuffer(2, 48000, 48000)
      gp.setBuffer(buf)
      gp.play()

      scheduled.length = 0
      const curve = GRID.map(() => 2)
      gp.setFir(minPhaseFir(GRID, curve, 48000, 1024), GRID, curve)
      // the new stage rises 0 → 1 and the old (Off) falls to 0 over the same 30 ms; the limiter fades in
      const ramps = scheduled.filter((s) => s.method === 'linearRampToValueAtTime')
      expect(ramps.filter((r) => r.args[0] === 1 && r.args[1] === 1.03).length).toBeGreaterThanOrEqual(2)
      expect(ramps.filter((r) => r.args[0] === 0 && r.args[1] === 1.03).length).toBeGreaterThanOrEqual(2)
      // nothing jumps: every gain that moved was ramped
      expect(scheduled.some((s) => s.method === 'setTargetAtTime' && s.param === 'gain' && s.args[0] === 0)).toBe(false)

      // back to Off: the convolver is disconnected only after the crossfade
      const conv = (gp as unknown as { stage: { disconnect: () => void }[] }).stage[0]
      const dropped = vi.fn()
      conv.disconnect = dropped
      gp.setFlat()
      expect(dropped).not.toHaveBeenCalled()
      vi.advanceTimersByTime(200)
      expect(dropped).toHaveBeenCalled()

      scheduled.length = 0
      gp.setVolume(0.8)
      const vol = scheduled.find((s) => s.method === 'linearRampToValueAtTime' && s.args[0] === 0.8)
      expect(vol).toBeDefined()
      scheduled.length = 0
      gp.setBalance(3)
      expect(scheduled.filter((s) => s.method === 'linearRampToValueAtTime').length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ABPlayer crossfades chains with scheduled linear ramps on select', () => {
    const { ctx } = mockAudioContext()
    const ab = new ABPlayer(ctx as unknown as AudioContext)

    const buf = (ctx as unknown as AudioContext).createBuffer(2, 48000, 48000)
    ab.setBuffer(buf as unknown as AudioBuffer)

    const spec = longTermSpectrum([new Float32Array(48000)], 48000)
    const m = prepareMatch({
      grid: GRID,
      candidates: [flat(2), flat(-2)],
      reference: flat(0),
      options: IEM_OPTIONS,
      spectrum: spec,
      sampleRate: 48000,
      taps: 1024,
    })
    ab.setMatch(m)
    ab.play()

    // Select chain 1
    ab.select(1)
    expect(ab.active).toBe(1)
  })
})

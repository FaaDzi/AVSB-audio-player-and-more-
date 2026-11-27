import upmixUrl from './upmix.worklet.ts?worker&url'
import { FRAME, UPMIX_OUTPUTS } from './upmixCore'
import type { Biquad } from '../eq/biquad'
import { powerOf } from './earCorrection'
import type { HrirSet, SpatialMode, SpatialStageApi } from './types'

/** Mode changes fade over this long, so toggling never clicks. */
const MODE_FADE_S = 0.04
/** Head-yaw moves crossfade between two convolver banks over this long; also the fastest update rate. */
const YAW_FADE_S = 0.05
/** Extra turn past half a ring step before the banks move (§107 B: hysteresis against head wobble). */
export const YAW_DEADBAND_DEG = 1
/** Largest move per crossfade: a fast head turn walks through the ring instead of skipping 10–20° at once. */
export const YAW_STEP_DEG = 10
/** The virtual speakers sit at ±this many degrees, like a usual stereo triangle. */
export const SPEAKER_DEG = 30
/** "360" mode (§104 D): where the upmix's sources sit, + = left: hard left … hard right, then ambience left/right
 * behind the sides. Wider than the ±30° speakers, so turning toward a side brings what's panned there in front. */
export const UP_AZ = [80, 40, 0, -40, -80, 115, -115] as const
/** "360" level against Off (each source carries both channels' energy; centre sounds come out ~3 dB under). */
const UP_LEVEL = 1.2
/** bs2b's default level: 700 Hz cut, 4.5 dB feed (the "default" preset, between Jan Meier's and Chu Moy's). */
const XF_CUT_HZ = 700
const XF_FEED_DB = 4.5
/** Extra delay on the crossfed path; with the low-pass's own ~0.23 ms group delay it lands near a 30° ITD. */
const XF_DELAY_S = 0.0001
const ROOM_RT60_S = 0.3
const ROOM_LEN_S = 0.32

// ---------- crossfeed (bs2b, Boris Mikhaylov's Bauer stereophonic-to-binaural, MIT) ----------

export interface Bs2bCoefficients {
  /** Crossfed (opposite-ear) one-pole low-pass: y = a0·x + b1·y[-1]. */
  lo: { a0: number; b1: number }
  /** Direct high-boost shelf: y = a0·x + a1·x[-1] + b1·y[-1]. */
  hi: { a0: number; a1: number; b1: number }
  /** Output gain so a mono signal keeps its level at DC. */
  gain: number
}

/** bs2b's filter design (bs2b.c `init`) for a sample rate, cut frequency and feed level. */
export function bs2bCoefficients(sampleRate: number, cutHz = XF_CUT_HZ, feedDb = XF_FEED_DB): Bs2bCoefficients {
  const gbLo = feedDb * (-5 / 6) - 3
  const gbHi = feedDb / 6 - 3
  const gLo = 10 ** (gbLo / 20)
  const gHi = 1 - 10 ** (gbHi / 20)
  const hiHz = cutHz * 2 ** ((gbLo - 20 * Math.log10(gHi)) / 12)
  const xLo = Math.exp((-2 * Math.PI * cutHz) / sampleRate)
  const xHi = Math.exp((-2 * Math.PI * hiHz) / sampleRate)
  return {
    lo: { a0: gLo * (1 - xLo), b1: xLo },
    hi: { a0: 1 - gHi * (1 - xHi), a1: -xHi, b1: xHi },
    gain: 1 / (1 - gHi + gLo),
  }
}

/** Complex response of a first-order IIR (feedforward b0 + b1 z⁻¹, feedback 1 − a1 z⁻¹) at `hz`. */
export function onePoleResponse(b0: number, b1: number, a1: number, hz: number, sampleRate: number): [number, number] {
  const w = (2 * Math.PI * hz) / sampleRate
  const nr = b0 + b1 * Math.cos(w)
  const ni = -b1 * Math.sin(w)
  const dr = 1 - a1 * Math.cos(w)
  const di = a1 * Math.sin(w)
  const d = dr * dr + di * di
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d]
}

/** bs2b's feed range (dB between the direct and crossfed path at low frequencies). */
const XF_FEED_RANGE = [1, 15] as const
/** Crossfeed cutoff range (Hz) the setting may pick. */
export const XF_CUT_RANGE = [400, 1400] as const

/**
 * CanOpener-style controls (plan §52.5) as bs2b settings. Amount scales the crossfed level
 * (100 % = bs2b's default 4.5 dB feed; 150 % is more, as CanOpener's "lifelike"); 0 = no crossfeed.
 * Angle is where the imagined speakers stand: the far ear hears them later (Woodworth's ITD for an
 * 8.75 cm head), so the crossfed path is delayed to match. Null = crossfeed off.
 */
export function crossfeedParams(amountPct: number, angleDeg: number, cutHz = XF_CUT_HZ): { feedDb: number; delayS: number } | null {
  if (!(amountPct > 0)) return null
  const feedDb = Math.min(XF_FEED_RANGE[1], Math.max(XF_FEED_RANGE[0], XF_FEED_DB - 24 * Math.log10(amountPct / 100)))
  const th = (Math.min(90, Math.max(0, angleDeg)) * Math.PI) / 180
  const itd = (0.0875 / 343) * (th + Math.sin(th))
  // the low-pass's own group delay at low frequencies (1/(2π·cut)) already counts toward the ITD
  return { feedDb, delayS: Math.max(0, itd - 1 / (2 * Math.PI * cutHz)) }
}

// ---------- level matching ----------

/** Third-octave centres from 63 Hz to 12.5 kHz: equal weight per band ≈ pink, like most music. */
export function matchBands(sampleRate: number): number[] {
  const out: number[] = []
  for (let k = -12; k <= 11; k++) {
    const f = 1000 * 2 ** (k / 3)
    if (f < sampleRate / 2.2) out.push(f)
  }
  return out
}

/** Complex response of an FIR at `hz`. */
export function firResponse(ir: ArrayLike<number>, hz: number, sampleRate: number): [number, number] {
  const w = (2 * Math.PI * hz) / sampleRate
  let re = 0
  let im = 0
  for (let n = 0; n < ir.length; n++) {
    re += ir[n] * Math.cos(w * n)
    im -= ir[n] * Math.sin(w * n)
  }
  return [re, im]
}

/**
 * Gain that brings a stereo-to-binaural network to the level of the dry signal. At each ear `a(f)` is
 * the path from the same-side channel and `b(f)` from the opposite one; music sits between a fully
 * correlated (centred, |a+b|²) and an uncorrelated (|a|²+|b|²) pair, so both count half. Dry is 1.
 */
export function levelMatchGain(ears: { a: (hz: number) => [number, number]; b: (hz: number) => [number, number] }[], bands: number[]): number {
  let p = 0
  for (const ear of ears) {
    for (const f of bands) {
      const [ar, ai] = ear.a(f)
      const [br, bi] = ear.b(f)
      p += 0.5 * ((ar + br) ** 2 + (ai + bi) ** 2) + 0.5 * (ar * ar + ai * ai + br * br + bi * bi)
    }
  }
  p /= ears.length * bands.length
  return p > 0 ? 1 / Math.sqrt(p) : 1
}

export function crossfeedMatchGain(sampleRate: number, cutHz = XF_CUT_HZ, feedDb = XF_FEED_DB): number {
  const c = bs2bCoefficients(sampleRate, cutHz, feedDb)
  const g = c.gain
  const scale = ([re, im]: [number, number]): [number, number] => [re * g, im * g]
  const ear = {
    a: (f: number) => scale(onePoleResponse(c.hi.a0, c.hi.a1, c.hi.b1, f, sampleRate)),
    b: (f: number) => scale(onePoleResponse(c.lo.a0, 0, c.lo.b1, f, sampleRate)),
  }
  return levelMatchGain([ear, ear], matchBands(sampleRate))
}

// ---------- HRIR ring ----------

/** An angle folded into -180…180. */
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

/** The ring step to aim at for a head yaw: stays on `aimed` until the head is half a step plus the deadband away. */
export function aimYaw(aimed: number, deg: number, step: number): number {
  return Math.abs(wrapDeg(deg - aimed)) <= step / 2 + YAW_DEADBAND_DEG ? aimed : Math.round(deg / step) * step
}

/** One crossfade's move from `shown` toward `target` (the short way round), at most YAW_STEP_DEG. */
export function nextYaw(shown: number, target: number): number {
  const d = ((((target - shown + 180) % 360) + 360) % 360) - 180
  return Math.abs(d) <= YAW_STEP_DEG ? target : shown + Math.sign(d) * YAW_STEP_DEG
}

/** Ring index for a source at `azDeg` (counter-clockwise, 90 = left), rounded to the nearest measured one. */
export function ringIndex(azDeg: number, stepDeg: number, count: number): number {
  const a = ((azDeg % 360) + 360) % 360
  return Math.round(a / stepDeg) % count
}

/** Ring indices of the left and right virtual speakers when the head is turned `yawDeg` to the left. */
export function speakerIndices(yawDeg: number, stepDeg: number, count: number): [number, number] {
  return [ringIndex(SPEAKER_DEG - yawDeg, stepDeg, count), ringIndex(-SPEAKER_DEG - yawDeg, stepDeg, count)]
}

/** Band-limited (Hann-windowed sinc) resampling, for an HRIR set measured at another rate. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const ratio = from / to
  const n = Math.max(1, Math.round((x.length * to) / from))
  const fc = Math.min(1, to / from)
  const half = Math.ceil(16 / fc)
  const out = new Float32Array(n)
  for (let m = 0; m < n; m++) {
    const t = m * ratio
    let s = 0
    for (let k = Math.max(0, Math.ceil(t - half)); k <= Math.min(x.length - 1, Math.floor(t + half)); k++) {
      const d = t - k
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d)
      s += x[k] * fc * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / half))
    }
    out[m] = s
  }
  return out
}

/** The set at the context's sample rate. */
export function resampleSet(set: HrirSet, sampleRate: number): HrirSet {
  if (set.sampleRate === sampleRate) return set
  return {
    ...set,
    sampleRate,
    ring: set.ring.map((p) => ({ left: resample(p.left, set.sampleRate, sampleRate), right: resample(p.right, set.sampleRate, sampleRate) })),
  }
}

// ---------- small synthetic room ----------

/** Seeded PRNG (mulberry32), so the room sounds the same every time. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Early reflections for the left speaker (delay after the direct sound, direction, level); the right one is mirrored. */
const REFLECTIONS: { ms: number; az: number; gain: number }[] = [
  { ms: 2.6, az: 30, gain: 0.5 }, // floor (same direction, from below)
  { ms: 4.8, az: 75, gain: 0.42 }, // near side wall
  { ms: 6.9, az: 30, gain: 0.32 }, // ceiling
  { ms: 8.7, az: -55, gain: 0.3 }, // far side wall
  { ms: 12.4, az: 150, gain: 0.24 }, // back wall
  { ms: 15.1, az: 115, gain: 0.2 },
  { ms: 18.3, az: -125, gain: 0.16 },
]

/**
 * A small, damped room for one virtual speaker (left when `side` is 0): a few early reflections, each
 * from its own direction through the HRIR ring and a little duller than the last, then a short
 * decorrelated noise tail decaying to −60 dB in ROOM_RT60_S. The direct sound itself is not included.
 */
export function roomResponse(set: HrirSet, side: 0 | 1): { left: Float32Array; right: Float32Array } {
  const fs = set.sampleRate
  const len = Math.round(ROOM_LEN_S * fs)
  const out = { left: new Float32Array(len), right: new Float32Array(len) }
  const n = set.ring.length
  const sign = side === 0 ? 1 : -1
  const direct = set.ring[ringIndex(sign * SPEAKER_DEG, set.stepDeg, n)]
  let directE = 0
  for (const ch of [direct.left, direct.right]) for (const v of ch) directE += v * v
  REFLECTIONS.forEach((r, i) => {
    const h = set.ring[ringIndex(sign * r.az, set.stepDeg, n)]
    const at = Math.round((r.ms / 1000) * fs)
    // walls soak up highs: a one-pole low-pass that closes a little more with every bounce
    const k = Math.exp((-2 * Math.PI * (9000 / (1 + i * 0.5))) / fs)
    for (const [src, dst] of [[h.left, out.left], [h.right, out.right]] as const) {
      let y = 0
      for (let j = 0; j < src.length && at + j < len; j++) {
        y = (1 - k) * src[j] + k * y
        dst[at + j] += r.gain * y
      }
    }
  })
  // tail: from ~20 ms, decorrelated per ear and per speaker, at about −8 dB below the direct sound
  const start = Math.round(0.02 * fs)
  const rand = rng(side === 0 ? 0x5eed1 : 0x5eed2)
  const tail = [new Float32Array(len), new Float32Array(len)]
  let tailE = 0
  for (const t of tail) {
    let y = 0
    const k = Math.exp((-2 * Math.PI * 5000) / fs)
    for (let j = start; j < len; j++) {
      const age = (j - start) / fs
      const env = Math.exp((-6.91 * age) / ROOM_RT60_S) * Math.min(1, age / 0.005) * Math.min(1, (len - j) / (0.01 * fs))
      y = (1 - k) * (rand() * 2 - 1) + k * y
      t[j] = y * env
      tailE += t[j] * t[j]
    }
  }
  const g = tailE > 0 ? Math.sqrt((directE * 10 ** (-8 / 10)) / tailE) : 0
  for (let j = start; j < len; j++) {
    out.left[j] += g * tail[0][j]
    out.right[j] += g * tail[1][j]
  }
  return out
}

/** Level-match gains for the speakers alone and for speakers + room (head straight ahead). */
export function speakerMatchGains(
  set: HrirSet,
  rooms?: [{ left: Float32Array; right: Float32Array }, { left: Float32Array; right: Float32Array }],
  /** |H(f)|² of the ear-gain correction in front of the virtual path (earCorrection.ts), if any. */
  power?: (hz: number) => number,
) {
  const fs = set.sampleRate
  const bands = matchBands(fs)
  const [iL, iR] = speakerIndices(0, set.stepDeg, set.ring.length)
  const L = set.ring[iL]
  const R = set.ring[iR]
  const fir = (ir: Float32Array) => (f: number): [number, number] => {
    const [re, im] = firResponse(ir, f, fs)
    const k = power ? Math.sqrt(power(f)) : 1
    return [re * k, im * k]
  }
  const speakers = levelMatchGain([{ a: fir(L.left), b: fir(R.left) }, { a: fir(R.right), b: fir(L.right) }], bands)
  if (!rooms) return { speakers, room: speakers }
  const plus = (x: Float32Array, y: Float32Array) => {
    const out = new Float32Array(Math.max(x.length, y.length))
    out.set(y)
    for (let i = 0; i < x.length; i++) out[i] += x[i]
    return out
  }
  const room = levelMatchGain(
    [
      { a: fir(plus(L.left, rooms[0].left)), b: fir(plus(R.left, rooms[1].left)) },
      { a: fir(plus(R.right, rooms[1].right)), b: fir(plus(L.right, rooms[0].right)) },
    ],
    bands,
  )
  return { speakers, room }
}

// ---------- the stage ----------

interface UpBank {
  conv: ConvolverNode[]
  gain: GainNode
  idx: number[] | null
  wired: boolean
  /** Unplugs this bank once its fade-out is over (its own timer, so the next move doesn't cancel it). */
  idle?: ReturnType<typeof setTimeout>
}

interface Bank {
  conv: [ConvolverNode, ConvolverNode]
  gain: GainNode
  idx: [number, number] | null
  /** Fed from the input split; only while it sounds, since an idle convolver still costs its full CPU. */
  wired: boolean
  idle?: ReturnType<typeof setTimeout>
}

/**
 * The spatial stage both players insert before their L/R balance (see types.ts).
 *
 * §107 A: every path but 360 goes through `align` first, a delay as long as the 360 splitter's (FRAME), so
 * switching to or from 360 doesn't jump in time.
 *
 * input ─┬─ dry ─────────────────────────────────────────────────────────────┬─ output
 *        ├─ split ─ bs2b: direct high-boost + delayed low-passed opposite ─ xf ─┤
 *        └─ split ─┬─ bank A: L conv, R conv ─ gain A ─┐                        │
 *                  ├─ bank B: L conv, R conv ─ gain B ─┼─ virtual ──────────────┘
 *                  └─ room:   L conv, R conv ─ send ───┘
 *
 * Each convolver turns one input channel into a stereo pair at the ears (a speaker's HRIR pair).
 * Head yaw loads the new pair into the idle bank and crossfades to it. Off is the dry wire alone:
 * the other paths fade out and are then disconnected, so they cost nothing. The same goes inside
 * the virtual path: the bank faded out and the room (outside room mode) are unplugged, since every
 * fed convolver runs at full cost even at zero gain, and on a phone that overran the audio thread
 * into crackles.
 */
export class SpatialStage implements SpatialStageApi {
  readonly input: GainNode
  readonly output: GainNode
  private ctx: BaseAudioContext
  private _mode: SpatialMode = 'off'
  private dry: GainNode
  /** The 360 splitter's latency, in front of dry, crossfeed and the virtual speakers (§107 A). */
  private align: DelayNode
  private xfSplit: ChannelSplitterNode
  private xf: GainNode
  private xfGain: number
  private vSplit: ChannelSplitterNode
  /** The virtual path's way in: the ear-gain correction filters (earCorrection.ts), then vSplit. */
  private vIn: GainNode
  private corr: BiquadFilterNode[] = []
  private power: ((hz: number) => number) | undefined
  private rooms: [{ left: Float32Array; right: Float32Array }, { left: Float32Array; right: Float32Array }] | undefined
  private banks: [Bank, Bank]
  private active = 0
  private room: [ConvolverNode, ConvolverNode]
  private roomWired = false
  private roomSend: GainNode
  private virtual: GainNode
  private set: HrirSet | null = null
  private buffers = new Map<number, AudioBuffer>()
  private gains = { speakers: 1, room: 1 }
  private xfOn = false
  private xfNodes: AudioNode[] = []
  private xfKey = 'default'
  /** False when the crossfeed amount is 0 %: crossfeed mode then plays the dry signal. */
  private xfAmountOn = true
  private xfCutHz = XF_CUT_HZ
  private vOn = false
  private offTimer: ReturnType<typeof setTimeout> | undefined
  private yaw = 0
  /** The yaw the banks are aimed at: walks toward `yaw` by at most YAW_STEP_DEG per crossfade (§104: no jumps). */
  private shownYaw = 0
  private yawTimer: ReturnType<typeof setTimeout> | undefined
  private fadeEnd = 0
  /** "360" mode: the pan-split worklet, its channel split and two banks of one convolver per source. */
  private up: { node: AudioWorkletNode; split: ChannelSplitterNode; banks: [UpBank, UpBank]; active: number; out: GainNode } | null = null
  private upLoading = false
  private upOn = false
  private upModuleP: Promise<boolean> | null = null
  /** §112 A: loaded only once 360 is wanted: with a worklet loaded, Chrome renders the whole graph on the worklet's
   * thread, which dropped audio in every mode (the §109 load-at-start). */
  private get upModule(): Promise<boolean> {
    return (this.upModuleP ??= this.ctx.audioWorklet?.addModule(upmixUrl).then(() => true, () => false) ?? Promise.resolve(false))
  }

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    const stereo = (n: AudioNode) => {
      n.channelCount = 2
      n.channelCountMode = 'explicit'
      n.channelInterpretation = 'speakers'
      return n
    }
    this.input = stereo(ctx.createGain()) as GainNode
    this.output = stereo(ctx.createGain()) as GainNode
    this.dry = ctx.createGain()
    this.align = ctx.createDelay(0.1)
    this.align.delayTime.value = FRAME / ctx.sampleRate
    this.input.connect(this.align).connect(this.dry).connect(this.output)

    this.xfSplit = ctx.createChannelSplitter(2)
    this.xf = ctx.createGain()
    this.xf.gain.value = 0
    this.xf.connect(this.output)
    this.xfGain = this.buildCrossfeed(XF_FEED_DB, XF_DELAY_S)

    this.vSplit = ctx.createChannelSplitter(2)
    this.vIn = stereo(ctx.createGain()) as GainNode
    this.vIn.connect(this.vSplit)
    this.virtual = stereo(ctx.createGain()) as GainNode
    this.virtual.gain.value = 0
    const mono = () => {
      const conv = ctx.createConvolver()
      conv.normalize = false
      conv.channelCount = 1
      conv.channelCountMode = 'explicit'
      return conv
    }
    const bank = (on: number): Bank => {
      const b: Bank = { conv: [mono(), mono()], gain: ctx.createGain(), idx: null, wired: false }
      b.gain.gain.value = on
      b.conv.forEach((cv) => cv.connect(b.gain))
      b.gain.connect(this.virtual)
      return b
    }
    this.banks = [bank(1), bank(0)]
    this.room = [mono(), mono()]
    this.roomSend = ctx.createGain()
    this.roomSend.gain.value = 0
    this.room.forEach((cv) => cv.connect(this.roomSend))
    this.roomSend.connect(this.virtual)
    this.virtual.connect(this.output)
  }

  get mode() {
    return this._mode
  }

  /** bs2b's network between xfSplit and xf for a feed level and crossfed delay; returns its output gain. */
  private buildCrossfeed(feedDb: number, delayS: number): number {
    const ctx = this.ctx
    const fs = ctx.sampleRate
    const c = bs2bCoefficients(fs, this.xfCutHz, feedDb)
    this.xfSplit.disconnect()
    for (const n of this.xfNodes) n.disconnect()
    const merge = ctx.createChannelMerger(2)
    this.xfNodes = [merge]
    for (const ch of [0, 1]) {
      // IIR coefficients can't change once made, so a new setting builds a new network
      const hi = ctx.createIIRFilter([c.hi.a0, c.hi.a1], [1, -c.hi.b1])
      const lo = ctx.createIIRFilter([c.lo.a0], [1, -c.lo.b1])
      const delay = ctx.createDelay(0.01)
      delay.delayTime.value = delayS
      this.xfSplit.connect(hi, ch).connect(merge, 0, ch)
      this.xfSplit.connect(lo, ch).connect(delay).connect(merge, 0, 1 - ch)
      this.xfNodes.push(hi, lo, delay)
    }
    merge.connect(this.xf)
    return c.gain * crossfeedMatchGain(fs, this.xfCutHz, feedDb)
  }

  /** Crossfeed amount (%) and speaker angle (°), CanOpener style; 0 % plays dry in crossfeed mode. */
  setCrossfeed(amountPct: number, angleDeg: number, cutHz = XF_CUT_HZ) {
    const p = crossfeedParams(amountPct, angleDeg, cutHz)
    const key = p ? `${p.feedDb.toFixed(2)}/${p.delayS.toFixed(6)}/${cutHz}` : 'off'
    this.xfCutHz = cutHz
    if (key === this.xfKey) return
    this.xfKey = key
    this.xfAmountOn = !!p
    if (p) this.xfGain = this.buildCrossfeed(p.feedDb, p.delayS)
    this.apply()
  }

  setMode(mode: SpatialMode) {
    this._mode = mode
    this.apply()
  }

  setHrir(set: HrirSet) {
    const s = resampleSet(set, this.ctx.sampleRate)
    this.set = s
    this.buffers.clear()
    const rooms = [roomResponse(s, 0), roomResponse(s, 1)] as const
    rooms.forEach((r, i) => (this.room[i].buffer = this.stereoBuffer(r.left, r.right)))
    this.rooms = [rooms[0], rooms[1]]
    this.gains = speakerMatchGains(s, this.rooms, this.power)
    // forget what the banks hold, so the next yaw update crossfades to the new set's pair
    for (const b of this.banks) b.idx = null
    for (const b of this.up?.banks ?? []) b.idx = null
    this.apply()
  }

  /**
   * The ear-gain correction in front of the virtual speakers (earCorrection.ts); [] takes it out.
   * Counted in the level match, so Speakers/Room stay as loud as Off.
   */
  setEarCorrection(filters: Biquad[]) {
    this.vIn.disconnect()
    for (const b of this.corr) b.disconnect()
    this.corr = filters.map((f) => {
      const b = this.ctx.createBiquadFilter()
      b.type = f.kind === 'peak' ? 'peaking' : f.kind
      b.frequency.value = f.fc
      b.Q.value = f.q
      b.gain.value = f.gain
      return b
    })
    let last: AudioNode = this.vIn
    for (const b of this.corr) last = last.connect(b)
    last.connect(this.vSplit)
    this.power = filters.length ? powerOf(filters, this.ctx.sampleRate) : undefined
    if (this.set) this.gains = speakerMatchGains(this.set, this.rooms, this.power)
    this.apply()
  }

  setHeadYaw(deg: number) {
    if (!Number.isFinite(deg)) return
    // §107 B: aim at whole ring steps, and only move once the head is a step's half plus 1° away, so a little
    // wobble around a step's edge doesn't keep a second bank of convolvers crossfading
    const aim = aimYaw(this.yaw, deg, this.set?.stepDeg ?? 5)
    if (aim === this.yaw) return
    this.yaw = aim
    this.scheduleYaw()
  }

  /** Fade every path to what the mode wants; connect paths before they fade in, disconnect after they fade out. */
  private apply() {
    const m = this._mode
    const virtualOk = !!this.set && (m === 'speakers' || m === 'room')
    const xfOn = m === 'crossfeed' && this.xfAmountOn
    // "360" plays dry until its worklet has loaded
    if (m === '360' && !this.up) this.loadUpmix()
    const upOk = !!this.set && m === '360' && !!this.up
    const dryOn = !xfOn && !virtualOk && !upOk
    if (upOk && !this.upOn) {
      this.up!.node.port.postMessage('reset')
      this.input.connect(this.up!.node)
      this.upOn = true
      this.scheduleYaw()
    }
    if (this.up) this.ramp(this.up.out.gain, upOk ? this.gains.speakers * UP_LEVEL : 0)
    if (xfOn && !this.xfOn) this.align.connect(this.xfSplit)
    if (virtualOk && !this.vOn) this.align.connect(this.vIn)
    this.xfOn ||= xfOn
    this.vOn ||= virtualOk
    if (virtualOk) this.scheduleYaw()
    if (m === 'room') this.wireRoom(true)
    this.ramp(this.dry.gain, dryOn ? 1 : 0)
    this.ramp(this.xf.gain, xfOn ? this.xfGain : 0)
    this.ramp(this.virtual.gain, virtualOk ? (m === 'room' ? this.gains.room : this.gains.speakers) : 0)
    this.ramp(this.roomSend.gain, m === 'room' ? 1 : 0)
    clearTimeout(this.offTimer)
    this.offTimer = setTimeout(() => {
      if (this.xfOn && !(this._mode === 'crossfeed' && this.xfAmountOn)) {
        this.align.disconnect(this.xfSplit)
        this.xfOn = false
      }
      if (this.vOn && !(this.set && (this._mode === 'speakers' || this._mode === 'room'))) {
        this.align.disconnect(this.vIn)
        this.vOn = false
      }
      if (this._mode !== 'room') this.wireRoom(false)
      if (this.upOn && !(this.set && this._mode === '360')) {
        this.input.disconnect(this.up!.node)
        this.up!.banks.forEach((b) => this.wireUp(b, false))
        this.upOn = false
      }
    }, MODE_FADE_S * 1000 + 60)
  }

  private ramp(p: AudioParam, to: number) {
    const t = this.ctx.currentTime
    p.cancelScheduledValues(t)
    p.setValueAtTime(p.value, t)
    p.linearRampToValueAtTime(to, t + MODE_FADE_S)
  }

  /** Moves the aimed yaw one step toward the head; schedules the next step while it isn't there yet. */
  private stepYaw(): number {
    this.shownYaw = nextYaw(this.shownYaw, this.yaw)
    if (this.shownYaw !== this.yaw) queueMicrotask(() => this.scheduleYaw())
    return this.shownYaw
  }

  /** Apply the latest yaw now, or as soon as the running crossfade has finished. */
  private scheduleYaw() {
    if (this.yawTimer !== undefined) return
    const wait = Math.max(0, this.fadeEnd - performance.now())
    this.yawTimer = setTimeout(() => {
      this.yawTimer = undefined
      this.applyYaw()
    }, wait)
  }

  private applyYaw() {
    // the mode, not upOn: upOn stays set through the fade out of 360, and Speakers' banks would never load (audit H1)
    if (this.upOn && this._mode === '360') return this.applyUpYaw()
    const s = this.set
    if (!s || !this.vOn) return
    const idx = speakerIndices(this.stepYaw(), s.stepDeg, s.ring.length)
    const cur = this.banks[this.active]
    if (cur.idx && cur.idx[0] === idx[0] && cur.idx[1] === idx[1]) return
    const next = this.banks[1 - this.active]
    next.idx = this.load(next, idx)
    this.wire(next, true)
    const t = this.ctx.currentTime
    for (const [b, to] of [[cur, 0], [next, 1]] as const) {
      b.gain.gain.cancelScheduledValues(t)
      b.gain.gain.setValueAtTime(b.gain.gain.value, t)
      b.gain.gain.linearRampToValueAtTime(to, t + YAW_FADE_S)
    }
    this.active = 1 - this.active
    this.fadeEnd = performance.now() + YAW_FADE_S * 1000
    // unplug the faded-out bank once it's silent (unless it's been brought back meanwhile)
    clearTimeout(cur.idle)
    cur.idle = setTimeout(() => {
      if (this.banks[this.active] !== cur) this.wire(cur, false)
    }, YAW_FADE_S * 1000 + 30)
  }

  private wire(b: Bank, on: boolean) {
    if (b.wired === on) return
    b.conv.forEach((cv, ch) => (on ? this.vSplit.connect(cv, ch) : this.vSplit.disconnect(cv, ch)))
    b.wired = on
  }

  private wireRoom(on: boolean) {
    if (this.roomWired === on) return
    this.room.forEach((cv, ch) => (on ? this.vSplit.connect(cv, ch) : this.vSplit.disconnect(cv, ch)))
    this.roomWired = on
  }

  private load(b: Bank, idx: [number, number]): [number, number] {
    b.conv[0].buffer = this.ringBuffer(idx[0])
    b.conv[1].buffer = this.ringBuffer(idx[1])
    return idx
  }

  private ringBuffer(i: number): AudioBuffer {
    let buf = this.buffers.get(i)
    if (!buf) {
      const p = this.set!.ring[i]
      buf = this.stereoBuffer(p.left, p.right)
      this.buffers.set(i, buf)
    }
    return buf
  }

  /** Loads the pan-split worklet once, builds the "360" graph, then re-applies the mode. */
  private loadUpmix() {
    if (this.upLoading || this.up) return
    this.upLoading = true
    const ctx = this.ctx
    void this.upModule.then((ok) => {
      if (!ok) {
        // no worklet (an old WebView): 360 falls back to the two virtual speakers
        this.upLoading = false
        if (this._mode === '360') this.setMode('speakers')
        return
      }
      const node = new AudioWorkletNode(ctx, 'avsb-upmix', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [UPMIX_OUTPUTS],
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      })
      const split = ctx.createChannelSplitter(UPMIX_OUTPUTS)
      node.connect(split)
      const out = ctx.createGain()
      out.gain.value = 0
      out.connect(this.output)
      const bank = (on: number): UpBank => {
        const b: UpBank = { conv: [], gain: ctx.createGain(), idx: null, wired: false }
        b.gain.gain.value = on
        for (let k = 0; k < UPMIX_OUTPUTS; k++) {
          const cv = ctx.createConvolver()
          cv.normalize = false
          cv.channelCount = 1
          cv.channelCountMode = 'explicit'
          cv.connect(b.gain)
          b.conv.push(cv)
        }
        b.gain.connect(out)
        return b
      }
      this.up = { node, split, banks: [bank(1), bank(0)], active: 0, out }
      this.apply()
    })
  }

  private wireUp(b: UpBank, on: boolean) {
    if (!this.up || b.wired === on) return
    b.conv.forEach((cv, k) => (on ? this.up!.split.connect(cv, k) : this.up!.split.disconnect(cv, k)))
    b.wired = on
  }

  /** "360": aims every source at its place around the head, turned against the head's yaw; crossfades banks. */
  private applyUpYaw() {
    const s = this.set
    const up = this.up
    if (!s || !up) return
    const shown = this.stepYaw()
    const idx = UP_AZ.map((az) => ringIndex(az - shown, s.stepDeg, s.ring.length))
    const cur = up.banks[up.active]
    if (cur.idx && cur.idx.every((v, k) => v === idx[k])) {
      this.wireUp(cur, true)
      return
    }
    const next = up.banks[1 - up.active]
    // §120: loading all 7 impulse responses at once is one big spike (each ConvolverNode sets up its FFT on the spot):
    // the music stumbled when 360 came on. They go in one per task; the bank fades in once all are there, and a yaw
    // that arrives meanwhile is picked up after.
    if (this.upLoadingBank) return
    this.upLoadingBank = true
    let k = 0
    const load = () => {
      if (!this.up || this.up !== up) { this.upLoadingBank = false; return }
      next.conv[k].buffer = this.ringBuffer(idx[k])
      if (++k < next.conv.length) { setTimeout(load, 0); return }
      this.upLoadingBank = false
      next.idx = idx
      this.swapUpBank(up, cur, next)
      if (this.yaw !== this.shownYaw) this.scheduleYaw()
    }
    load()
  }

  private upLoadingBank = false

  private swapUpBank(up: NonNullable<typeof this.up>, cur: UpBank, next: UpBank) {
    this.wireUp(next, true)
    const t = this.ctx.currentTime
    for (const [b, to] of [[cur, 0], [next, 1]] as const) {
      b.gain.gain.cancelScheduledValues(t)
      b.gain.gain.setValueAtTime(b.gain.gain.value, t)
      b.gain.gain.linearRampToValueAtTime(to, t + YAW_FADE_S)
    }
    up.active = 1 - up.active
    this.fadeEnd = performance.now() + YAW_FADE_S * 1000
    clearTimeout(cur.idle)
    cur.idle = setTimeout(() => {
      if (this.up && this.up.banks[this.up.active] !== cur) this.wireUp(cur, false)
    }, YAW_FADE_S * 1000 + 30)
  }

  private stereoBuffer(l: Float32Array, r: Float32Array): AudioBuffer {
    const buf = this.ctx.createBuffer(2, Math.max(l.length, r.length), this.ctx.sampleRate)
    buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
    return buf
  }
}

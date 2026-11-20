import { notePlayback, registerAudioContext } from '../platform'
import { headroomDb, loudWindows, peakingPeak, rawPeak } from './headroom'
import { firPeakAsync } from './headroomAsync'
import { longTermSpectrum, loudnessMatchDb, type Spectrum } from './loudness'
import { measureLoudness, songGainDb } from './smartVolume'
import { followSpatialSettings } from '../spatial/settings'
import { SpatialStage } from '../spatial/stage'
import { speakerOut } from './speakerGuard'
import { createBackSpace } from './backSpace'

/** One step of the colouring stage: a node, or a small network with its own way in and out (the open-back space). */
type StageLink = AudioNode | { input: AudioNode; output: AudioNode }

const dbToGain = (db: number) => 10 ** (db / 20)

/**
 * Gain Chromium's DynamicsCompressorNode adds below its threshold with the settings below
 * (the spec's automatic makeup gain). Measured in an OfflineAudioContext: the limiter path is
 * otherwise bit-transparent, so taking this off keeps an EQ exactly as loud as Off.
 */
const LIMITER_MAKEUP_DB = 0.28

/**
 * A hard ceiling after the limiter, which lets fast peaks through when it's pushed hard. Exactly straight below
 * -1.5 dBFS, so it changes nothing there, then bends over to meet -0.5 dBFS. Takes up to +6 dBFS in.
 */
export function ceilingCurve(points = 8193): Float32Array<ArrayBuffer> {
  const knee = 10 ** (-1.5 / 20)
  const limit = 10 ** (-0.5 / 20)
  return Float32Array.from({ length: points }, (_, i) => {
    const input = ((i / (points - 1)) * 2 - 1) * 2
    const size = Math.abs(input)
    const out = size <= knee ? size : knee + (limit - knee) * Math.tanh((size - knee) / (limit - knee))
    return (Math.sign(input) * out) / 2
  })
}

const FAIR_OFF_KEY = 'fair-off-v1'

/** "Off at the same level": Off plays as loud as the last EQ could on the song (default on). */
export function fairOffOn(): boolean {
  try {
    return localStorage.getItem(FAIR_OFF_KEY) !== '0'
  } catch {
    return true
  }
}

export function setFairOffOn(on: boolean) {
  try {
    localStorage.setItem(FAIR_OFF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** How long before a song's end the next one is asked for (s), so it's decoded in time. */
const NEAR_END_S = 45

/** Custom graphic EQ bands (Hz), ISO octave centres. */
export const CUSTOM_EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const CUSTOM_EQ_Q = 1.41
/** A skip fades the old song out over this long (s). */
const SKIP_FADE_S = 0.08
/** A song started cold is measured this long after it starts (ms), once its first audio is out. */
const ANALYSE_AFTER_MS = 120
/** EQ switches crossfade old → new over this long (s). */
const XFADE_S = 0.03

/** Move a gain to `to` over 20 ms instead of jumping (a jump in level clicks). */
/** The bands of the channel balance steps (plan §78 E). */
export const CHANNEL_BANDS_HZ = [125, 250, 500, 1000, 4000, 8000] as const

function rampTo(p: AudioParam, to: number, t: number) {
  p.cancelScheduledValues(t)
  p.setValueAtTime(p.value, t)
  p.linearRampToValueAtTime(to, t + 0.02)
}

/** Third-octave grid the custom EQ's response is levelled on. */
const LEVEL_FREQS = Array.from({ length: 31 }, (_, i) => 20 * 2 ** (i / 3))

/** What's measured on a song once (spectrum, loudest stretches, loudness), kept with its buffer. */
/** A stage's peak on a song's loud windows: right away, or later from a worker. */
type Measure = (windows: Float32Array[][]) => number | Promise<number>

const analysed = new WeakMap<AudioBuffer, { spectrum: Spectrum; windows: Float32Array[][]; loudness: { lufs: number; peak: number } }>()

/** What happens to the outgoing song during a mix. */
export interface MixEffect { lowPass: boolean; echo: boolean; rate: number }

const PLAIN_MIX: MixEffect = { lowPass: false, echo: false, rate: 1 }

export interface CompressorSettings { threshold: number; ratio: number; attack: number; release: number }

export interface Dynamics {
  /** Lower each song so the EQ's boosts don't reach full scale. */
  headroom: boolean
  /** The limiter on the EQ path. */
  limiter: boolean
  /** Use the limiter even with no EQ curve, because something else can push the level up. */
  limitAlways: boolean
  compressor: CompressorSettings | null
}

const DEFAULT_DYNAMICS: Dynamics = { headroom: true, limiter: true, limitAlways: false, compressor: null }

/** A loaded song with its own gain stage. */
/**
 * A song played by an audio element instead of a decoded buffer (§88 B: a PC song on the phone). It plays as the bytes
 * arrive and seeks by asking for that byte range, so the page never holds the whole decoded song. `sec` is its length
 * from the library (a live Low Data stream doesn't know its own).
 */
export interface StreamSong {
  el: HTMLAudioElement
  sec: number
}
const isStream = (x: AudioBuffer | StreamSong): x is StreamSong => 'el' in x

/** An audio element standing in for an AudioBufferSourceNode: started (at a context time) and stopped the same way. */
class MediaVoice {
  onended: (() => void) | null = null
  /** Android paused the element (another app took audio focus), not this player. */
  onInterrupted: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private el: HTMLAudioElement
  private ctx: BaseAudioContext
  constructor(el: HTMLAudioElement, ctx: BaseAudioContext, when: number, offset: number) {
    this.el = el
    this.ctx = ctx
    if (Math.abs(el.currentTime - offset) > 0.05) el.currentTime = offset
    el.onended = () => this.onended?.()
    // events arrive late: the pause from a seek's own stop lands after the play that followed it, so only a pause the
    // element is still in counts
    el.onpause = () => { if (el.paused && !el.ended) this.onInterrupted?.() }
    const go = () => void el.play().catch((e: unknown) => console.warn(`Stream wouldn't start: ${String(e)}`))
    const wait = (when - ctx.currentTime) * 1000
    if (wait > 20) this.timer = setTimeout(go, wait)
    else go()
  }
  stop(when = 0) {
    clearTimeout(this.timer)
    const halt = () => {
      this.el.onended = null
      this.el.onpause = null
      this.el.pause()
    }
    const wait = (when - this.ctx.currentTime) * 1000
    if (wait > 20) this.timer = setTimeout(halt, wait)
    else halt()
  }
  disconnect() { /* the element's node stays wired to its song gain until the song is dropped */ }
}

type Voice = AudioBufferSourceNode | MediaVoice

const lengthOf = (t: Track) => t.buffer?.duration ?? t.media?.sec ?? 0

interface Track {
  /** null for a streamed song (`media`). */
  buffer: AudioBuffer | null
  media?: StreamSong
  /** null until measured (a song started cold is measured just after it starts; till then a pink spectrum stands in). */
  spectrum: Spectrum | null
  /** The song's loudest stretches (empty until measured), and the levelled stage's peak on them (linear; null = not measured yet). */
  windows: Float32Array[][]
  stagePeak: number | null
  /** Off's level for this song (dB): Smart volume, or just the song's own overs taken off. */
  offDb: number
  gain: GainNode
  source: Voice | null
  /** When `source` starts on the context clock (for the queued next song: when this one ends). */
  startAt: number
  /** In a crossfade: its gain is on a scheduled curve, which other gain changes must leave alone. */
  mixing?: boolean
  levelNow?: number
  /** Undoes the mix's effect on this song. */
  fxEnd?: () => void
  /** Only the start of the song, until swapBuffer brings the rest. */
  partial?: boolean
}

/**
 * Full-track music player for the gallery: plays one song start to end through an
 * optional colouring stage (an IEM simulation FIR, or a custom peaking-EQ chain), then
 * volume, an analyser for the visualizer, and the fit-check L/R balance.
 *
 * EQ:  song gain ─ [convolver | biquads] ─ stage out ─ mix ─ sleep ─ volume ─ limiter ─ analyser ─ spatial ─ L/R balance ─ destination
 * Off: song gain ─────────────────────────── stage out ─ mix ─ sleep ─ volume ─────────── analyser ─ spatial ─ L/R balance ─ destination
 *
 * Switching EQ (or to Off) crossfades the old stage into the new one over XFADE_S, both running
 * side by side only for that moment, then drops the old one: no gap, no click, and one FIR at rest.
 * Minimum-phase filters add no delay, so the two paths line up as they are. With linear phase on (setLinearPhase),
 * the FIR is delayed by half its length, so every other path (Off, the band EQ) gets the same delay and a crossfade
 * never doubles the sound. The limiter is
 * crossfaded in or out the same way (it has a few ms of look-ahead, so a hard switch would click).
 * (spatial: spatial/stage.ts, a straight wire unless spatial mode is on)
 *
 * Each song has its own gain. Off is the file as it is (no filter, no limiter) at the song's
 * Smart volume level (audio/smartVolume.ts), or with only its own overs taken off when that's
 * turned off (decoded Opus can peak above 0 dBFS), so nothing clips at the output.
 * An EQ loudness-matches it to Off on the song's own spectrum, capped by the profile's measured
 * peak on the song's loudest moments (audio/headroom.ts) so the limiter only shaves the odd hit
 * by ≤ 1.5 dB instead of squashing them into a buzz. When that cap bites, the EQ plays quieter
 * than Off by `levelVsOffDb`, which the gallery shows. With "Off at the same level" (fairOffOn), Off
 * then plays that much lower too, so a level gap can't pass for a tone difference; `levelVsOffDb`
 * is then Off's own trim.
 * Switching profiles fades over ~15 ms rather than cutting, so it doesn't click.
 *
 * Gapless: about NEAR_END_S before a song ends `onNearEnd` asks for the next one; `queueNext`
 * schedules it on the audio clock to start the moment this one ends. The switch happens in the
 * audio thread, on time even with the screen off when the page's timers are slowed down, and
 * `onAdvance` tells the page afterwards.
 */
export class GalleryPlayer {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  /** Spatial mode, kept on the saved setting; head trackers call `setHeadYaw` on it. */
  readonly spatial: SpatialStage
  private cur: Track | null = null
  private next: Track | null = null
  private input: GainNode
  private stage: AudioNode[] = []
  private stageFirst: AudioNode | null = null
  /** Delay every non-FIR path gets while linear phase is on (s): half the FIR length. */
  private align = 0
  /** The current stage's output gain (crossfaded against the previous stage's when switching). */
  private stageOut: GainNode
  /** The stage's response (dB on `grid`), kept to re-level it for each song. */
  private stageCurve: { grid: ArrayLike<number>; db: ArrayLike<number> } | null = null
  /** How to measure the current stage's peak on a song's loud windows. */
  private measure: Measure = rawPeak
  /** The last colouring stage played, which Off is levelled to with fairOffOn. */
  private lastStage: { curve: { grid: ArrayLike<number>; db: ArrayLike<number> }; measure: Measure } | null = null
  private swapToken = 0
  /** How long the queued song overlaps the end of this one (0: gapless). */
  private overlapS = 0
  /** The start of a song ran out before the rest arrived. It carries on when swapBuffer brings it. */
  private stalled = false
  private mixEffect: MixEffect = PLAIN_MIX
  /** Where the stages (the current one, and the old one while it fades out) sum. */
  private mix: GainNode
  private sleep: GainNode
  private sleepToken = 0
  private volume: GainNode
  private limiter: DynamicsCompressorNode
  private dynamics = DEFAULT_DYNAMICS
  private compressor: DynamicsCompressorNode
  /** Before the volume: straight through, or through the compressor. */
  private dry: GainNode
  private compressed: GainNode
  /** volume → analyser straight (Off) and through the limiter (EQ), crossfaded on switches. */
  private direct: GainNode
  private viaLimiter: GainNode
  private balance: [GainNode, GainNode]
  private merge!: ChannelMergerNode
  private swapped = false
  private earBands: BiquadFilterNode[][] = []
  private earCurves: { left: number[]; right: number[] } | null = null
  private balanceDb = 0
  private startedAt = 0
  private offset = 0
  private nearTimer: ReturnType<typeof setTimeout> | undefined
  /** How much quieter than Off the current EQ plays because of its headroom cap (dB, ≤ 0); in Off, Off's trim. */
  levelVsOffDb = 0
  /** Called when the track plays to its end with nothing queued after it (not on pause/seek/stop). */
  onEnded: (() => void) | null = null
  /** Called when the queued next song has taken over from the one that ended. */
  onAdvance: (() => void) | null = null
  /** Called about NEAR_END_S before the end of the playing song while nothing is queued after it. */
  onNearEnd: (() => void) | null = null
  /** A streamed song was paused by Android (another app took the sound): the page pauses like a press. */
  onInterrupted: (() => void) | null = null
  /** Called when playback stalls waiting for the remainder of a partial buffer. */
  onStalled: ((stalled: boolean) => void) | null = null
  /** The page is loading the song it's switching to (a skip): set while it reads and decodes, then cleared. */
  switching = false
  /** Called when `levelVsOffDb` changes. */
  onLevel: ((db: number) => void) | null = null

  constructor(ctx: AudioContext) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const me = this
    this.ctx = ctx
    // a song being switched to counts as playing: the service and the context stay up through a skip
    registerAudioContext(ctx, { get playing() { return me.playing || me.switching } })
    this.input = ctx.createGain()
    this.mix = ctx.createGain()
    this.sleep = ctx.createGain()
    this.volume = ctx.createGain()
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    // a gentle safety net now that the preamp leaves headroom: a slightly soft knee and slower
    // attack/release don't bend single waveform cycles the way a 2 ms attack did
    this.limiter.knee.value = 2
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.005
    this.limiter.release.value = 0.25
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 4096
    this.analyser.smoothingTimeConstant = 0.78
    this.volume.channelCount = 2
    this.volume.channelCountMode = 'explicit'
    this.volume.channelInterpretation = 'speakers'
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    this.balance = [ctx.createGain(), ctx.createGain()]
    this.stageOut = ctx.createGain()
    this.input.connect(this.stageOut).connect(this.mix)
    this.spatial = new SpatialStage(ctx)
    followSpatialSettings(this.spatial)
    this.direct = ctx.createGain()
    this.viaLimiter = ctx.createGain()
    this.viaLimiter.gain.value = 0
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.knee.value = 0
    this.dry = ctx.createGain()
    this.compressed = ctx.createGain()
    this.compressed.gain.value = 0
    this.mix.connect(this.sleep)
    this.sleep.connect(this.dry).connect(this.volume)
    this.sleep.connect(this.compressor).connect(this.compressed).connect(this.volume)
    this.volume.connect(this.direct).connect(this.analyser)
    const intoCeiling = ctx.createGain()
    intoCeiling.gain.value = 0.5
    const ceiling = ctx.createWaveShaper()
    ceiling.curve = ceilingCurve()
    const outOfCeiling = ctx.createGain()
    outOfCeiling.gain.value = 2
    this.volume.connect(this.limiter).connect(intoCeiling).connect(ceiling).connect(outOfCeiling).connect(this.viaLimiter).connect(this.analyser)
    this.analyser.connect(this.spatial.input)
    this.spatial.output.connect(split)
    // per-ear band corrections from the balance steps (§78 E5): six peaking filters a side, 0 dB (transparent) until set
    this.earBands = [0, 1].map(() => CHANNEL_BANDS_HZ.map((hz) => {
      const f = ctx.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = hz
      f.Q.value = 1
      f.gain.value = 0
      return f
    }))
    this.balance.forEach((g, ch) => {
      const chain = this.earBands[ch]
      split.connect(chain[0], ch)
      for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i])
      chain[chain.length - 1].connect(g)
      g.connect(merge, 0, ch)
    })
    this.merge = merge
    merge.connect(speakerOut(ctx))
  }

  get playing() {
    return !!this.cur?.source
  }

  get duration() {
    return this.cur ? lengthOf(this.cur) : 0
  }

  /** The loaded song. */
  get buffer() {
    return this.cur?.buffer ?? null
  }

  get position() {
    if (!this.cur?.source) return this.offset
    // a stream can stall while it waits for bytes: the element's own clock is the truth, not the context's
    if (this.cur.media) return Math.min(this.duration, this.cur.media.el.currentTime)
    return Math.min(this.duration, this.offset + this.ctx.currentTime - this.startedAt)
  }

  /** `level`: the song's Smart volume measurement when it's known (audio/songLevel.ts); else measured here. */
  setBuffer(buffer: AudioBuffer | StreamSong | null, level?: { lufs: number; peak: number }, partial = false) {
    this.stop()
    this.dropNext()
    // after a fadeStop the old song may still be fading out: let it finish
    const old = this.cur
    if (old) setTimeout(() => this.release(old), (SKIP_FADE_S + 0.05) * 1000)
    // measured after it starts, not before: the scan is a few hundred ms on a phone, and it was
    // silence between a tap on ⏭ and the next song
    this.cur = buffer ? this.makeTrack(buffer, level, true) : null
    if (this.cur) this.cur.partial = partial
    this.offset = 0
    if (this.cur) this.levelTracks([this.cur])
  }

  /** Stop with a short fade (a skip): no click, and no dead stop while the next song loads. */
  fadeStop() {
    this.catchUp()
    const t = this.cur
    if (!t?.source) return
    this.offset = this.position
    clearTimeout(this.nearTimer)
    if (this.next) this.unschedule(this.next)
    this.endMix(t)
    const src = t.source
    t.source = null
    src.onended = null
    const now = this.ctx.currentTime
    t.gain.gain.cancelScheduledValues(now)
    t.gain.gain.setValueAtTime(t.gain.gain.value, now)
    t.gain.gain.linearRampToValueAtTime(0, now + SKIP_FADE_S)
    src.stop(now + SKIP_FADE_S + 0.01)
    notePlayback()
  }

  /** Queue the song that plays when this one ends, gaplessly (replaces any queued one). */
  queueNext(buffer: AudioBuffer | StreamSong, level?: { lufs: number; peak: number }, overlapS = 0, effect: MixEffect = PLAIN_MIX) {
    this.dropNext()
    this.overlapS = overlapS
    this.mixEffect = effect
    if (!this.cur) return
    const t = this.makeTrack(buffer, level)
    // measured now: it has to be right the moment it starts, which may be with the screen off
    const stage = this.levelStage
    this.applyGain(t, 0)
    if (stage) this.measureStage(t, stage.measure, 0)
    this.next = t
    clearTimeout(this.nearTimer)
    if (this.playing) this.scheduleNext()
  }

  /**
   * Replaces the start of a song with all of it, without a break: the same samples carry on from the same place.
   * The level glides to the whole song's, since the start can measure differently.
   */
  swapBuffer(buffer: AudioBuffer, level?: { lufs: number; peak: number }) {
    const old = this.cur
    if (!old) return
    const t = this.makeTrack(buffer, level, true)
    t.gain.gain.value = old.gain.gain.value
    this.cur = t
    const wasPlaying = Boolean(old.source) || this.stalled
    if (wasPlaying) {
      const when = this.ctx.currentTime + 0.03
      let from = this.offset
      if (old.source) {
        from += when - this.startedAt
        old.source.onended = null
        old.source.stop(when)
        old.source = null
      }
      if (this.stalled) {
        this.stalled = false
        this.onStalled?.(false)
      }
      this.offset = from
      this.startedAt = when
      t.source = this.startSource(t, when, from)
      setTimeout(() => this.release(old), 300)
      this.armNearEnd()
    } else this.release(old)
    this.applyGain(t, 0.5)
  }

  /** Forget the queued next song (what comes next changed); it'll be asked for again near the end. */
  clearNext() {
    this.dropNext()
    if (this.playing) this.armNearEnd()
  }

  /**
   * Linear-phase FIRs delay the sound by half their length; with `taps` set, every other path is delayed the same so
   * switches stay seamless (0 / null: minimum phase, no delay). Applies from the next setFlat / setFir / setCustom.
   */
  setLinearPhase(taps: number | null) {
    this.align = taps ? taps / 2 / this.ctx.sampleRate : 0
  }

  /** The added delay while linear phase is on (s). */
  get latency() {
    return this.align
  }

  private aligned(nodes: StageLink[]): StageLink[] {
    if (!this.align) return nodes
    const d = this.ctx.createDelay(1)
    d.delayTime.value = this.align
    return [...nodes, d]
  }

  /** Plain playback (no colouring). */
  setFlat() {
    this.rebuild(this.aligned([]), null, rawPeak)
  }

  /**
   * Play through an FIR (e.g. an IEM simulation) whose response is `curveDb` on `grid`, loudness-matched.
   * `linear`: the taps are linear-phase (their delay is the alignment itself). `space`: add the open-back space.
   */
  setFir(taps: Float32Array, grid: ArrayLike<number>, curveDb: ArrayLike<number>, opts: { linear?: boolean; space?: boolean } = {}) {
    const conv = this.ctx.createConvolver()
    conv.normalize = false
    const ir = this.ctx.createBuffer(1, taps.length, this.ctx.sampleRate)
    ir.copyToChannel(taps as Float32Array<ArrayBuffer>, 0)
    conv.buffer = ir
    const links: StageLink[] = [conv]
    if (opts.space) links.push(createBackSpace(this.ctx))
    this.rebuild(opts.linear ? links : this.aligned(links), { grid, db: curveDb }, (w) => firPeakAsync(w, taps))
  }

  /** Custom peaking EQ, one band per CUSTOM_EQ_FREQS entry, loudness-matched to no EQ. */
  setCustom(gainsDb: number[]) {
    const nodes = CUSTOM_EQ_FREQS.map((f, i) => {
      const b = this.ctx.createBiquadFilter()
      b.type = 'peaking'
      b.frequency.value = f
      b.Q.value = CUSTOM_EQ_Q
      b.gain.value = gainsDb[i] ?? 0
      return b
    })
    const bands = CUSTOM_EQ_FREQS.map((freq, i) => ({ freq, gainDb: gainsDb[i] ?? 0, q: CUSTOM_EQ_Q }))
    this.rebuild(this.aligned(nodes), { grid: LEVEL_FREQS, db: customEqResponse(gainsDb, LEVEL_FREQS, this.ctx) }, (w) =>
      peakingPeak(w, bands, this.ctx.sampleRate),
    )
  }

  setVolume(v: number) {
    rampTo(this.volume.gain, v, this.ctx.currentTime)
    for (const t of this.tracks()) this.applyGain(t, 0.02) // the headroom cap depends on the volume
  }

  /** Headroom, limiter and compressor. Changes glide, so they can be switched while a song plays. */
  setDynamics(next: Dynamics) {
    if (JSON.stringify(next) === JSON.stringify(this.dynamics)) return
    this.dynamics = next
    const now = this.ctx.currentTime
    const { compressor: settings } = next
    if (settings) {
      const c = this.compressor
      c.threshold.value = settings.threshold
      c.ratio.value = settings.ratio
      c.attack.value = settings.attack / 1000
      c.release.value = settings.release / 1000
      // Chromium's node raises everything to make up for the reduction, which would only make the song louder overall
      const makeupDb = 0.6 * -settings.threshold * (1 - 1 / settings.ratio)
      this.compressed.gain.setTargetAtTime(dbToGain(-makeupDb), now, 0.02)
    } else this.compressed.gain.setTargetAtTime(0, now, 0.02)
    this.dry.gain.setTargetAtTime(settings ? 0 : 1, now, 0.02)
    this.routeLimiter()
    for (const t of this.tracks()) this.applyGain(t, 0.02)
  }

  private get limiting() {
    return this.dynamics.limiter && (this.stageCurve !== null || this.dynamics.limitAlways)
  }

  private routeLimiter() {
    const now = this.ctx.currentTime
    this.direct.gain.setTargetAtTime(this.limiting ? 0 : 1, now, 0.02)
    this.viaLimiter.gain.setTargetAtTime(this.limiting ? 1 : 0, now, 0.02)
  }

  /** Channel balance from the fit check: + makes the right channel louder (split evenly). */
  setBalance(db: number) {
    this.balanceDb = db
    // the gains sit before the swap, so with L/R swapped the source channel that reaches the right ear is [0]
    const toRight = this.swapped ? -db : db
    rampTo(this.balance[0].gain, dbToGain(-toRight / 2), this.ctx.currentTime)
    rampTo(this.balance[1].gain, dbToGain(toRight / 2), this.ctx.currentTime)
  }

  /** Separate left and right band gains (dB, CHANNEL_BANDS_HZ order) for each ear; null = none. They follow the ear under a swap. */
  setEarCurves(curves: { left: number[]; right: number[] } | null) {
    this.earCurves = curves
    const now = this.ctx.currentTime
    // the filters sit before the swap: with L/R swapped, source channel 0 reaches the right ear
    const forSource = (ch: number) => (curves ? ((ch === 0) !== this.swapped ? curves.left : curves.right) : null)
    this.earBands.forEach((chain, ch) => chain.forEach((f, i) => rampTo(f.gain, forSource(ch)?.[i] ?? 0, now)))
  }

  /** Left and right swapped at the very end of the chain (§78 E1), after the balance, so a balance stays with its ear. */
  setSwap(on: boolean) {
    if (on === this.swapped) return
    this.swapped = on
    this.balance.forEach((g, ch) => {
      g.disconnect()
      g.connect(this.merge, 0, on ? 1 - ch : ch)
    })
    this.setBalance(this.balanceDb)
    this.setEarCurves(this.earCurves)
  }

  /** `fadeInS`: come in over that long (back from a test that held the music). */
  play(fadeInS = 0) {
    this.catchUp()
    const t = this.cur
    if (!t || t.source) return
    void this.ctx.resume()
    // a sleep fade-out in progress is called off
    this.sleepToken++
    const now = this.ctx.currentTime
    this.sleep.gain.cancelScheduledValues(now)
    this.sleep.gain.setValueAtTime(fadeInS > 0 ? 0 : 1, now)
    if (fadeInS > 0) this.sleep.gain.linearRampToValueAtTime(1, now + fadeInS)
    if (this.offset >= lengthOf(t) - 0.05 && !t.partial) this.offset = 0
    // back from a fadeStop: its fade is cancelled and the level put back
    t.gain.gain.cancelScheduledValues(this.ctx.currentTime)
    this.applyGain(t, 0)
    t.source = this.startSource(t, 0, this.offset)
    this.startedAt = this.ctx.currentTime
    this.scheduleNext()
    this.armNearEnd()
    notePlayback()
  }

  pause() {
    this.catchUp()
    if (!this.cur?.source) return
    this.offset = this.position
    this.stop()
  }

  seek(seconds: number) {
    this.catchUp()
    const wasPlaying = this.playing
    this.stop()
    this.offset = Math.max(0, Math.min(seconds, this.duration))
    if (wasPlaying) this.play()
  }

  /** The sleep timer: fade out over `seconds`, then pause. Resolves true once paused, false if play() called it off. */
  fadeOutAndPause(seconds: number): Promise<boolean> {
    const token = ++this.sleepToken
    const now = this.ctx.currentTime
    this.sleep.gain.cancelScheduledValues(now)
    this.sleep.gain.setValueAtTime(this.sleep.gain.value, now)
    // short fades (a test holding the music) go straight down; the sleep timer's long one eases out
    if (seconds < 2) this.sleep.gain.linearRampToValueAtTime(0, now + seconds)
    else this.sleep.gain.setTargetAtTime(0, now, seconds / 5)
    return new Promise((resolve) =>
      setTimeout(() => {
        if (token !== this.sleepToken) return resolve(false)
        this.pause()
        // paused, so nothing sounds: a test tone through the stage (connectTest) isn't faded with it
        this.sleep.gain.cancelScheduledValues(this.ctx.currentTime)
        this.sleep.gain.setValueAtTime(1, this.ctx.currentTime)
        resolve(true)
      }, seconds * 1000),
    )
  }

  /** Feed a test signal (the tone sweep) through the current EQ, volume and limiter; returns the disconnect. */
  connectTest(node: AudioNode): () => void {
    node.connect(this.input)
    return () => {
      try {
        node.disconnect(this.input)
      } catch {
        /* already disconnected */
      }
    }
  }

  private tracks() {
    return [this.cur, this.next].filter((t): t is Track => t !== null)
  }

  /** `later`: with a known level, measure the spectrum and loud windows just after the song starts, not before. */
  private makeTrack(song: AudioBuffer | StreamSong, level?: { lufs: number; peak: number }, later = false): Track {
    const gain = this.ctx.createGain()
    gain.connect(this.input)
    if (isStream(song)) {
      // no samples to measure: its stored level sets Off's gain, and the pink spectrum stands in for the EQ match
      this.ctx.createMediaElementSource(song.el).connect(gain)
      const t: Track = { buffer: null, media: song, spectrum: null, windows: [], stagePeak: null, offDb: level ? songGainDb(level) : 0, gain, source: null, startAt: 0 }
      // only a stream that ran dry mid-song is a stall: the wait before its first sound, or after a seek, is loading
      let began = false
      song.el.addEventListener('waiting', () => { if (began && !song.el.seeking && t === this.cur && t.source) this.onStalled?.(true) })
      song.el.addEventListener('playing', () => {
        began = true
        if (t === this.cur) this.onStalled?.(false)
      })
      return t
    }
    const buffer = song
    const a = analysed.get(buffer)
    if (a) return { buffer, spectrum: a.spectrum, windows: a.windows, stagePeak: null, offDb: songGainDb(a.loudness), gain, source: null, startAt: 0 }
    const analyse = () => {
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
      const done = {
        spectrum: longTermSpectrum(chans, buffer.sampleRate, 4096, 200),
        windows: loudWindows(chans),
        loudness: level ?? measureLoudness(chans, buffer.sampleRate),
      }
      analysed.set(buffer, done)
      return done
    }
    if (!later || !level) {
      const done = analyse()
      return { buffer, spectrum: done.spectrum, windows: done.windows, stagePeak: null, offDb: songGainDb(done.loudness), gain, source: null, startAt: 0 }
    }
    const t: Track = { buffer, spectrum: null, windows: [], stagePeak: null, offDb: songGainDb(level), gain, source: null, startAt: 0 }
    setTimeout(() => {
      if (t !== this.cur && t !== this.next) return
      const done = analyse()
      t.spectrum = done.spectrum
      t.windows = done.windows
      const stage = this.levelStage
      this.applyGain(t, 0.05)
      if (stage) this.measureStage(t, stage.measure, 0.05)
    }, ANALYSE_AFTER_MS)
    return t
  }

  private startSource(t: Track, when: number, offset: number): Voice {
    if (t.media) {
      const voice = new MediaVoice(t.media.el, this.ctx, when, offset)
      voice.onended = () => this.ended(t, voice)
      voice.onInterrupted = () => { if (t === this.cur && t.source === voice) this.onInterrupted?.() }
      return voice
    }
    const src = this.ctx.createBufferSource()
    src.buffer = t.buffer
    src.connect(t.gain)
    src.onended = () => this.ended(t, src)
    src.start(when, offset)
    return src
  }

  /** When the playing song ends, on the context clock. */
  private get endAt() {
    if (this.cur?.media) return this.ctx.currentTime + this.duration - this.position
    return this.startedAt + (this.duration - this.offset)
  }

  private scheduleNext() {
    const n = this.next
    if (!n || !this.cur?.source) return
    this.unschedule(n)
    const overlap = Math.min(this.overlapS, Math.max(0, this.endAt - this.ctx.currentTime))
    // a stream's end can't be put on the audio clock (it may stall): gapless next to one starts on its 'ended'
    if ((this.cur.media || n.media) && overlap <= 0.05) {
      n.startAt = Infinity
      return
    }
    n.startAt = Math.max(this.ctx.currentTime, this.endAt - overlap)
    n.source = this.startSource(n, n.startAt, 0)
    if (overlap > 0.05) this.crossfade(this.cur, n, overlap)
  }

  /** Equal-power, so the blend holds its loudness. Each song keeps its own level at full. */
  private crossfade(from: Track, to: Track, seconds: number) {
    const steps = 64
    const shape = (value: number, rising: boolean) => Float32Array.from({ length: steps }, (_, i) => {
      const x = i / (steps - 1)
      return value * Math.sin(((rising ? x : 1 - x) * Math.PI) / 2)
    })
    for (const [t, rising] of [[from, false], [to, true]] as const) {
      const param = t.gain.gain
      const level = t.levelNow ?? param.value
      t.levelNow = level
      param.cancelScheduledValues(0)
      param.setValueAtTime(rising ? 0 : level, this.ctx.currentTime)
      param.setValueCurveAtTime(shape(level, rising), to.startAt, seconds)
      t.mixing = true
    }
    this.applyMixEffect(from, to.startAt, seconds)
  }

  /** Colours the outgoing song on top of the crossfade. */
  private applyMixEffect(from: Track, at: number, seconds: number) {
    const ctx = this.ctx
    const { lowPass, echo, rate } = this.mixEffect
    if (!lowPass && !echo && rate === 1) return
    const glide = Math.min(1, seconds / 2)
    const gain = from.gain
    const undo: (() => void)[] = []
    let out: AudioNode = gain
    if (lowPass) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(20000, Math.max(at, ctx.currentTime))
      filter.frequency.exponentialRampToValueAtTime(1200, at + glide)
      gain.disconnect()
      gain.connect(filter).connect(this.input)
      out = filter
      undo.push(() => {
        gain.disconnect()
        filter.disconnect()
        gain.connect(this.input)
      })
    }
    if (echo) {
      const wet = ctx.createGain()
      wet.gain.setValueAtTime(0, ctx.currentTime)
      wet.gain.setValueAtTime(0, at)
      wet.gain.linearRampToValueAtTime(1, at + glide)
      const taps = ([[0.18, 0.3], [0.36, 0.15]] as const).map(([time, level]) => {
        const delay = ctx.createDelay(1)
        delay.delayTime.value = time
        const tap = ctx.createGain()
        tap.gain.value = level
        out.connect(delay).connect(tap).connect(wet)
        return [delay, tap]
      })
      wet.connect(this.input)
      undo.push(() => {
        // the echoes already on their way ring out
        setTimeout(() => {
          for (const nodes of taps) nodes.forEach((n) => n.disconnect())
          wet.disconnect()
        }, 500)
      })
    }
    const source = from.source
    if (rate !== 1 && source && 'playbackRate' in source) {
      source.playbackRate.setValueAtTime(1, at)
      source.playbackRate.linearRampToValueAtTime(rate, at + glide)
      // running slower it wouldn't reach its end in time, and the next song takes over on that end
      source.stop(at + seconds)
      undo.push(() => {
        source.playbackRate.cancelScheduledValues(0)
        source.playbackRate.value = 1
        if (from.source === source) source.stop(ctx.currentTime + 100000)
      })
    }
    from.fxEnd = () => undo.forEach((u) => u())
  }

  private endMix(t: Track) {
    t.fxEnd?.()
    t.fxEnd = undefined
    if (!t.mixing) return
    t.mixing = false
    t.gain.gain.cancelScheduledValues(0)
    t.levelNow = undefined
  }

  private armNearEnd() {
    clearTimeout(this.nearTimer)
    if (!this.cur?.source || this.next || this.cur.partial) return
    const ms = Math.max(0, (this.endAt - this.ctx.currentTime - NEAR_END_S) * 1000)
    this.nearTimer = setTimeout(() => this.onNearEnd?.(), ms)
  }

  private ended(t: Track, src: Voice) {
    if (t.source !== src) return
    t.source = null
    if (t !== this.cur) return
    if (t.partial) {
      this.offset = lengthOf(t)
      this.stalled = true
      this.onStalled?.(true)
      return
    }
    const n = this.next
    if (n && !n.source && n.startAt === Infinity) {
      // gapless after (or into) a stream: the next song starts now, on this one's end
      n.startAt = this.ctx.currentTime
      n.source = this.startSource(n, 0, 0)
    }
    if (this.next?.source) this.promote()
    else {
      this.offset = 0
      this.onEnded?.()
    }
    notePlayback()
  }

  /** The queued song has started on the audio clock: make it the current one. */
  private promote() {
    const n = this.next!
    const old = this.cur!
    old.fxEnd?.()
    old.fxEnd = undefined
    if (old.source) {
      old.source.onended = null
      old.source.disconnect()
    }
    this.release(old)
    this.next = null
    this.endMix(n)
    this.cur = n
    this.startedAt = n.startAt
    this.offset = 0
    this.applyGain(n, 0.01)
    this.armNearEnd()
    this.onAdvance?.()
  }

  /** If the queued song already took over but the page hasn't heard yet (timers slowed down), catch up first. */
  private catchUp() {
    if (this.next?.source && this.ctx.currentTime >= this.next.startAt) this.promote()
  }

  private unschedule(t: Track) {
    // called off: the song still playing goes back to its own level
    const playing = this.cur
    if (playing?.mixing && t !== playing) {
      const level = playing.levelNow
      this.endMix(playing)
      if (level !== undefined) playing.gain.gain.setValueAtTime(level, this.ctx.currentTime)
    }
    this.endMix(t)
    if (!t.source) return
    t.source.onended = null
    t.source.stop()
    t.source.disconnect()
    t.source = null
  }

  private dropNext() {
    if (!this.next) return
    this.unschedule(this.next)
    this.release(this.next)
    this.next = null
  }

  /** A song that's gone: off the graph, and a stream's element stops loading and lets go of its bytes. */
  private release(t: Track) {
    t.gain.disconnect()
    if (!t.media) return
    t.media.el.onended = null
    t.media.el.onpause = null
    t.media.el.pause()
    t.media.el.removeAttribute('src')
    t.media.el.load()
  }

  private rebuild(links: StageLink[], curve: { grid: ArrayLike<number>; db: ArrayLike<number> } | null, measure: Measure) {
    const ctx = this.ctx
    const t = ctx.currentTime
    const playing = this.playing
    this.swapToken++

    const old = { first: this.stageFirst ?? this.stageOut, nodes: this.stage, out: this.stageOut }
    const out = ctx.createGain()
    let last: AudioNode = this.input
    let first: AudioNode | null = null
    const nodes: AudioNode[] = []
    for (const link of links) {
      const [into, outOf] = 'input' in link && 'output' in link ? [link.input, link.output] : [link, link]
      last.connect(into)
      first ??= into
      nodes.push(into)
      if (outOf !== into) nodes.push(outOf)
      last = outOf
    }
    last.connect(out).connect(this.mix)
    this.stage = nodes
    this.stageFirst = first
    this.stageOut = out
    this.stageCurve = curve
    this.measure = measure
    if (curve) this.lastStage = { curve, measure }

    // crossfade old → new (and the limiter in or out); paused, it just switches
    const glide = (p: AudioParam, from: number, to: number) => {
      p.cancelScheduledValues(t)
      if (!playing) {
        p.value = to
        return
      }
      p.setValueAtTime(from, t)
      p.linearRampToValueAtTime(to, t + XFADE_S)
    }
    glide(out.gain, 0, 1)
    glide(old.out.gain, old.out.gain.value, 0)
    glide(this.direct.gain, this.direct.gain.value, this.limiting ? 0 : 1)
    glide(this.viaLimiter.gain, this.viaLimiter.gain.value, this.limiting ? 1 : 0)
    const drop = () => {
      try {
        this.input.disconnect(old.first)
      } catch {
        /* already disconnected */
      }
      for (const n of old.nodes) n.disconnect()
      old.out.disconnect()
    }
    if (playing) setTimeout(drop, XFADE_S * 1000 + 60)
    else drop()
    this.levelTracks(this.tracks())
  }

  /** Set each song's gain from the loudness match now, then cap it once the stage's peak is measured. */
  private levelTracks(tracks: Track[]) {
    for (const t of tracks) {
      t.stagePeak = null
      this.applyGain(t, 0.01)
    }
    const stage = this.levelStage
    if (!stage) return
    const token = this.swapToken
    // a few tens of ms of maths: off the current task, so a dragged slider stays smooth
    setTimeout(() => {
      if (token !== this.swapToken) return
      for (const t of tracks) {
        if (t !== this.cur && t !== this.next) continue
        if (!t.windows.length) continue // not measured yet: makeTrack's own timer does it
        this.measureStage(t, stage.measure, 0.03)
      }
    }, 0)
  }

  /**
   * The stage's peak on the song's loud windows, then its level. The FIR check comes back from a worker (§95 D); it's
   * used only if the song and the EQ are still the ones it was measured for.
   */
  private measureStage(t: Track, measure: Measure, tau: number) {
    const peak = measure(t.windows)
    if (typeof peak === 'number') {
      t.stagePeak = peak
      this.applyGain(t, tau)
      return
    }
    const windows = t.windows
    void peak.then((p) => {
      if (t.windows !== windows || (t !== this.cur && t !== this.next) || this.levelStage?.measure !== measure) return
      t.stagePeak = p
      this.applyGain(t, tau)
    })
  }

  /** The stage songs are levelled for: the current one, or in Off (with fairOffOn) the last EQ played. */
  private get levelStage() {
    if (this.stageCurve) return { curve: this.stageCurve, measure: this.measure }
    return fairOffOn() ? this.lastStage : null
  }

  private applyGain(t: Track, tau: number) {
    if (t.mixing) return
    let db = t.offDb
    let short = 0
    const stage = this.levelStage
    if (stage) {
      const match = loudnessMatchDb(stage.curve.grid, stage.curve.db, t.spectrum ?? undefined) + t.offDb
      const cap = t.stagePeak === null || !this.dynamics.headroom ? Infinity : headroomDb(t.stagePeak, this.volume.gain.value)
      short = Math.min(0, cap - match)
      // Off takes the EQ's shortfall, so both play equally loud
      db = this.stageCurve ? Math.min(match, cap) : t.offDb + short
    }
    if (this.limiting) db -= LIMITER_MAKEUP_DB
    // a song that isn't sounding yet takes its level at once, so it doesn't start on a glide
    if (t.source && tau > 0) t.gain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, tau)
    else t.gain.gain.value = dbToGain(db)
    if (t === this.cur && (t.stagePeak !== null || !stage)) this.setLevel(short)
  }

  private setLevel(db: number) {
    const rounded = Math.round(db * 10) / 10
    if (rounded === this.levelVsOffDb) return
    this.levelVsOffDb = rounded
    this.onLevel?.(rounded)
  }

  private stop() {
    clearTimeout(this.nearTimer)
    if (this.stalled) {
      this.stalled = false
      this.onStalled?.(false)
    }
    if (this.next) this.unschedule(this.next)
    const t = this.cur
    if (!t?.source) return
    const src = t.source
    t.source = null
    src.onended = null
    src.stop()
    src.disconnect()
    notePlayback()
  }
}

/** Summed response (dB) of the custom peaking chain at `freqs`. */
export function customEqResponse(gainsDb: number[], freqs: number[], ctx: BaseAudioContext): number[] {
  const f = new Float32Array(freqs)
  const mag = new Float32Array(freqs.length)
  const phase = new Float32Array(freqs.length)
  const total = new Array<number>(freqs.length).fill(0)
  CUSTOM_EQ_FREQS.forEach((fc, i) => {
    if (!gainsDb[i]) return
    const b = ctx.createBiquadFilter()
    b.type = 'peaking'
    b.frequency.value = fc
    b.Q.value = CUSTOM_EQ_Q
    b.gain.value = gainsDb[i]
    b.getFrequencyResponse(f, mag, phase)
    for (let k = 0; k < freqs.length; k++) total[k] += 20 * Math.log10(mag[k])
  })
  return total
}

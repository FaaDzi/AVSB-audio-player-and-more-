import { notePlayback, registerAudioContext } from '../platform'
import { followSpatialSettings } from '../spatial/settings'
import { SpatialStage } from '../spatial/stage'
import { createBackSpace, type BackSpace } from './backSpace'
import type { PreparedMatch } from './match'
import { speakerOut } from './speakerGuard'

const dbToGain = (db: number) => 10 ** (db / 20)
const FADE_S = 0.02

/**
 * Plays one clip through several filter chains at once and crossfades between them,
 * so switching A/B is instant and sample-aligned.
 *
 * source ─┬─ convolver A ─ gain A (match) ─ select A ─┐
 *         └─ convolver B ─ gain B (match) ─ select B ─┴─ master ─ spatial ─ L/R balance ─ destination
 *
 * The spatial stage (off by default) comes after both sides meet, so A and B always get the same one.
 */
export class ABPlayer {
  readonly ctx: AudioContext
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private chains: { convolver: ConvolverNode; match: GainNode; select: GainNode }[] = []
  private master: GainNode
  private rawGain: GainNode | null = null
  rawMode = false
  /** Spatial mode (spatial/stage.ts), kept on the saved setting; head trackers call `setHeadYaw` on it. */
  readonly spatial: SpatialStage
  private balance: [GainNode, GainNode]
  private startedAt = 0
  private offset = 0
  private loop: [number, number] | null = null
  active = 0

  // 'playback' asks for the larger output buffer music players use: the FIR, HRTF and room convolvers
  // then have room to finish each block on a phone instead of underrunning into crackles
  constructor(ctx = new AudioContext({ latencyHint: 'playback' })) {
    this.ctx = ctx
    registerAudioContext(ctx, this)
    this.master = ctx.createGain()
    // always stereo here, so a mono file still reaches both ears after the splitter
    this.master.channelCount = 2
    this.master.channelCountMode = 'explicit'
    this.master.channelInterpretation = 'speakers'
    this.rawGain = ctx.createGain()
    this.rawGain.gain.value = 0
    this.rawGain.connect(this.master)
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    this.balance = [ctx.createGain(), ctx.createGain()]
    this.spatial = new SpatialStage(ctx)
    followSpatialSettings(this.spatial, true)
    this.master.connect(this.spatial.input)
    this.spatial.output.connect(split)
    this.balance.forEach((g, ch) => {
      split.connect(g, ch)
      g.connect(merge, 0, ch)
    })
    merge.connect(speakerOut(ctx))
  }

  get playing() {
    return this.source !== null
  }

  get position() {
    if (!this.source) return this.offset
    const t = this.offset + this.ctx.currentTime - this.startedAt
    if (!this.loop) return t
    const [a, b] = this.loop
    return a + ((t - a) % (b - a))
  }

  setBuffer(buffer: AudioBuffer, loop?: [number, number]) {
    this.stop()
    this.buffer = buffer
    this.loop = loop ?? null
    this.offset = loop ? loop[0] : 0
  }

  /**
   * `spaces`: per side, 'open' adds an open-back headphone's sense of space to that side only (backSpace.ts);
   * 'closed' or nothing leaves it dry.
   */
  setMatch(match: PreparedMatch, spaces?: (BackSpace | null)[]) {
    const wasPlaying = this.playing
    const pos = this.position
    this.stop()
    for (const c of this.chains) c.select.disconnect()
    this.chains = match.sides.map((side, i) => {
      const convolver = this.ctx.createConvolver()
      convolver.normalize = false
      const ir = this.ctx.createBuffer(1, side.taps.length, this.ctx.sampleRate)
      ir.copyToChannel(side.taps as Float32Array<ArrayBuffer>, 0)
      convolver.buffer = ir
      const match = this.ctx.createGain()
      match.gain.value = dbToGain(side.gainDb)
      const select = this.ctx.createGain()
      select.gain.value = i === this.active ? 1 : 0
      if (spaces?.[i] === 'open') {
        const space = createBackSpace(this.ctx)
        convolver.connect(match).connect(space.input)
        space.output.connect(select).connect(this.master)
      } else convolver.connect(match).connect(select).connect(this.master)
      return { convolver, match, select }
    })
    this.setMaster(match.masterDb)
    this.offset = pos
    if (wasPlaying) this.play()
  }

  setMaster(db: number) {
    const t = this.ctx.currentTime
    const g = dbToGain(db)
    if (this.playing) {
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setValueAtTime(this.master.gain.value, t)
      this.master.gain.linearRampToValueAtTime(g, t + FADE_S)
    } else {
      this.master.gain.value = g
    }
  }

  /** Channel balance from the fit check: + makes the right channel louder (split evenly). */
  setBalance(db: number) {
    const t = this.ctx.currentTime
    const g0 = dbToGain(-db / 2)
    const g1 = dbToGain(db / 2)
    this.balance[0].gain.cancelScheduledValues(t)
    this.balance[0].gain.setValueAtTime(this.balance[0].gain.value, t)
    this.balance[0].gain.linearRampToValueAtTime(g0, t + FADE_S)
    this.balance[1].gain.cancelScheduledValues(t)
    this.balance[1].gain.setValueAtTime(this.balance[1].gain.value, t)
    this.balance[1].gain.linearRampToValueAtTime(g1, t + FADE_S)
  }

  play() {
    if (!this.buffer || this.source) return
    void this.ctx.resume()
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    if (this.loop) {
      src.loop = true
      src.loopStart = this.loop[0]
      src.loopEnd = this.loop[1]
    }
    if (this.rawGain) src.connect(this.rawGain)
    for (const c of this.chains) src.connect(c.convolver)
    src.onended = () => {
      if (this.source === src) {
        this.source = null
        this.offset = this.loop ? this.loop[0] : 0
        notePlayback()
      }
    }
    src.start(0, this.offset)
    this.startedAt = this.ctx.currentTime
    this.source = src
    notePlayback()
  }

  pause() {
    if (!this.source) return
    this.offset = this.position
    this.stop()
  }

  seek(seconds: number) {
    const wasPlaying = this.playing
    this.stop()
    this.offset = seconds
    if (wasPlaying) this.play()
  }

  /** Crossfade to chain `index`. */
  select(index: number) {
    this.active = index
    this.rawMode = false
    const t = this.ctx.currentTime
    this.chains.forEach((c, i) => {
      c.select.gain.cancelScheduledValues(t)
      c.select.gain.setValueAtTime(c.select.gain.value, t)
      c.select.gain.linearRampToValueAtTime(i === index ? 1 : 0, t + FADE_S)
    })
    if (this.rawGain) {
      this.rawGain.gain.cancelScheduledValues(t)
      this.rawGain.gain.setValueAtTime(this.rawGain.gain.value, t)
      this.rawGain.gain.linearRampToValueAtTime(0, t + FADE_S)
    }
  }

  /** Crossfade to raw unmodified hardware sound (bypass all FIR equalization). */
  selectRaw() {
    this.rawMode = true
    const t = this.ctx.currentTime
    this.chains.forEach((c) => {
      c.select.gain.cancelScheduledValues(t)
      c.select.gain.setValueAtTime(c.select.gain.value, t)
      c.select.gain.linearRampToValueAtTime(0, t + FADE_S)
    })
    if (this.rawGain) {
      this.rawGain.gain.cancelScheduledValues(t)
      this.rawGain.gain.setValueAtTime(this.rawGain.gain.value, t)
      this.rawGain.gain.linearRampToValueAtTime(1, t + FADE_S)
    }
  }

  private stop() {
    if (!this.source) return
    const src = this.source
    this.source = null
    src.onended = null
    src.stop()
    src.disconnect()
    notePlayback()
  }
}

import { registerAudioContext } from '../platform'
import { speakerOut } from './speakerGuard'
/**
 * Procedural WebAudio synthesizer for Jackbox-style party game sound effects
 * + zero-dependency Canvas confetti burst.
 *
 * Strictly silenced whenever ABPlayer test audio is actively playing so the
 * 4096-tap FIR listening comparison stays 100% acoustically pure.
 */

const SFX_KEY = 'sfx-enabled'
/** Effects sit below match level (about −4.5 dB) so they never startle at IEM listening volume. */
const MASTER_GAIN = 0.6

/**
 * Recorded effects (§64): public/sfx, from Pixabay (Pixabay Content License; sources in public/sfx/LICENSES.md),
 * trimmed to their onset and levelled. `peak` is when each one hits hardest (s), so a whoosh can land on the
 * moment a transition burst covers the screen. Two sets: the clean one, and a game-show "party" set (party-*) for the
 * new UI's Game show style (§66). The burst whooshes are shared, since each is matched to its burst.
 */
export const SAMPLES = {
  'swoosh-020': { peak: 0.51 },
  'swoosh-023': { peak: 0.35 },
  'swoosh-transition': { peak: 0.58 },
  'wind-riser': { peak: 1.17 },
  'swoosh-014': { peak: 0.21 },
  'swoosh-010': { peak: 0.28 },
  'air-swoosh': { peak: 0.79 },
  'swoosh-027': { peak: 0.51 },
  'vs-slam': { peak: 0.08 },
  tap: { peak: 0.02 },
  pick: { peak: 0.02 },
  build: { peak: 2.09 },
  champion: { peak: 1.16 },
  'party-tap': { peak: 0.03 },
  'party-vs': { peak: 0.32 },
  'party-start': { peak: 0.02 },
  'party-pick': { peak: 0.04 },
  'party-roll': { peak: 4.25 },
  'party-bell': { peak: 0.57 },
  'party-cheer': { peak: 0.78 },
  'party-champion': { peak: 0.6 },
  'party-ooh': { peak: 0.93 },
} as const
export type SampleName = keyof typeof SAMPLES

class GameSfx {
  private ctx: AudioContext | null = null
  private _enabled = true
  private _listeningActive = false
  private out: AudioNode | null = null
  private bal: [GainNode, GainNode] | null = null
  private balanceDb = 0

  constructor() {
    try {
      const v = localStorage.getItem(SFX_KEY)
      if (v !== null) this._enabled = v === '1'
    } catch {
      /* ignore */
    }
  }

  get enabled(): boolean {
    return this._enabled
  }

  setEnabled(v: boolean) {
    this._enabled = v
    try {
      localStorage.setItem(SFX_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  /** Same left/right balance as the match player (from the fit check). */
  setBalance(db: number) {
    this.balanceDb = db
    if (this.bal) {
      this.bal[0].gain.value = 10 ** (-db / 2 / 20)
      this.bal[1].gain.value = 10 ** (db / 2 / 20)
    }
  }

  /** Master output: quiet gain, upmixed to stereo, then per-ear balance. */
  private output(ctx: AudioContext): AudioNode {
    if (this.out && this.out.context === ctx) return this.out
    const master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.channelCount = 2
    master.channelCountMode = 'explicit'
    master.channelInterpretation = 'speakers'
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    this.bal = [ctx.createGain(), ctx.createGain()]
    master.connect(split)
    split.connect(this.bal[0], 0).connect(merge, 0, 0)
    split.connect(this.bal[1], 1).connect(merge, 0, 1)
    merge.connect(speakerOut(ctx))
    this.out = master
    this.setBalance(this.balanceDb)
    return master
  }

  /** Call when ABPlayer starts/stops playing so UI SFX never bleed into blind listening. */
  setListeningActive(active: boolean) {
    this._listeningActive = active
  }

  private canPlay(): boolean {
    return this._enabled && !this._listeningActive && typeof window !== 'undefined'
  }

  private samples = new Map<SampleName, AudioBuffer | null>()
  private loading: Promise<void> | null = null

  /** Recorded sounds are used wherever there's a page to play them in. */
  private useSamples(): boolean {
    return typeof document !== 'undefined'
  }

  /** The new UI's Game show style plays the party set. */
  private party(): boolean {
    return typeof document !== 'undefined' && document.documentElement.dataset.style === 'gameshow'
  }

  /** The clean sound, or its party counterpart in Game show. */
  private pick2(clean: SampleName, party: SampleName): SampleName {
    return this.party() ? party : clean
  }

  /** Fetch and decode the recorded set ahead of use (about 250 kB). A sound not ready yet falls back to the synth. */
  warmSamples(): Promise<void> {
    if (this.loading) return this.loading
    const ctx = this.getContext()
    if (!ctx) return Promise.resolve()
    this.loading = Promise.all(
      (Object.keys(SAMPLES) as SampleName[]).map(async (name) => {
        try {
          const data = await (await fetch(`${import.meta.env.BASE_URL}sfx/${name}.ogg`)).arrayBuffer()
          this.samples.set(name, await ctx.decodeAudioData(data))
        } catch {
          this.samples.set(name, null)
        }
      }),
    ).then(() => {})
    return this.loading
  }

  /**
   * Play a recorded effect `delay` s from now (negative: start that far into it). False when it can't, so the
   * caller plays its synthesised sound instead.
   */
  playSample(name: SampleName, volume = 0.8, delay = 0): { stop: () => void } | false {
    if (!this.useSamples()) return false
    const ctx = this.getContext()
    if (!ctx) return { stop: () => {} }
    const buffer = this.samples.get(name)
    if (!buffer) {
      void this.warmSamples()
      return false
    }
    try {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const g = ctx.createGain()
      g.gain.value = volume
      src.connect(g).connect(this.output(ctx))
      src.start(ctx.currentTime + Math.max(0, delay), Math.max(0, -delay))
      return {
        stop: () => {
          try {
            g.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
            src.stop(ctx.currentTime + 0.2)
          } catch {
            /* ignore */
          }
        },
      }
    } catch {
      return false
    }
  }

  private getContext(): AudioContext | null {
    if (!this.canPlay()) return null
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return null
        this.ctx = new Ctx()
        registerAudioContext(this.ctx)
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {})
      }
      return this.ctx
    } catch {
      return null
    }
  }

  /**
   * Every play comes out a little different, like a real instrument: about ±3% pitch,
   * ±1.5 dB and a touch of stereo position (or `pan`, −1 left … +1 right). Returns the
   * pitch factor, the gain factor and the node to connect to.
   */
  private vary(ctx: AudioContext, pan?: number): { p: number; g: number; out: AudioNode } {
    const p = 1 + (Math.random() * 2 - 1) * 0.03
    const g = 10 ** (((Math.random() * 2 - 1) * 1.5) / 20)
    let out = this.output(ctx)
    if (typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner()
      sp.pan.value = Math.max(-1, Math.min(1, pan ?? (Math.random() * 2 - 1) * 0.12))
      sp.connect(out)
      out = sp
    }
    return { p, g, out }
  }

  /** A short decaying noise burst (paper, snare, crunch). */
  private noiseBuffer(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * decay))
    return buf
  }

  /**
   * Tactile card / button pop, in one of three voicings so a run of taps doesn't sound
   * like a loop. `pitch` > 1 raises it (the gallery wheel climbs while it spins fast).
   */
  playPop(volume = 0.45, pitch = 1, pan?: number) {
    if (pitch <= 1.2 && this.playSample(this.pick2('tap', 'party-tap'), volume * 1.4)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, pan)
      const k = v.p * pitch
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const voicing = Math.floor(Math.random() * 3)
      if (voicing === 0) {
        // round bubble pop
        osc.type = 'sine'
        osc.frequency.setValueAtTime(760 * k, now)
        osc.frequency.exponentialRampToValueAtTime(280 * k, now + 0.075)
      } else if (voicing === 1) {
        // brighter wooden tick
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(980 * k, now)
        osc.frequency.exponentialRampToValueAtTime(520 * k, now + 0.05)
      } else {
        // little upward blip
        osc.type = 'sine'
        osc.frequency.setValueAtTime(420 * k, now)
        osc.frequency.exponentialRampToValueAtTime(820 * k, now + 0.06)
      }
      gain.gain.setValueAtTime(0.35 * volume * v.g, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085)
      osc.connect(gain).connect(v.out)
      osc.start(now)
      osc.stop(now + 0.09)
    } catch {
      /* ignore */
    }
  }

  /** Heavy rubber stamp thud (punchy sub drop + paper crunch); `pan` puts it on a side (votes). */
  playStamp(volume = 0.7, pan?: number) {
    if (this.playSample(this.pick2('pick', 'party-pick'), volume)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, pan)
      const osc = ctx.createOscillator()
      const oscGain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(145 * v.p, now)
      osc.frequency.exponentialRampToValueAtTime(36 * v.p, now + 0.14)
      oscGain.gain.setValueAtTime(0.75 * volume * v.g, now)
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19)
      osc.connect(oscGain).connect(v.out)
      osc.start(now)
      osc.stop(now + 0.2)

      // the paper crunch: its length and brightness change from stamp to stamp
      const crunch = 0.06 + Math.random() * 0.03
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer(ctx, crunch, 0.3)
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(700 + Math.random() * 400, now)
      const noiseGain = ctx.createGain()
      noiseGain.gain.setValueAtTime(0.35 * volume * v.g, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + crunch)
      noise.connect(filter).connect(noiseGain).connect(v.out)
      noise.start(now)
    } catch {
      /* ignore */
    }
  }

  /** Paper sheet fly whoosh: rises or falls at random and sweeps across the stereo field. */
  playWhoosh(volume = 0.5) {
    if (this.playSample('swoosh-027', volume * 1.4)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const dir = Math.random() < 0.5 ? -1 : 1
      const v = this.vary(ctx, -0.35 * dir)
      if ('pan' in v.out) (v.out as StereoPannerNode).pan.linearRampToValueAtTime(0.35 * dir, now + 0.24)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(210 * v.p, now)
      osc.frequency.exponentialRampToValueAtTime((dir > 0 ? 580 : 460) * v.p, now + 0.09)
      osc.frequency.exponentialRampToValueAtTime((dir > 0 ? 140 : 190) * v.p, now + 0.22)
      gain.gain.setValueAtTime(0.01, now)
      gain.gain.linearRampToValueAtTime(0.28 * volume * v.g, now + 0.07)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24)
      osc.connect(gain).connect(v.out)
      osc.start(now)
      osc.stop(now + 0.25)

      // a breath of air under the tone
      const air = ctx.createBufferSource()
      air.buffer = this.noiseBuffer(ctx, 0.24, 0.5)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 1.2
      bp.frequency.setValueAtTime(900, now)
      bp.frequency.exponentialRampToValueAtTime(2600, now + 0.2)
      const airGain = ctx.createGain()
      airGain.gain.setValueAtTime(0.09 * volume * v.g, now)
      airGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24)
      air.connect(bp).connect(airGain).connect(v.out)
      air.start(now)
    } catch {
      /* ignore */
    }
  }

  /** Pre-match VS bell / gong stinger, with a low thump under it. */
  playVsBell(volume = 0.6) {
    if (this.playSample(this.pick2('pick', 'party-pick'), volume)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)
      // Metallic bell partials (slightly inharmonic, so each strike rings a little differently)
      const partials = [587.33, 880, 1174.66, 1567.98]
      partials.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = i % 2 === 0 ? 'triangle' : 'sine'
        osc.frequency.setValueAtTime(freq * v.p * (1 + (Math.random() - 0.5) * 0.006), now)
        gain.gain.setValueAtTime((0.22 / (i + 1)) * volume * v.g, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65 - i * 0.1)
        osc.connect(gain).connect(v.out)
        osc.start(now)
        osc.stop(now + 0.7)
      })
      const thump = ctx.createOscillator()
      const tg = ctx.createGain()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(90, now)
      thump.frequency.exponentialRampToValueAtTime(45, now + 0.25)
      tg.gain.setValueAtTime(0.5 * volume * v.g, now)
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      thump.connect(tg).connect(v.out)
      thump.start(now)
      thump.stop(now + 0.32)
    } catch {
      /* ignore */
    }
  }

  /** High-energy fiery ignition whoosh when launching into a listening duel */
  playFlameIgnite(volume = 0.75) {
    if (this.playSample(this.pick2('tap', 'party-start'), volume)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer(ctx, 0.7, 10)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.setValueAtTime(1.8, now)
      bp.frequency.setValueAtTime(140 * v.p, now)
      bp.frequency.exponentialRampToValueAtTime(1200 * v.p, now + 0.25)
      bp.frequency.exponentialRampToValueAtTime(280 * v.p, now + 0.65)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.01, now)
      g.gain.linearRampToValueAtTime(0.48 * volume * v.g, now + 0.18)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.68)
      noise.connect(bp).connect(g).connect(v.out)
      noise.start(now)

      const thump = ctx.createOscillator()
      const tg = ctx.createGain()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(125, now)
      thump.frequency.exponentialRampToValueAtTime(38, now + 0.3)
      tg.gain.setValueAtTime(0.5 * volume * v.g, now)
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.32)
      thump.connect(tg).connect(v.out)
      thump.start(now)
      thump.stop(now + 0.35)
    } catch {
      /* ignore */
    }
  }

  /** Roaring cartoon flame whoosh + heavy VS impact slam + bell stinger for 1v1 clash transition */
  playFlameClash(volume = 0.7) {
    if (this.playSample(this.pick2('vs-slam', 'party-vs'), volume)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)

      // Layer 1: Filtered noise fire roar (0.0s -> 1.35s), rolling from one side to the other
      const noise = ctx.createBufferSource()
      noise.buffer = this.noiseBuffer(ctx, 1.35, 10)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.setValueAtTime(2.2, now)
      bp.frequency.setValueAtTime(160 * v.p, now)
      bp.frequency.exponentialRampToValueAtTime(920 * v.p, now + 0.35)
      bp.frequency.exponentialRampToValueAtTime(240 * v.p, now + 1.3)
      const fireGain = ctx.createGain()
      fireGain.gain.setValueAtTime(0.01, now)
      fireGain.gain.linearRampToValueAtTime(0.42 * volume * v.g, now + 0.28)
      fireGain.gain.exponentialRampToValueAtTime(0.001, now + 1.35)
      let fireOut: AudioNode = v.out
      if (typeof ctx.createStereoPanner === 'function') {
        const sp = ctx.createStereoPanner()
        const from = Math.random() < 0.5 ? -0.5 : 0.5
        sp.pan.setValueAtTime(from, now)
        sp.pan.linearRampToValueAtTime(-from, now + 1.1)
        sp.connect(v.out)
        fireOut = sp
      }
      noise.connect(bp).connect(fireGain).connect(fireOut)
      noise.start(now)

      // Layer 2: Heavy VS impact slam at 0.32s
      const slamOsc = ctx.createOscillator()
      const slamGain = ctx.createGain()
      slamOsc.type = 'triangle'
      slamOsc.frequency.setValueAtTime(155 * v.p, now + 0.32)
      slamOsc.frequency.exponentialRampToValueAtTime(34, now + 0.72)
      slamGain.gain.setValueAtTime(0.8 * volume * v.g, now + 0.32)
      slamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75)
      slamOsc.connect(slamGain).connect(v.out)
      slamOsc.start(now + 0.32)
      slamOsc.stop(now + 0.78)

      // crackles: a few short pops scattered through the roar
      for (let i = 0; i < 6; i++) {
        const t = now + 0.1 + Math.random() * 1.0
        const c = ctx.createBufferSource()
        c.buffer = this.noiseBuffer(ctx, 0.012, 0.25)
        const hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 2000 + Math.random() * 3000
        const cg = ctx.createGain()
        cg.gain.value = (0.08 + Math.random() * 0.08) * volume * v.g
        c.connect(hp).connect(cg).connect(fireOut)
        c.start(t)
      }

      // Layer 3: Ringing fight bell at 0.72s
      const partials = [587.33, 880, 1174.66]
      partials.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq * v.p, now + 0.72)
        g.gain.setValueAtTime((0.2 / (idx + 1)) * volume * v.g, now + 0.72)
        g.gain.exponentialRampToValueAtTime(0.001, now + 1.45)
        osc.connect(g).connect(v.out)
        osc.start(now + 0.72)
        osc.stop(now + 1.5)
      })
    } catch {
      /* ignore */
    }
  }

  /** Celebratory chord fanfare on match reveal or tournament win, in one of three voicings. */
  playFanfare(volume = 0.65) {
    if (this.party()) {
      // a match won on the show: the winner's bell with the crowd under it
      const bell = this.playSample('party-bell', volume * 1.1)
      if (bell) {
        this.playSample('party-cheer', volume * 0.8, 0.12)
        return
      }
    } else if (this.playSample('champion', volume * 1.2)) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)
      const voicings = [
        [261.63, 329.63, 392.0, 523.25, 659.25], // C major arpeggio
        [261.63, 392.0, 523.25, 587.33, 783.99], // C add9, open
        [293.66, 369.99, 440.0, 587.33, 739.99], // D major, a step up
      ]
      const notes = voicings[Math.floor(Math.random() * voicings.length)]
      const spread = 0.035 + Math.random() * 0.025
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        const start = now + idx * spread
        osc.frequency.setValueAtTime(freq * v.p, start)
        gain.gain.setValueAtTime(0.01, start)
        gain.gain.linearRampToValueAtTime(0.18 * volume * v.g, start + 0.035)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 1.0)
        osc.connect(gain).connect(v.out)
        osc.start(start)
        osc.stop(start + 1.05)
      })
    } catch {
      /* ignore */
    }
  }

  /** Classic sports-broadcast air horn blast on an upset (GDD Section 9) */
  playAirhorn(volume = 0.3) {
    // neither recorded set has an airhorn: the fanfare and the crowd already carry the moment
    if (this.useSamples()) return
    const ctx = this.getContext()
    if (!ctx) return
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)
      const blasts = [0, 0.16, 0.32]
      const freqs = [385, 480, 585]
      blasts.forEach((offset, bIdx) => {
        const len = bIdx === 2 ? 0.42 : 0.12
        freqs.forEach((f) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sawtooth'
          const fv = f * v.p * (1 + (Math.random() - 0.5) * 0.01) // a slightly sour, real-horn chord
          osc.frequency.setValueAtTime(fv * 0.96, now + offset)
          osc.frequency.linearRampToValueAtTime(fv, now + offset + 0.03)
          gain.gain.setValueAtTime(0.08 * volume * v.g, now + offset)
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + len)
          osc.connect(gain).connect(v.out)
          osc.start(now + offset)
          osc.stop(now + offset + len + 0.02)
        })
      })
    } catch {
      /* ignore */
    }
  }

  /** Snare drumroll + crash for podium crowning; each hit lands with its own weight. */
  /** The tournament's champion: a big fanfare (clean) or the crowd's cheer and applause (Game show). */
  playChampion(volume = 0.7) {
    if (this.playSample(this.pick2('champion', 'party-champion'), volume * 1.2)) return
    this.playFanfare(volume)
  }

  /** A close match (decided by one round): the studio audience gasps. Game show only. */
  playOoh(volume = 0.6) {
    if (this.party()) this.playSample('party-ooh', volume)
  }

  playDrumroll(duration = 1.6, volume = 0.65): { stop: () => void } {
    const roll = this.pick2('build', 'party-roll')
    const recorded = this.playSample(roll, volume, duration - SAMPLES[roll].peak)
    if (recorded) return recorded
    const ctx = this.getContext()
    if (!ctx) return { stop: () => {} }
    try {
      const now = ctx.currentTime
      const v = this.vary(ctx, 0)
      const rollGain = ctx.createGain()
      rollGain.gain.setValueAtTime(0.04 * volume * v.g, now)
      rollGain.gain.linearRampToValueAtTime(0.55 * volume * v.g, now + duration - 0.15)
      rollGain.connect(v.out)

      const hitCount = Math.floor(duration * 22)
      const sources: AudioBufferSourceNode[] = []
      for (let i = 0; i < hitCount; i++) {
        // a human roll: hits drift a few ms and alternate a stronger and a lighter hand
        const hitTime = now + (i / hitCount) * (duration - 0.15) + (Math.random() - 0.5) * 0.008
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer(ctx, 0.035, 0.4)
        const filter = ctx.createBiquadFilter()
        filter.type = 'highpass'
        filter.frequency.setValueAtTime(800 + (i / hitCount) * 1100, Math.max(now, hitTime))
        const hit = ctx.createGain()
        hit.gain.value = (i % 2 ? 0.75 : 1) * (0.85 + Math.random() * 0.3)
        src.connect(filter).connect(hit).connect(rollGain)
        src.start(Math.max(now, hitTime))
        sources.push(src)
      }
      return {
        stop: () => {
          sources.forEach((s) => {
            try {
              s.stop()
            } catch {
              /* ignore */
            }
          })
          rollGain.disconnect()
        },
      }
    } catch {
      return { stop: () => {} }
    }
  }
}

export const sfx = new GameSfx()

/** Zero-dependency side-cannon Jackbox party confetti burst that frames the podium without covering text. */
export function fireConfetti(durationMs = 2600) {
  if (typeof document === 'undefined') return
  if (document.body.classList.contains('reduce-motion')) return
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1;'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const colors = ['#ffe600', '#ff2a85', '#00f0d0', '#ffffff', '#ff9f1c', '#a06cd5']
  const pieces = Array.from({ length: 84 }, (_, idx) => {
    const leftCannon = idx % 2 === 0
    const angle = leftCannon
      ? -Math.PI / 2 + 0.35 + (Math.random() - 0.5) * 0.55
      : -Math.PI / 2 - 0.35 + (Math.random() - 0.5) * 0.55
    const speed = 10 + Math.random() * 13
    return {
      x: leftCannon ? canvas.width * (0.04 + Math.random() * 0.16) : canvas.width * (0.8 + Math.random() * 0.16),
      y: canvas.height * 0.78,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      w: 8 + Math.random() * 8,
      h: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.25,
    }
  })

  const start = performance.now()
  let raf = 0
  const tick = (now: number) => {
    const elapsed = now - start
    if (elapsed > durationMs) {
      cancelAnimationFrame(raf)
      canvas.remove()
      return
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const alpha = elapsed > durationMs - 600 ? Math.max(0, (durationMs - elapsed) / 600) : 0.88
    ctx.globalAlpha = alpha
    for (const p of pieces) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.38
      p.vx *= 0.99
      p.rot += p.vrot
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1.5
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}


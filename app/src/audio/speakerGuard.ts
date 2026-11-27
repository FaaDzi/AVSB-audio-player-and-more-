// Speaker guard: when music plays out of the phone's own speaker (native AudioRoute plugin,
// android/.../AudioRoutePlugin.java), every player's output goes through a protective stage
// before the destination:
//
//   in ─┬─ dry ──────────────────────────────────────────────────┬─ destination
//       └─ high-pass ×2 (LR4 at GUARD_HPF_HZ) ─ trim ─ limiter ─ wet ┘
//
// A phone speaker can't play deep bass; it only makes the cone travel further, so an IEM
// simulation's bass boost (or a bass-heavy EQ) is cut there instead of being pushed into it.
// The trim and limiter keep the level a few dB under full scale. Dolby Atmos stays on for the
// speaker on many phones (it can't be switched off), and its leveller can lift what's sent, so
// the headroom is for that too. On earphones the dry path is a straight wire: bit-transparent.
import { registerPlugin } from '@capacitor/core'
import { isAndroid } from '../platform'

export const GUARD_HPF_HZ = 180
export const GUARD_TRIM_DB = -4
export const GUARD_LIMIT_DB = -4
/** Crossfade between the dry and guarded paths when the route changes (s, time constant). */
const SWITCH_TAU_S = 0.03

/** What media plays to on Android (fit/system.ts): type, product name, USB vendor:product. Empty for the phone's own speaker/unknown. */
export interface AndroidOutput {
  type?: 'bluetooth' | 'usb' | 'wired' | 'speaker' | 'other'
  name?: string
  usb?: string
}

/** The Bluetooth codec in use (Settings → Output). `known: false` when the phone won't say. */
export interface BluetoothCodec {
  known: boolean
  denied?: boolean
  name?: string
  codec?: string
  sampleRate?: number
  bits?: number
  /** LDAC's quality mode: 990 / 660 / 330, 0 = adaptive. */
  ldacKbps?: number
  /** §119: codecs this phone and pair could switch to. */
  selectable?: string[]
  /** setCodec only: whether the phone took it. */
  applied?: boolean
}

interface AudioRoute {
  /** `stereo`: false when the phone says its own speaker takes one channel only (so there is one speaker). */
  status(): Promise<{ speaker: boolean; stereo?: boolean; model?: string }>
  output(): Promise<AndroidOutput>
  codec(): Promise<BluetoothCodec>
  setCodec(o: { codec: string; ldacKbps?: number }): Promise<BluetoothCodec>
  openDeveloperOptions(): Promise<void>
  openBluetoothSettings(): Promise<void>
  addListener(e: 'change', cb: (r: { speaker: boolean }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(e: 'devices', cb: (r: AndroidOutput) => void): Promise<{ remove: () => Promise<void> }>
}
/** The native AudioRoute plugin (android/.../AudioRoutePlugin.java); only registered once, here. */
export const AudioRoute = registerPlugin<AudioRoute>('AudioRoute')

let onSpeaker = false
const subs = new Set<(speaker: boolean) => void>()
const guards = new Map<BaseAudioContext, { input: GainNode; dry: GainNode; wet: GainNode }>()
let started = false

function set(speaker: boolean) {
  if (speaker === onSpeaker) return
  onSpeaker = speaker
  for (const [ctx, g] of guards) {
    if (ctx.state === 'closed') guards.delete(ctx)
    else apply(ctx, g, true)
  }
  subs.forEach((cb) => cb(speaker))
}

function apply(ctx: BaseAudioContext, g: { dry: GainNode; wet: GainNode }, ramp: boolean) {
  const [dry, wet] = onSpeaker ? [0, 1] : [1, 0]
  if (!ramp) {
    g.dry.gain.value = dry
    g.wet.gain.value = wet
    return
  }
  const t = ctx.currentTime
  g.dry.gain.setTargetAtTime(dry, t, SWITCH_TAU_S)
  g.wet.gain.setTargetAtTime(wet, t, SWITCH_TAU_S)
}

/**
 * Route changes this soon after the screen goes off or on are checked again before they count: a
 * USB DAC can drop off the device list for a moment then, and following that blip moved the level
 * (the guard's −4 dB and bass cut going on and off) with nothing really unplugged.
 */
const SCREEN_SETTLE_MS = 2000
let screenAt = 0
let recheck: ReturnType<typeof setTimeout> | undefined

/**
 * Earphones → speaker only counts once it has held this long. A Bluetooth link that drops for a
 * moment (a crowded 2.4 GHz room) briefly reports no earphones; following that blip cut the bass
 * and 4 dB off the music until the link came back, which sounded like the signal fading.
 */
const SPEAKER_HOLD_MS = 1500

function onRoute(speaker: boolean) {
  clearTimeout(recheck)
  // back to earphones: at once (outside the screen on/off settle)
  const settle = screenAt + SCREEN_SETTLE_MS - Date.now()
  if (!speaker && settle <= 0) return set(false)
  const wait = Math.max(settle, speaker ? SPEAKER_HOLD_MS : 0)
  recheck = setTimeout(() => {
    void AudioRoute.status()
      .then((r) => set(!!r.speaker))
      .catch(() => {})
  }, wait)
}

/** Ask the phone where music is going, and follow it. Android only; elsewhere the guard stays off. */
function start() {
  if (started || !isAndroid()) return
  started = true
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (screenAt = Date.now()))
  void AudioRoute.status()
    .then((r) => set(!!r.speaker))
    .catch(() => {}) // an old APK without the plugin: guard off
  void AudioRoute.addListener('change', (r) => onRoute(!!r.speaker)).catch(() => {})
}

/** Is music going to the phone's own speaker right now? */
export function phoneSpeakerOn(): boolean {
  start()
  return onSpeaker
}

/** Called with the new state whenever the output switches to or from the phone's speaker. */
export function onPhoneSpeaker(cb: (speaker: boolean) => void): () => void {
  start()
  subs.add(cb)
  return () => subs.delete(cb)
}

/**
 * Where a player connects its final output instead of `ctx.destination`: one guard per context,
 * shared by every player on it.
 */
export function speakerOut(ctx: BaseAudioContext): AudioNode {
  start()
  const have = guards.get(ctx)
  if (have) return have.input
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const hp = [ctx.createBiquadFilter(), ctx.createBiquadFilter()]
  for (const f of hp) {
    f.type = 'highpass'
    f.frequency.value = GUARD_HPF_HZ
    f.Q.value = Math.SQRT1_2
  }
  const trim = ctx.createGain()
  trim.gain.value = 10 ** (GUARD_TRIM_DB / 20)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = GUARD_LIMIT_DB
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.2
  input.connect(dry).connect(ctx.destination)
  input.connect(hp[0]).connect(hp[1]).connect(trim).connect(limiter).connect(wet).connect(ctx.destination)
  const g = { input, dry, wet }
  apply(ctx, g, false)
  guards.set(ctx, g)
  return input
}

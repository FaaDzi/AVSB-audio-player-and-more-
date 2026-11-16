// The EQ tab's test tone (plan §84 E). A sine only ever meets the EQ at one frequency, so "heard through your EQ"
// is just the EQ's gain at that frequency: one oscillator and a gain per ear, no filters to rebuild.
let ctx: AudioContext | null = null
let osc: OscillatorNode | null = null
let left: GainNode | null = null
let right: GainNode | null = null

/** The tone's level before the EQ (dBFS), and the most it may reach with boosts on top. */
export const TONE_BASE_DB = -30
const TONE_MAX_DB = -9

const amp = (db: number) => 10 ** (Math.min(TONE_MAX_DB, TONE_BASE_DB + db) / 20)

/** Starts the tone, or moves it: frequency, and what the EQ does there for each ear (dB). */
export function setTone(hz: number, leftDb: number, rightDb: number) {
  if (!ctx) {
    ctx = new AudioContext()
    osc = ctx.createOscillator()
    left = ctx.createGain()
    right = ctx.createGain()
    const merger = ctx.createChannelMerger(2)
    left.gain.value = 0
    right.gain.value = 0
    osc.connect(left).connect(merger, 0, 0)
    osc.connect(right).connect(merger, 0, 1)
    merger.connect(ctx.destination)
    osc.frequency.value = hz
    osc.start()
  }
  const now = ctx.currentTime
  // short glides: no clicks when the frequency or the EQ under it moves
  osc!.frequency.setTargetAtTime(hz, now, 0.015)
  left!.gain.setTargetAtTime(amp(leftDb), now, 0.02)
  right!.gain.setTargetAtTime(amp(rightDb), now, 0.02)
}

export function stopTone() {
  const old = ctx
  if (!old) return
  left?.gain.setTargetAtTime(0, old.currentTime, 0.02)
  right?.gain.setTargetAtTime(0, old.currentTime, 0.02)
  ctx = osc = left = right = null
  window.setTimeout(() => void old.close().catch(() => {}), 150)
}

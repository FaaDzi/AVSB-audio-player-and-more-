/**
 * The sense of space of an open-back headphone, for simulating one on in-ears (§67). Its measured tuning is already
 * in the side's FIR; this adds what the frequency response can't: some sound reaching the other ear (crossfeed:
 * first-order low-passed at 350 Hz, 0.3 ms late, −14 dB) and faint short reflections, so the stage sits a little
 * outside the head instead of in it. Closed backs get nothing.
 *
 * Level must stay fair, since the other contender may be a closed back: in the bass, centred sound reaches each ear
 * directly and through the crossfeed, in phase. So the direct path is a first-order low shelf at the same corner
 * whose bass level is 1 − crossfeed: for centred sound the two sum to exactly 1, apart from the 0.3 ms delay, which
 * leaves under 1 dB anywhere from 20 Hz to 20 kHz (backSpace.test.ts). Stronger or higher crossfeed would colour
 * the tone by several dB, which would hand one side an unfair edge.
 *
 *  in ─┬──────────── direct: 1st-order low shelf 350 Hz, DC gain 1 − x ───────┬─ out
 *      ├─ L→R / R→L: 1st-order lowpass 350 Hz ─ delay 0.3 ms ─ x (−14 dB) ────┤
 *      └─ reflections: 7 ms and 13 ms, high-passed, −20 / −23 dB, crossed ────┘
 */
export type BackSpace = 'open' | 'closed'

export const CROSSFEED_HZ = 350
export const CROSSFEED_DB = -14
export const CROSSFEED_DELAY_S = 0.0003

const dB = (v: number) => 10 ** (v / 20)

/**
 * First-order filters by the bilinear transform, as [feedforward, feedback] for an IIRFilterNode.
 * Low-pass: k(1 + z⁻¹) / ((1 + k) + (k − 1)z⁻¹). Low shelf with DC gain g: (gk + 1 + (gk − 1)z⁻¹) / same.
 */
export function firstOrder(sampleRate: number, hz: number, dcGain: number | 'lowpass'): [number[], number[]] {
  const k = Math.tan((Math.PI * hz) / sampleRate)
  const a = [1 + k, k - 1]
  return dcGain === 'lowpass' ? [[k, k], a] : [[dcGain * k + 1, dcGain * k - 1], a]
}

/** The network for one side: connect the side's signal to `input`, take `output` onward. */
export function createBackSpace(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain()
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  const output = ctx.createGain()
  output.channelCount = 2
  output.channelCountMode = 'explicit'
  const x = dB(CROSSFEED_DB)

  const [sb, sa] = firstOrder(ctx.sampleRate, CROSSFEED_HZ, 1 - x)
  const direct = ctx.createIIRFilter(sb, sa)
  input.connect(direct).connect(output)

  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  input.connect(split)
  const [lb, la] = firstOrder(ctx.sampleRate, CROSSFEED_HZ, 'lowpass')
  for (const [from, to] of [[0, 1], [1, 0]] as const) {
    // crossfeed: the far ear hears a darker, slightly later copy
    const lp = ctx.createIIRFilter(lb, la)
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = CROSSFEED_DELAY_S
    const gain = ctx.createGain()
    gain.gain.value = x
    split.connect(lp, from)
    lp.connect(delay).connect(gain).connect(merge, 0, to)

    // two faint early reflections off the open grille, crossed over
    for (const [ms, db] of [[7, -20], [13, -23]] as const) {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 400
      const d = ctx.createDelay(0.05)
      d.delayTime.value = ms / 1000
      const g = ctx.createGain()
      g.gain.value = dB(db)
      split.connect(hp, from)
      hp.connect(d).connect(g).connect(merge, 0, to)
    }
  }
  merge.connect(output)
  return { input, output }
}

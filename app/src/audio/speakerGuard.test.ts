import { describe, expect, it, vi } from 'vitest'

let routeListener: ((r: { speaker: boolean }) => void) | null = null
/** Where the fake phone says music is going when asked. */
let routeNow = false
vi.mock('../platform', () => ({ isAndroid: () => true }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    status: () => Promise.resolve({ speaker: routeNow }),
    addListener: (_e: string, cb: (r: { speaker: boolean }) => void) => {
      routeListener = cb
      return Promise.resolve({ remove: () => Promise.resolve() })
    },
  }),
}))

/** Fake Web Audio graph: records each node's params and what it connects to. */
function fakeCtx() {
  const param = (value: number) => ({ value, setTargetAtTime(v: number) { this.value = v } })
  const made: Record<string, unknown>[] = []
  const node = (kind: string) => () => {
    const n: Record<string, unknown> = {
      kind,
      out: [] as unknown[],
      gain: param(1),
      frequency: param(350),
      Q: param(1),
      threshold: param(-24),
      knee: param(30),
      ratio: param(12),
      attack: param(0.003),
      release: param(0.25),
      connect(to: unknown) {
        ;(this.out as unknown[]).push(to)
        return to
      },
    }
    made.push(n)
    return n
  }
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: { kind: 'destination' },
    createGain: node('gain'),
    createBiquadFilter: node('biquad'),
    createDynamicsCompressor: node('compressor'),
  }
  return { ctx: ctx as unknown as BaseAudioContext, made }
}

describe('speaker guard', () => {
  it('is a straight wire on earphones and switches to the guarded path on the phone speaker', async () => {
    const { speakerOut, onPhoneSpeaker, GUARD_HPF_HZ } = await import('./speakerGuard')
    const { ctx, made } = fakeCtx()
    const input = speakerOut(ctx)
    expect(speakerOut(ctx)).toBe(input) // one guard per context

    const filters = made.filter((n) => n.kind === 'biquad') as { type: string; frequency: { value: number } }[]
    expect(filters).toHaveLength(2)
    expect(filters.every((f) => f.type === 'highpass' && f.frequency.value === GUARD_HPF_HZ)).toBe(true)

    // dry and wet are the two gains wired straight into the destination
    const toDest = made.filter((n) => (n.out as unknown[]).includes(ctx.destination)) as { gain: { value: number } }[]
    expect(toDest).toHaveLength(2)
    const [dry, wet] = toDest
    expect([dry.gain.value, wet.gain.value]).toEqual([1, 0])

    vi.useFakeTimers()
    try {
      const seen: boolean[] = []
      onPhoneSpeaker((s) => seen.push(s))
      const route = async (speaker: boolean, ms = 0) => {
        routeNow = speaker
        routeListener?.({ speaker })
        await vi.advanceTimersByTimeAsync(ms)
      }

      // a Bluetooth blip shorter than the hold changes nothing
      await route(true, 400)
      await route(false, 2000)
      expect([dry.gain.value, wet.gain.value]).toEqual([1, 0])

      // the speaker for real: guarded once it has held for 1.5 s
      await route(true, 1000)
      expect([dry.gain.value, wet.gain.value]).toEqual([1, 0])
      await vi.advanceTimersByTimeAsync(600)
      expect([dry.gain.value, wet.gain.value]).toEqual([0, 1])

      // earphones back: straight away
      await route(false)
      expect([dry.gain.value, wet.gain.value]).toEqual([1, 0])
      expect(seen).toEqual([true, false])
    } finally {
      vi.useRealTimers()
    }
  })
})

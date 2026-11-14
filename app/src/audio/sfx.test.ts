import { describe, expect, it, vi } from 'vitest'

// the speaker guard is its own stage (speakerGuard.test.ts); here the chain ends at the destination
vi.mock('./speakerGuard', () => ({ speakerOut: (ctx: { destination: unknown }) => ctx.destination }))

/** Minimal fake Web Audio graph that counts the nodes the effects create. */
function fakeAudio() {
  let nodes = 0
  const node = () => {
    nodes++
    const n: Record<string, unknown> = {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: (to: unknown) => to,
      start() {},
      stop() {},
    }
    n.context = ctx
    return n
  }
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: node,
    createOscillator: node,
    createChannelSplitter: node,
    createChannelMerger: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(10) }),
    sampleRate: 48000,
  }
  return { ctx, count: () => nodes }
}

describe('sound effects', () => {
  it('builds the output chain once and reuses it for every sound', async () => {
    const { ctx, count } = fakeAudio()
    vi.stubGlobal('window', { AudioContext: function () { return ctx } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
    const { sfx } = await import('./sfx')
    sfx.playPop()
    const afterFirst = count()
    sfx.playPop()
    sfx.playPop()
    // each later pop only adds its own oscillator + gain
    expect(count() - afterFirst).toBe(4)
    expect(afterFirst).toBeLessThan(10)
    vi.unstubAllGlobals()
  })
})

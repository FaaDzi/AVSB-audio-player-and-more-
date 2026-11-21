// §104 C: calibration sounds: a short ding per step and a rising chime when it's all done. Made in code, so it needs no file and
// plays even when the game sounds are off.
let ctx: AudioContext | null = null

/** 'step': one short note (a calibration step passed); 'done': a rising three-note chime (all finished). */
export function playDing(kind: 'step' | 'done' = 'done', volume = 0.25) {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const now = ctx.currentTime
    // a step: E6; finished: E6, A6, E7 rising
    ;(kind === 'step' ? [[1318.5, 0]] : [[1318.5, 0], [1760, 0.12], [2637, 0.24]]).forEach(([hz, at]) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0, now + at)
      gain.gain.linearRampToValueAtTime(volume, now + at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.6)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(now + at)
      osc.stop(now + at + 0.65)
    })
  } catch {
    // no audio output: the text still says it was saved
  }
}

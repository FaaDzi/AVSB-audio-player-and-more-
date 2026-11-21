// §104 C: a short two-note chime for "saved" (head-tracking calibration). Made in code, so it needs no file and
// plays even when the game sounds are off.
let ctx: AudioContext | null = null

export function playDing(volume = 0.25) {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
    const now = ctx.currentTime
    // E6 then A6: a rising "ding-ding"
    ;[[1318.5, 0], [1760, 0.12]].forEach(([hz, at]) => {
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

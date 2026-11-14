// The rainbow wash follows the music (§64 polish): while a song plays, its loudness lifts the wash and the balance of
// bass and treble turns its hue. Two CSS variables on <html>: --wash-energy (0..1) and --wash-hue (deg). Quiet and
// paused: they ease back to 0. Off with the app's Reduce motion switch.
import { engineAnalyser, isLive } from './engine'

let started = false
let covered = false
let wake: () => void = () => {}

/**
 * Now Playing covers the whole window, wash included: no updates while it's open. Each update rewrites variables on
 * <html>, which restyles the page, and that work was landing on the frames the lyrics scroll in.
 */
export function setWashCovered(on: boolean) {
  covered = on
  if (!on) wake()
}

export function startRainbowPulse() {
  if (started || typeof window === 'undefined') return
  started = true
  const root = document.documentElement
  let energy = 0
  let hue = 0
  let bins: Uint8Array<ArrayBuffer> | null = null
  let last = 0

  let raf = 0
  // only write a variable when its text changes: each write restyles the whole page
  const written = new Map<string, string>()
  const put = (name: string, value: string) => {
    if (written.get(name) === value) return
    written.set(name, value)
    root.style.setProperty(name, value)
  }

  const frame = (now: number) => {
    raf = 0
    if (document.hidden || covered) return
    raf = requestAnimationFrame(frame)
    if (now - last < 33) return // about 30 updates a second is plenty for a soft glow
    last = now
    const reduce = root.dataset.reduceMotion === 'on'
    const analyser = engineAnalyser()
    let targetEnergy = 0
    let targetHue = hue
    if (!reduce && analyser && isLive()) {
      if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(bins)
      const hz = analyser.context.sampleRate / analyser.fftSize
      const band = (lo: number, hi: number) => {
        let sum = 0
        const a = Math.max(1, Math.floor(lo / hz))
        const b = Math.min(bins!.length - 1, Math.ceil(hi / hz))
        for (let i = a; i <= b; i++) sum += bins![i]
        return sum / ((b - a + 1) * 255)
      }
      const bass = band(30, 180)
      const mids = band(180, 2500)
      const treble = band(2500, 12000)
      targetEnergy = Math.min(1, bass * 0.9 + mids * 0.6 + treble * 0.5)
      // bassy passages lean warm (negative turn), bright ones cool (positive)
      targetHue = (treble * 1.6 - bass) * 70
    }
    // quick to rise, slow to fall, like a level meter
    energy += (targetEnergy - energy) * (targetEnergy > energy ? 0.45 : 0.08)
    hue += (targetHue - hue) * 0.05
    put('--wash-energy', energy.toFixed(2))
    put('--wash-hue', `${hue.toFixed(0)}deg`)

    // Automatic contrast check for Party / Game Show top text:
    // If the bright rainbow wash sweeps through high-luminance hues with high energy, invert top text
    const isGameshow = root.dataset.style === 'gameshow'
    const normHue = (((hue % 360) + 360) % 360)
    const highLuminanceHue = (normHue >= 30 && normHue <= 190)
    const isWashBright = isGameshow && energy >= 0.42 && highLuminanceHue
    if (isWashBright) {
      put('--top-contrast-text', '#0d0d11')
      put('--top-text-shadow', '0 0 8px rgba(255, 255, 255, 0.95), 0 1px 3px rgba(255, 255, 255, 0.8)')
    } else {
      put('--top-contrast-text', '#ffffff')
      put('--top-text-shadow', '0 2px 8px rgba(0, 0, 0, 0.85), 0 1px 3px rgba(0, 0, 0, 0.95)')
    }
  }
  const schedule = () => {
    if (!document.hidden && !covered && !raf) raf = requestAnimationFrame(frame)
  }
  wake = schedule
  document.addEventListener('visibilitychange', schedule)
  schedule()
}

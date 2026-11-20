import { useEffect, useRef } from 'react'
import { easeInOutCubic } from './motion'
import { engineAnalyser, isDirectOutput } from './engine'
import { getSetting } from './settings/store'

/**
 * §95: the seek track's played part, after Samsung's media player (One UI 8): a solid bar with two soft, see-through
 * humps riding on it and drifting right. They sink flat on pause and rise again on play. "Moving with the music"
 * (the default) makes the humps follow the music's level against the song's own recent average.
 */
export const WAVE = {
  /** Tallest hump at a song's usual level, px above the bar. */
  height: 10,
  /** The two layers' lengths as shares of the played part, and their drift (px/s). */
  long: 1.1, short: 0.75, driftLong: 80, driftShort: 52,
  /** Humps fade in over this much at the start and before the handle. */
  fade: 28,
  rampMs: 400, tickMs: 16,
}

/** "Squiggly": the earlier thin sine line (Mornye's expressive_seek_track.dart). */
export const SQUIGGLE = { amplitude: 3, wavelength: 40, stroke: 4, loopMs: 1800 }

/** Height of the squiggle at `x`. A rising phase moves it left. */
export function waveY(x: number, phase: number, amount: number): number {
  return SQUIGGLE.amplitude * amount * Math.sin(phase + (x * 2 * Math.PI) / SQUIGGLE.wavelength)
}

/** One layer's height at `x` (0 to 1): a rounded hump every `length` px, never below the bar. */
export function humpAt(x: number, length: number, shift: number): number {
  const s = Math.sin(((x - shift) / length) * 2 * Math.PI)
  return s > 0 ? s ** 1.6 : 0
}

/** Fades the humps to nothing over `WAVE.fade` px at both ends of the played part. */
export function edgeFade(x: number, start: number, end: number): number {
  const t = Math.min(x - start, end - x) / WAVE.fade
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)
}

/**
 * The level's pull on the humps' height: 1 at the song's recent average, lower in quiet parts, taller in loud ones.
 * Rises in about 150 ms and falls in about 700 ms, so it breathes with the music instead of flickering.
 */
export function levelStep(state: { mean: number; amount: number }, db: number, dtMs: number) {
  state.mean += (db - state.mean) * Math.min(1, dtMs / 6000)
  // 6 dB over the song's average doubles the humps; quiet parts settle to a quarter
  const target = Math.min(2, Math.max(0.25, 1 + (db - state.mean) / 6))
  const tau = target > state.amount ? 150 : 700
  state.amount += (target - state.amount) * Math.min(1, dtMs / tau)
  return state.amount
}

const samples = new Float32Array(2048)
/** The music's level now, in dB; null with no meter (Direct USB output skips it) or nothing playing through it. */
function levelDb(): number | null {
  const meter = engineAnalyser()
  if (!meter || isDirectOutput()) return null
  meter.getFloatTimeDomainData(samples)
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)
  return rms < 1e-4 ? null : 20 * Math.log10(rms)
}

export type WaveMode = 'Waves' | 'Squiggly' | 'Flat'
const waveMode = (): WaveMode => {
  const saved = getSetting('seekwave')
  // "Moving with the music" was the first name of Waves
  return saved === 'Squiggly' || saved === 'Flat' ? saved : 'Waves'
}

/** The played part of a seek track. `compact`: the phone mini player's thin top line (no handle, smaller humps). */
export function WaveTrack({ share, moving, compact = false }: { share: number; moving: boolean; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ share, ramp: 0, color: '', draw: () => {} })
  state.current.share = share

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const s = state.current
    // the colour, read once here and on each position update instead of on every frame
    s.color = getComputedStyle(el).color
    const mode = waveMode()
    const level = { mean: -18, amount: 1 }
    const squiggly = mode === 'Squiggly' && !compact
    const bar = compact ? 3 : squiggly ? SQUIGGLE.stroke : 6
    const tallest = compact ? 7 : WAVE.height
    // the canvas size, from the resize watcher: reading it while drawing would force a layout pass on every frame
    let w = el.clientWidth
    let h = el.clientHeight
    let drawnRamp = -1
    let frame = 0
    // stop drawing while the track can't be seen: scrolled away, a hidden panel, or the window minimised
    let onScreen = true
    let last = 0
    let lastTick = 0

    s.draw = () => {
      // a soft wave needs no more than 2 pixels per point: a phone's 3x screen would triple the work for nothing
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
        el.width = Math.round(w * ratio)
        el.height = Math.round(h * ratio)
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // the bar sits where the flat track was (10 px up from the bottom of the full-size slider); stops short of the handle
      const y = compact ? h - bar / 2 : h - 10
      const start = compact ? 0 : bar / 2
      const end = compact ? w * s.share : w * s.share - 6 - bar / 2
      if (end <= start) return
      ctx.strokeStyle = ctx.fillStyle = s.color
      ctx.lineWidth = bar
      ctx.lineCap = compact ? 'butt' : 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      if (squiggly) {
        const phase = ((performance.now() % SQUIGGLE.loopMs) / SQUIGGLE.loopMs) * 2 * Math.PI
        const amount = easeInOutCubic(s.ramp)
        for (let x = start; ; x += 2) {
          const at = Math.min(x, end)
          if (at === start) ctx.moveTo(at, y + waveY(at, phase, amount))
          else ctx.lineTo(at, y + waveY(at, phase, amount))
          if (at === end) break
        }
        ctx.stroke()
        return
      }
      ctx.moveTo(start, y)
      ctx.lineTo(end, y)
      ctx.stroke()
      const lift = Math.min(y - bar / 2 - 1, easeInOutCubic(s.ramp) * tallest * level.amount)
      if (lift < 0.2 || end - start < WAVE.fade) return
      const t = performance.now() / 1000
      const span = Math.max(120, end - start)
      const top = y - bar / 2 + 0.5
      ctx.globalAlpha = 0.45
      for (const [share_, drift, weight] of [[WAVE.long, WAVE.driftLong, 1], [WAVE.short, WAVE.driftShort, 0.7]] as const) {
        const length = span * share_
        ctx.beginPath()
        ctx.moveTo(start, top)
        for (let x = start; x <= end; x += 4) ctx.lineTo(x, top - lift * weight * humpAt(x, length, t * drift) * edgeFade(x, start, end))
        ctx.lineTo(end, top)
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const target = moving && mode !== 'Flat' ? 1 : 0
    const tick = (now: number) => {
      if (!onScreen || document.hidden) {
        frame = 0
        last = 0
        return
      }
      const dt = last ? now - last : 0
      last = now
      s.ramp = target ? Math.min(1, s.ramp + dt / WAVE.rampMs) : Math.max(0, s.ramp - dt / WAVE.rampMs)
      if (mode === 'Waves' && dt) {
        const db = levelDb()
        // no reading (Direct USB, a gap between songs): drift back to the usual height
        levelStep(level, db ?? level.mean, dt)
      }
      // at most 60 a second; the frame that finishes a ramp is drawn at once. (This used to also pass on every frame
      // once the ramp was done, so a playing wave redrew at the screen's full rate: 100-120 a second.)
      const rampDone = s.ramp === target && drawnRamp !== s.ramp
      if (now - lastTick >= WAVE.tickMs || rampDone) {
        lastTick = now
        drawnRamp = s.ramp
        s.draw()
      }
      if (target === 1 || s.ramp > 0) frame = requestAnimationFrame(tick)
    }
    const kick = () => {
      if (!frame && onScreen && !document.hidden && (target === 1 || s.ramp > 0)) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const sizes = new ResizeObserver(() => {
      w = el.clientWidth
      h = el.clientHeight
      s.draw()
    })
    sizes.observe(el)
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      kick()
    })
    seen.observe(el)
    document.addEventListener('visibilitychange', kick)
    return () => {
      cancelAnimationFrame(frame)
      sizes.disconnect()
      seen.disconnect()
      document.removeEventListener('visibilitychange', kick)
    }
  }, [moving, compact])

  // position changes while the wave is still have to repaint (a moving wave repaints on its own); the colour is
  // looked up again only now and then, since a style lookup on every position update costs a layout pass
  const lastColor = useRef(0)
  useEffect(() => {
    const s = state.current
    if (s.ramp > 0) return
    if (canvas.current && performance.now() - lastColor.current > 1000) {
      lastColor.current = performance.now()
      s.color = getComputedStyle(canvas.current).color
    }
    s.draw()
  }, [share])

  return <canvas ref={canvas} className={`ms-wave${compact ? ' compact' : ''}`} aria-hidden="true" />
}

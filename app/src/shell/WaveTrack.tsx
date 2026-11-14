import { useEffect, useRef } from 'react'
import { easeInOutCubic } from './motion'

// Mornye's expressive_seek_track.dart and decorative_phase.dart
export const WAVE = { amplitude: 3, wavelength: 40, stroke: 4, loopMs: 1800, rampMs: 300, tickMs: 34 }

/** Height of the wave at `x`. A rising phase moves it left. */
export function waveY(x: number, phase: number, amount: number): number {
  return WAVE.amplitude * amount * Math.sin(phase + (x * 2 * Math.PI) / WAVE.wavelength)
}

/** The played part of the seek track: a straight line that ramps into a moving sine while `moving`. */
export function WaveTrack({ share, moving }: { share: number; moving: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ share, ramp: 0, color: '', draw: () => {} })
  state.current.share = share

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const s = state.current
    // the stroke colour, read once here and on each position update instead of on every frame
    s.color = getComputedStyle(el).color
    let frame = 0
    // stop drawing while the track can't be seen: scrolled away, a hidden panel, or the window minimised
    let onScreen = true
    let last = 0
    let lastTick = 0

    s.draw = () => {
      const ratio = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
        el.width = Math.round(w * ratio)
        el.height = Math.round(h * ratio)
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // stops short of the handle, like the flat track did
      const end = w * s.share - 6 - WAVE.stroke / 2
      if (end <= WAVE.stroke / 2) return
      const amount = easeInOutCubic(s.ramp)
      const phase = ((performance.now() % WAVE.loopMs) / WAVE.loopMs) * 2 * Math.PI
      ctx.beginPath()
      for (let x = WAVE.stroke / 2; ; x += 2) {
        const at = Math.min(x, end)
        const y = h / 2 + waveY(at, phase, amount)
        if (at === WAVE.stroke / 2) ctx.moveTo(at, y)
        else ctx.lineTo(at, y)
        if (at === end) break
      }
      ctx.lineWidth = WAVE.stroke
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = s.color
      ctx.stroke()
    }

    const target = moving ? 1 : 0
    const tick = (now: number) => {
      if (!onScreen || document.hidden) {
        frame = 0
        last = 0
        return
      }
      const step = last ? (now - last) / WAVE.rampMs : 0
      last = now
      s.ramp = target ? Math.min(1, s.ramp + step) : Math.max(0, s.ramp - step)
      if (now - lastTick >= WAVE.tickMs || s.ramp === target) {
        lastTick = now
        s.draw()
      }
      if (target === 1 || s.ramp > 0) frame = requestAnimationFrame(tick)
    }
    const kick = () => {
      if (!frame && onScreen && !document.hidden && (target === 1 || s.ramp > 0)) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const sizes = new ResizeObserver(() => s.draw())
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
  }, [moving])

  // position changes while the wave is flat still have to repaint
  useEffect(() => {
    if (canvas.current) state.current.color = getComputedStyle(canvas.current).color
    state.current.draw()
  }, [share])

  return <canvas ref={canvas} className="ms-wave" aria-hidden="true" />
}

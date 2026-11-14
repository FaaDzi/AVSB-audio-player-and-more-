import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Position of a spring released from 0 towards 1 at rest, mass 1, `t` in seconds. Same formula as Flutter's SpringSimulation. */
export function springAt(t: number, stiffness: number, ratio: number): number {
  const w = Math.sqrt(stiffness)
  if (ratio >= 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const damped = w * Math.sqrt(1 - ratio * ratio)
  return 1 - Math.exp(-ratio * w * t) * (Math.cos(damped * t) + ((ratio * w) / damped) * Math.sin(damped * t))
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * How far a lyric row below the current line lags behind the list while it scrolls, as a share of the scroll distance.
 * Mornye's lyric_scroll_motion.dart: list spring 196/1 over 550ms, rows spring 121/0.85, 35ms later per row up to 6.
 */
export function lyricLag(ms: number, rowsAfterFocus: number): number {
  if (ms >= 800 || rowsAfterFocus <= 0) return 0
  const t = ms / 1000
  const delay = Math.min(Math.max(rowsAfterFocus, 1), 6) * 0.035
  return lyricScrollAt(ms) - (t <= delay ? 0 : springAt(t - delay, 121, 0.85))
}

/** Scroll progress of the list, scaled so it lands exactly on the line at 550ms. */
export function lyricScrollAt(ms: number): number {
  return springAt(Math.min(ms, 550) / 1000, 196, 1) / springAt(0.55, 196, 1)
}

/** Keeps the last non-null value for `ms` after it goes null, so a panel can animate out before unmounting. */
export function useHeld<T>(value: T | null, ms: number): T | null {
  const [held, setHeld] = useState(value)
  if (value !== null && value !== held) setHeld(value)
  useEffect(() => {
    if (value !== null) return
    const id = window.setTimeout(() => setHeld(null), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return value ?? held
}

/** The previous value, for `ms` after `value` changes. Null the rest of the time. */
export function useLeaving<T>(value: T, ms: number): T | null {
  const [state, setState] = useState<{ now: T; leaving: T | null }>({ now: value, leaving: null })
  if (state.now !== value) setState({ now: value, leaving: state.now })
  const leaving = state.now === value ? state.leaving : state.now
  useEffect(() => {
    if (leaving === null) return
    const id = window.setTimeout(() => setState((s) => ({ ...s, leaving: null })), ms)
    return () => window.clearTimeout(id)
  }, [leaving, ms])
  return leaving
}

/**
 * Plays an exit for menus and dialogs without every caller having to delay its unmount:
 * when the element really goes away, an inert copy takes its place and runs the `.ms-exit` animation.
 */
export function useExitCopy(ref: RefObject<HTMLElement | null>, ms: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    return () => {
      const copy = el.cloneNode(true) as HTMLElement
      // StrictMode runs this cleanup with the element still in place; only a real unmount leaves it disconnected
      queueMicrotask(() => {
        if (el.isConnected) return
        copy.classList.add('ms-exit')
        copy.setAttribute('aria-hidden', 'true')
        copy.inert = true
        document.body.append(copy)
        window.setTimeout(() => copy.remove(), ms)
      })
    }
  }, [ref, ms])
}

const RIPPLE_TARGETS = '.ms-dest-pill, .ms-rail-row, .ms-tr:not(.head), .ms-tool, .ms-btn, .ms-iconbtn, .ms-play, .ms-np-play, .ms-np-step'

/**
 * Press ink as measured on the running app: speckled ink spreads from about 33ms to 167ms after the press,
 * then a flat highlight holds until release.
 */
export function installRipple(): () => void {
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return
    const host = e.target.closest<HTMLElement>(RIPPLE_TARGETS)
    if (!host) return
    const box = host.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    const radius = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y))
    const ink = document.createElement('span')
    ink.className = 'ms-ripple'
    ink.style.cssText = `left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px`
    const flat = document.createElement('span')
    flat.className = 'ms-ripple-flat'
    host.append(flat, ink)
    ink.animate([{ transform: 'scale(0.1)', opacity: 0.22 }, { transform: 'scale(1)', opacity: 0.22, offset: 0.7 }, { transform: 'scale(1)', opacity: 0 }], { duration: 240, delay: 33, easing: 'ease-out', fill: 'both' }).onfinish = () => ink.remove()
    flat.animate([{ opacity: 0 }, { opacity: 0.1 }], { duration: 167, fill: 'forwards' })
    const release = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      flat.animate([{ opacity: 0.1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).onfinish = () => flat.remove()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  }
  document.addEventListener('pointerdown', down)
  return () => document.removeEventListener('pointerdown', down)
}

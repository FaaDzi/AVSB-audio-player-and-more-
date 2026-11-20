// §92 sleep timer: stop after a time, after N more songs, or at the end of this song. The music fades out (the
// player's own fade) and pauses; Shell runs the check once a second while something plays.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { clearQueuedNext, fadeOutForSleep, livePosition } from './engine'
import type { Track } from './library'
import { IconButton, Menu } from './ui'

export type SleepTimer =
  | { kind: 'off' }
  | { kind: 'time'; endsAt: number }
  /** `left` more songs after the one with `songId`; 0 = stop at the end of it. */
  | { kind: 'songs'; left: number; songId: string }

let state: SleepTimer = { kind: 'off' }
const listeners = new Set<() => void>()
export const getSleepTimer = () => state
export function setSleepTimer(next: SleepTimer) {
  state = next
  listeners.forEach((l) => l())
}
export const useSleepTimer = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

/** How long the timed stop fades out. */
export const SLEEP_FADE_S = 12

/**
 * What the timer wants now: null = keep playing, a number = fade out over that many seconds and pause, 'expired' =
 * the time ran out while nothing played (turn it off without stopping the music the user starts later).
 */
export function sleepStep(t: SleepTimer, now: number, songLeftS: number): number | 'expired' | null {
  if (t.kind === 'time') {
    const left = (t.endsAt - now) / 1000
    if (left < -2) return 'expired'
    return left <= SLEEP_FADE_S ? Math.max(0.5, left) : null
  }
  if (t.kind === 'songs' && t.left === 0) return songLeftS <= 6 ? Math.max(0.3, songLeftS - 0.4) : null
  return null
}

/** The next song started: one fewer to go. */
export function countSong(t: SleepTimer, songId: string): SleepTimer {
  if (t.kind !== 'songs' || t.songId === songId) return t
  return t.left > 0 ? { kind: 'songs', left: t.left - 1, songId } : t
}

/** The song playing is the last one: nothing is queued after it (no gapless start, no crossfade into the next). */
export const sleepStopsAfterThisSong = () => state.kind === 'songs' && state.left === 0

export function sleepLabel(t: SleepTimer, now: number): string {
  if (t.kind === 'time') {
    const s = Math.max(0, Math.round((t.endsAt - now) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  if (t.kind === 'songs') return t.left === 0 ? 'End of song' : `${t.left + 1} songs`
  return ''
}

/** Shell's side: counts songs and starts the fade when it's time. */
export function useSleepTimerRunner(current: Track | null, playing: boolean, pause: () => void) {
  const timer = useSleepTimer()
  const fading = useRef(false)
  useEffect(() => {
    if (!current) return
    const before = getSleepTimer()
    // the last counted song ended anyway (skipped, or a crossfade got in first): stop right at the new one's start
    if (before.kind === 'songs' && before.left === 0 && before.songId !== current.id) {
      setSleepTimer({ kind: 'off' })
      pause()
      return
    }
    const after = countSong(before, current.id)
    setSleepTimer(after)
    if (after !== before && after.kind === 'songs' && after.left === 0) clearQueuedNext()
  }, [current, pause])
  useEffect(() => {
    if (timer.kind === 'off') return
    const id = window.setInterval(() => {
      if (fading.current) return
      const step = sleepStep(getSleepTimer(), Date.now(), (current?.sec ?? 0) - livePosition())
      if (step === 'expired') return setSleepTimer({ kind: 'off' })
      if (step === null || !playing) return
      fading.current = true
      void fadeOutForSleep(step).then((done) => {
        fading.current = false
        if (!done) return
        setSleepTimer({ kind: 'off' })
        pause()
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [timer, current, playing, pause])
}

/** The moon button (Now Playing, PC player bar): the menu of choices, and the time left while it runs. */
export function SleepButton({ current }: { current: Track | null }) {
  const timer = useSleepTimer()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (timer.kind !== 'time') return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [timer])
  const minutes = (m: number) => () => setSleepTimer({ kind: 'time', endsAt: Date.now() + m * 60_000 })
  const songs = (left: number) => () => {
    if (!current) return
    setSleepTimer({ kind: 'songs', left, songId: current.id })
    if (left === 0) clearQueuedNext()
  }
  const on = timer.kind !== 'off'
  const label = sleepLabel(timer, Date.now())
  return (
    <span className={`ms-sleep${on ? ' on' : ''}`}>
      <IconButton
        icon="bedtime"
        label={on ? `Sleep timer: ${label}` : 'Sleep timer'}
        filled={on}
        active={on}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.top - 8 })
        }}
      />
      {on && <span className="ms-sleep-left">{label}</span>}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          compact
          onClose={() => setMenu(null)}
          items={[
            { label: 'Sleep timer', heading: true },
            ...[15, 30, 45, 60].map((m) => ({ label: `${m} minutes`, checked: false, onSelect: minutes(m) })),
            { label: 'End of this song', checked: timer.kind === 'songs' && timer.left === 0, onSelect: songs(0) },
            ...[2, 3, 5].map((n) => ({ label: `After ${n} songs`, checked: timer.kind === 'songs' && timer.left === n - 1, onSelect: songs(n - 1) })),
            ...(on ? [{ label: 'Turn off', icon: 'close', divider: true, onSelect: () => setSleepTimer({ kind: 'off' }) }] : []),
          ]}
        />
      )}
    </span>
  )
}

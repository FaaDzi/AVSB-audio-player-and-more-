import { useSyncExternalStore } from 'react'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LogLine = [time: string, level: LogLevel, tag: string, message: string]

const LIMIT = 500
const CRASH_KEY = 'shell.lastCrash'
let lines: LogLine[] = []
const listeners = new Set<() => void>()

const clock = () => new Date().toTimeString().slice(0, 8) + '.' + String(new Date().getMilliseconds()).padStart(3, '0')

export function logLine(level: LogLevel, tag: string, message: string) {
  lines = [...lines.slice(-(LIMIT - 1)), [clock(), level, tag, message]]
  // §88 A: player and network lines also reach the Android log (adb logcat), so timings survive a page restart;
  // §94 A: so do the background jobs' (Details) lines
  if (tag === 'Player' || tag === 'Network' || tag === 'Details') console.info(`[AVSB ${tag}] ${message}`)
  listeners.forEach((l) => l())
}

export function clearLogs() {
  lines = []
  listeners.forEach((l) => l())
}

export const useLogs = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => lines)

/** The error that ended the last session, if one did. */
export const lastCrash = (): string | null => { try { return localStorage.getItem(CRASH_KEY) } catch { return null } }
export const clearCrash = () => { try { localStorage.removeItem(CRASH_KEY) } catch { /* nothing to clear */ } }

let started = false

/** Collects page errors into the log, and keeps the last uncaught one for the next session's crash banner. */
export function startLogs() {
  if (started) return
  started = true
  logLine('INFO', 'App', 'Started')
  const recovered = new URLSearchParams(window.location.search).get('recovered')
  if (recovered) {
    logLine('ERROR', 'App', `The page stopped (${recovered}) and was restarted`)
    try { localStorage.setItem(CRASH_KEY, `${new Date().toISOString()} The page stopped (${recovered}) and was restarted`) } catch { /* storage full */ }
  }
  window.addEventListener('error', (e) => {
    logLine('ERROR', 'App', e.message)
    try { localStorage.setItem(CRASH_KEY, `${new Date().toISOString()} ${e.message}`) } catch { /* storage full */ }
  })
  window.addEventListener('unhandledrejection', (e) => logLine('ERROR', 'App', String(e.reason)))
  const warn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    logLine('WARN', 'Console', args.map(String).join(' '))
    warn(...args)
  }
}

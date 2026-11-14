import { useState } from 'react'
import { DjTipsSvg } from './Art'
import type { HostQuip } from './announcer'

const DJ_TIPS_KEY = 'dj-tips-enabled'

export function isDjTipsEnabled(): boolean {
  try {
    const v = localStorage.getItem(DJ_TIPS_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

export function setDjTipsEnabled(on: boolean) {
  try {
    localStorage.setItem(DJ_TIPS_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function HostBanner(props: { quip: HostQuip; compact?: boolean; enabled?: boolean }) {
  const { quip, compact, enabled = isDjTipsEnabled() } = props
  // on phones the line is clamped to two lines; a tap shows the rest (reset when the line changes)
  const [openText, setOpenText] = useState<string | null>(null)
  if (!enabled) return null
  const expanded = openText === quip.text

  const svgMood =
    quip.mood === 'crown'
      ? 'crown'
      : quip.mood === 'upset' || quip.mood === 'snark' || quip.mood === 'warn'
        ? 'roast'
        : quip.mood === 'hype'
          ? 'hype'
          : 'normal'

  return (
    <div className={`dj-tips-bar mood-${quip.mood} ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
      <div className="dj-tips-avatar-wrap">
        <DjTipsSvg mood={svgMood} size={compact ? 56 : 70} />
        <span className="dj-tips-nametag">DJ TIPS</span>
      </div>
      <div
        className={`dj-tips-bubble ${expanded ? 'expanded' : ''}`}
        onClick={() => setOpenText(expanded ? null : quip.text)}
      >
        {quip.badge && <div className="dj-tips-kicker">{quip.badge}</div>}
        <p className="dj-tips-line">{quip.text}</p>
      </div>
    </div>
  )
}

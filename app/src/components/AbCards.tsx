import { useEffect } from 'react'

/**
 * A blind A/B as two cards: tapping a card is what you hear (it glows and says LISTENING), the
 * button at its foot is the only way to choose it. Keys: 1 / 2 listen, Enter picks the one on.
 */
export function AbCards(props: {
  labels: [string, string]
  /** Which side you're hearing. */
  active: number
  playing: boolean
  disabled?: boolean
  onListen: (i: number) => void
  onPick: (i: number) => void
  pickText: (label: string) => string
}) {
  const { active, disabled, onListen, onPick } = props
  useEffect(() => {
    if (disabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, button')) return
      if (e.key === '1' || e.key === '2') onListen(Number(e.key) - 1)
      else if (e.key === 'Enter') onPick(active)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, disabled, onListen, onPick])

  return (
    <div className="ab-cards">
      {props.labels.map((l, i) => {
        const on = active === i
        return (
          <div key={l} className={`ab-card side-${i} ${on ? 'on' : ''} ${on && props.playing ? 'live' : ''}`}>
            <button type="button" className="ab-card-listen" aria-pressed={on} disabled={disabled} onClick={() => onListen(i)}>
              <span className="ab-letter">{l}</span>
              <span className="ab-bars" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="ab-state">{on ? (props.playing ? 'Listening' : 'Paused') : 'Tap to listen'}</span>
            </button>
            <button type="button" className="game-btn-primary ab-pick" disabled={disabled} onClick={() => onPick(i)}>
              {props.pickText(l)}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** "Round 2 of 6" with a dot per round. */
export function RoundDots(props: { round: number; of: number }) {
  return (
    <div className="ab-progress" aria-label={`Round ${props.round} of ${props.of}`}>
      <span className="ab-progress-text">
        Round {props.round} of {props.of}
      </span>
      <span className="ab-dots" aria-hidden="true">
        {Array.from({ length: props.of }, (_, i) => (
          <i key={i} className={i < props.round - 1 ? 'done' : i === props.round - 1 ? 'now' : ''} />
        ))}
      </span>
    </div>
  )
}

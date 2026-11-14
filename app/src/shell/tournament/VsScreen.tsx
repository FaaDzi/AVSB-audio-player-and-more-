// The VS screen (§65 step 4): a modern game-show take on the old intro. A random fluid burst covers the bracket, the
// contenders slam in along the diagonal over speed lines in their kind's colours, and the first song decodes meanwhile.
// Click, Space or Enter starts the match under a second burst.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'
import { sfx } from '../../audio/sfx'
import { playFireWipe, wipeStyleFor } from '../../game/fireWipe'
import { VsSpeedLines } from '../../game/VsSpeedLines'
import type { LinesKind } from '../../game/vsLinesColors'
import { warmRoundAudio } from './MatchPage'

export interface VsSide {
  name: string
  photo: string | null
  seed: number | null
  kind: LinesKind
  masked: boolean
  /** What it is, shown even when the name is hidden: "IEM", "TWS", "Headphones · Open back". */
  detail: string
}

export function VsScreen({ left, right, round, stakes, ready, onStart }: {
  left: VsSide
  right: VsSide
  /** "Upper bracket · Round 1 · Match 3 of 14 · Best of 3" */
  round: string
  stakes: string
  /** Settles when the first song is decoded: until then the screen doubles as the loading screen. */
  ready: Promise<unknown>
  onStart: () => void
}) {
  const [shown, setShown] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [pending, setPending] = useState(false)
  const started = useRef(false)
  // a phone or tablet: no Enter key to mention
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  useEffect(() => {
    let live = true
    warmRoundAudio(ready).then(() => live && setLoaded(true), () => live && setLoaded(true))
    playFireWipe(() => {
      if (!live) return
      setShown(true)
      sfx.playFlameClash(0.8)
    }, 0, wipeStyleFor())
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = () => {
    if (started.current) return
    started.current = true
    setLeaving(true)
    sfx.playFlameIgnite(0.8)
    playFireWipe(onStart, 0.3, wipeStyleFor())
  }
  const proceed = () => {
    if (!shown || started.current) return
    if (loaded) go()
    else setPending(true)
  }
  useEffect(() => {
    if (loaded && pending) go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pending])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        proceed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const side = (s: VsSide, which: 'a' | 'b') => (
    <div className={`ms-vs-fighter ${which} ${s.kind}`}>
      <div className="ms-vs-photo">
        {s.masked ? (
          <span className={`ms-vs-mystery letter ${which}`} aria-hidden="true">{which.toUpperCase()}</span>
        ) : s.photo ? (
          <img src={s.photo} alt="" />
        ) : (
          <span className="ms-vs-mystery"><Icon name="headphones" size={64} /></span>
        )}
      </div>
      <div className="ms-vs-label">
        <span className="ms-vs-corner">Corner {which.toUpperCase()}{s.seed ? ` · Seed ${s.seed}` : ''}</span>
        <span className="ms-vs-kind">{s.detail}</span>
        <b>{s.masked ? 'Mystery contender' : s.name}</b>
      </div>
    </div>
  )

  const node = !shown ? (
    <div className="ms-vs hidden" aria-hidden="true" />
  ) : (
    <div className={`ms-vs${leaving ? ' leaving' : ''}`} role="button" tabIndex={0} onClick={proceed} aria-label="Start the match">
      <VsSpeedLines gearA={left.kind} gearB={right.kind} />
      <div className="ms-vs-shade" aria-hidden="true" />
      <div className="ms-vs-round">{round}</div>
      {side(left, 'a')}
      {side(right, 'b')}
      <div className="ms-vs-badge" aria-hidden="true"><span>V</span><span>S</span></div>
      <div className="ms-vs-foot">
        <span className={`ms-vs-prompt${loaded ? '' : ' loading'}`} aria-live="polite">
          {loaded ? (touch ? 'Tap to start' : 'Click or press Enter to start') : pending ? 'Starting as soon as the song is ready…' : 'Loading the first song…'}
        </span>
        <small>{stakes}</small>
      </div>
    </div>
  )
  return createPortal(node, document.body)
}

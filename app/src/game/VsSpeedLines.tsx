import { useEffect, useId, useRef, useState } from 'react'
import { isReduceMotionEnabled } from './useStageInput'
import { channelTable, type LinesKind } from './vsLinesColors'

/**
 * VS scene background (§64): speed lines from one grey loop per window shape (public/fx/vs-lines-h.webm for
 * landscape, vs-lines-v.webm for portrait; white = streak, black = background), coloured live per kind by an
 * SVG colour map: a light shade for the background and a bold dark one for the streaks.
 * A cross-kind match splits the screen on the diagonal, each half in its own kind's colours.
 */
/** The upper-left half belongs to corner A, the lower-right to corner B (the same seam as the fighter banners). */
const HALF_A = 'polygon(0 0, 100% 0, 100% 34%, 0 66%)'
const HALF_B = 'polygon(100% 34%, 100% 100%, 0 100%, 0 66%)'

function usePortrait() {
  const q = '(orientation: portrait)'
  const [portrait, setPortrait] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setPortrait(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return portrait
}

function Layer(props: { kind: LinesKind; src: string; clip?: string; filterId: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const gameshow = typeof document !== 'undefined' && document.documentElement.dataset.style === 'gameshow'
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (isReduceMotionEnabled()) v.pause()
    else v.play().catch(() => {})
  }, [props.src])
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id={props.filterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={channelTable(props.kind, 0, gameshow)} />
            <feFuncG type="table" tableValues={channelTable(props.kind, 1, gameshow)} />
            <feFuncB type="table" tableValues={channelTable(props.kind, 2, gameshow)} />
          </feComponentTransfer>
        </filter>
      </svg>
      <video
        ref={ref}
        className="vs-lines-video"
        src={props.src}
        // black = background in the grey mask, so before the first frame the filter shows the plain light shade
        style={{ filter: `url(#${props.filterId})`, clipPath: props.clip, background: '#000' }}
        muted
        loop
        playsInline
        autoPlay={!isReduceMotionEnabled()}
        preload="auto"
        aria-hidden="true"
      />
    </>
  )
}

export function VsSpeedLines(props: { gearA: LinesKind; gearB: LinesKind }) {
  const portrait = usePortrait()
  const id = useId().replace(/:/g, '')
  const src = `${import.meta.env.BASE_URL}fx/vs-lines-${portrait ? 'v' : 'h'}.webm`
  return (
    <div className="vs-lines" aria-hidden="true">
      {props.gearA === props.gearB ? (
        <Layer kind={props.gearA} src={src} filterId={`vsl-${id}-a`} />
      ) : (
        <>
          <Layer kind={props.gearA} src={src} clip={HALF_A} filterId={`vsl-${id}-a`} />
          <Layer kind={props.gearB} src={src} clip={HALF_B} filterId={`vsl-${id}-b`} />
        </>
      )}
    </div>
  )
}

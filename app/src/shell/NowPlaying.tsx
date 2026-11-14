import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Cover, Icon, IconButton } from './ui'
import { useShell } from './context'
import { useLivePosition } from './engine'
import { Slider, VolumeControl } from './PlayerBar'
import { PanelSwap } from './SidePanels'
import { useHeld } from './motion'
import { useCoverStyle } from './cover'
import { coverUrl, duration, type Track } from './library'
import { host } from './host'
import { getSetting, useSettings } from './settings/store'
import { applyTheme, resolveStyleScope } from './theme'
import { setSystemAppearance } from '../platform'
import { GearCircleIndicator } from './sound/GearCircleIndicator'
import { GearSwitch } from './sound/GearSwitch'
import { isLiked, toggleLike, useFavorites } from './favorites'
import { usePhone } from './PhoneNav'
import { PlaylistAddButton } from './pages/TrackMenu'
import { setWashCovered } from './rainbowPulse'
import { directQuality, useDirectView } from '../audio/directDac'

/** How long lyrics are left alone before the player shrinks. */
const COMPACT_AFTER_MS = 6000

const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 540px), (orientation: landscape) and (pointer: coarse)'
const landscapeMedia = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(LANDSCAPE_QUERY) : null
function useLandscapeSplit() {
  return useSyncExternalStore(
    (l) => {
      landscapeMedia?.addEventListener('change', l)
      return () => landscapeMedia?.removeEventListener('change', l)
    },
    () => landscapeMedia?.matches ?? false,
  )
}

/** The cover, or the song's animated one if that's turned on and it has one. */
function Artwork({ track, className, playing }: { track: Track; className: string; playing?: boolean }) {
  const [noMotion, setNoMotion] = useState('')
  const isParty = resolveStyleScope() === 'gameshow'

  if (!isParty) {
    if (getSetting('animated') && host() && noMotion !== track.id) {
      return <img className={className} alt={track.album} src={`/shell-host/motion?path=${encodeURIComponent(track.path)}`} onError={() => setNoMotion(track.id)} />
    }
    return <Cover id={track.cover} alt={track.album} className={className} genre={track.genre} speciality={track.category} title={track.title} />
  }

  return (
    <div className={`ms-vinyl-disc ${className} ${playing ? 'playing' : 'paused'}`}>
      {getSetting('animated') && host() && noMotion !== track.id ? (
        <img className="ms-cover-disc" alt={track.album} src={`/shell-host/motion?path=${encodeURIComponent(track.path)}`} onError={() => setNoMotion(track.id)} />
      ) : (
        <Cover id={track.cover} alt={track.album} className="ms-cover-disc" genre={track.genre} speciality={track.category} title={track.title} />
      )}
    </div>
  )
}

/** Auto-scrolling marquee text that smoothly glides back and forth when text overflows available width. */
function MarqueeText({ text, className, as: Tag = 'h1' }: { text: string; className?: string; as?: 'h1' | 'p' | 'span' | 'div' }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [distance, setDistance] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const el = textRef.current
    if (!container || !el) return
    const diff = el.scrollWidth - container.clientWidth
    if (diff > 4) {
      setOverflow(true)
      setDistance(diff)
    } else {
      setOverflow(false)
      setDistance(0)
    }
  }, [text])

  const durationSec = Math.max(6, Math.min(22, distance / 24 + 4))

  return (
    <div
      ref={containerRef}
      className={`ms-marquee-container${overflow ? ' overflow' : ''}${className ? ` ${className}` : ''}`}
      style={overflow ? ({ '--marquee-dist': `-${distance}px`, '--marquee-dur': `${durationSec}s` } as React.CSSProperties) : undefined}
    >
      <Tag className="ms-marquee-inner">
        <span ref={textRef} className={`ms-marquee-text${overflow ? ' scrolling' : ''}`}>
          {text}
        </span>
      </Tag>
    </div>
  )
}

/** Takes the whole window over a blurred copy of the cover. Lyrics or the queue slide in beside the player. */
export function NowPlaying() {
  const position = useLivePosition()
  const { current, playing, loading, volume, panel, repeat, shuffle, setPanel, setPlaying, setPosition, setVolume, setNowPlaying, setRepeat, setShuffle, step, push, data, replaceData } = useShell()
  useFavorites()
  const landscape = useLandscapeSplit()
  // portrait phone: heart and + get their own row above the controls (the title keeps the full width), and the
  // gear circle joins the headphones in the middle of the bottom pill
  const phonePortrait = usePhone() && !landscape
  // the page wash behind Now Playing can't be seen: stop animating it while this is open
  // and Now Playing is always dark: white bar icons over it, whatever the theme; the theme's own come back on close
  useEffect(() => {
    setWashCovered(true)
    setSystemAppearance(false, '#0a0a0a')
    return () => {
      setWashCovered(false)
      applyTheme()
    }
  }, [])
  const [landscapeTab, setLandscapeTab] = useState<'lyrics' | 'queue'>(() => (panel === 'queue' ? 'queue' : 'lyrics'))
  useEffect(() => {
    if (panel === 'lyrics' || panel === 'queue') setLandscapeTab(panel)
  }, [panel])
  const heldPanel = useHeld(panel, 260)
  const activeSidePanel = landscape ? landscapeTab : heldPanel
  const isClosing = !landscape && panel === null && heldPanel !== null
  const coverStyle = useCoverStyle(current?.cover, true)
  useSettings()
  const directView = useDirectView()
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef(0)
  const compactWanted = Boolean(getSetting('compact')) && panel === 'lyrics' && !landscape
  const wake = () => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    if (compactWanted) idleTimer.current = window.setTimeout(() => setIdle(true), COMPACT_AFTER_MS)
  }
  useEffect(() => {
    setIdle(false)
    if (!compactWanted) return
    idleTimer.current = window.setTimeout(() => setIdle(true), COMPACT_AFTER_MS)
    return () => window.clearTimeout(idleTimer.current)
  }, [compactWanted])
  if (!current) return null
  const fullArt = getSetting('cover') === 'Full screen' && Boolean(current.cover) && !landscape
  // beside lyrics, the art can take the place of the song's details
  const artOnly = panel === 'lyrics' && Boolean(getSetting('artlyrics')) && !landscape
  const nextRepeat = { off: 'all', all: 'one', one: 'off' } as const
  const isLowData = getSetting('stream_quality') === 'Low Data (~128 kbps)' || Boolean(getSetting('lowdata'))
  const isPc = current.source === 'pc' || current.path.startsWith('pc:')
  // the engine clears this whenever a song leaves Direct to DAC; its path can be the PC's copy, not current.path
  const directInfo = directView.info
  const quality = directInfo
    ? directQuality(directInfo)
    : isLowData
      ? (isPc ? ['Low Data', '128 kbps'] : [current.format || 'Local', '0 MB Data'])
      : current.lossy
        ? [current.format, `${current.kbps} kbps`]
        : [current.format, `${current.bits}-bit`, `${(current.rate / 1000).toFixed(1).replace(/\.0$/, '')} kHz`]
  // a DAC is in but something keeps the song off Direct to DAC: name it (plan §77)
  if (!directInfo && directView.dac && directView.blocker && directView.blocker !== 'Direct off') quality.push(directView.blocker)

  const chooseTab = (target: 'lyrics' | 'queue') => {
    setLandscapeTab(target)
    if (landscape) {
      if (panel) setPanel(null)
    } else {
      setPanel(panel === target ? null : target)
    }
  }

  const saveButtons = (
    <>
      <IconButton
        icon={isLiked(current.id) ? 'favorite' : 'favorite_border'}
        label={isLiked(current.id) ? 'Remove from Favorites' : 'Add to Favorites'}
        active={isLiked(current.id)}
        className="ms-np-fav-btn"
        onClick={() => toggleLike(current, data, replaceData)}
      />
      <PlaylistAddButton track={current} />
    </>
  )

  return (
    <div className={`ms-np${panel || landscape ? ' split' : ''}${fullArt ? ' art-full' : ''}${artOnly ? ' art-only' : ''}${idle ? ' compact' : ''}`} style={coverStyle} role="dialog" aria-label="Now Playing" onPointerMove={wake}>
      {current.cover && <div className="ms-np-back" style={{ backgroundImage: `url(${coverUrl(current.cover)})` }} />}
      {fullArt && <Artwork track={current} className="ms-np-fullart" playing={playing} />}
      <div className="ms-np-close"><IconButton icon="close" label="Close" filled onClick={() => setNowPlaying(false)} /></div>
      <div className="ms-np-info"><IconButton icon="info" label="Track details & audio quality" filled onClick={() => { setPanel(null); setNowPlaying(false); push({ page: 'song', id: current.id }) }} /></div>
      <div className="ms-np-volume"><VolumeControl value={volume} onChange={setVolume} /></div>

      <section className="ms-np-player">
        {!fullArt && <Artwork track={current} className="ms-np-cover" playing={playing} />}
        <div className="ms-np-title-row">
          <MarqueeText as="h1" text={current.title} />
          {!phonePortrait && <div className="ms-np-title-actions">{saveButtons}</div>}
        </div>
        <MarqueeText as="p" text={[current.artist || 'Unknown Artist', current.album].filter(Boolean).join(' · ')} className="ms-np-artist" />
        <div className="ms-np-seek"><Slider wavy={playing && !(phonePortrait && panel)} value={current.sec ? position / current.sec : 0} label="Seek" onChange={(v) => setPosition(v * current.sec)} /></div>
        <div className="ms-np-times">
          <span>{duration(position)}</span>
          <span className="ms-np-quality"><Icon name={directInfo ? 'usb' : 'graphic_eq'} size={16} />{quality.join(' · ')}</span>
          <span>{duration(current.sec)}</span>
        </div>
        {phonePortrait && <div className="ms-np-actions">{saveButtons}</div>}
        <div className="ms-np-controls">
          <IconButton icon="shuffle" label={`Shuffle ${shuffle ? 'on' : 'off'}`} active={shuffle} onClick={() => setShuffle(!shuffle)} />
          <button type="button" className="ms-np-step" aria-label="Previous" onClick={() => step(-1)}><Icon name="skip_previous" fill size={28} /></button>
          <button type="button" className={`ms-np-play${playing ? ' on' : ''}`} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{loading ? <span className="ms-spinner" /> : <Icon name={playing ? 'pause' : 'play_arrow'} fill size={32} />}</button>
          <button type="button" className="ms-np-step" aria-label="Next" onClick={() => step(1)}><Icon name="skip_next" fill size={28} /></button>
          <IconButton icon={repeat === 'one' ? 'repeat_one' : 'repeat'} label={`Repeat ${repeat}`} active={repeat !== 'off'} onClick={() => setRepeat(nextRepeat[repeat])} />
        </div>
      </section>

      {idle && (
        <div className="ms-np-slim">
          <Cover id={current.cover} alt={current.album} className="ms-np-slim-art" genre={current.genre} speciality={current.category} title={current.title} />
          <span className="grow ms-ellipsis"><b>{current.title}</b> {current.artist}</span>
          <button type="button" className="ms-np-slim-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play_arrow'} fill size={24} /></button>
        </div>
      )}

      {activeSidePanel && (
        <section className={`ms-np-side${isClosing ? ' closing' : ''}`}>
          <div className="ms-np-side-tabs" role="tablist" aria-label="Now Playing side panel">
            <button
              type="button"
              role="tab"
              aria-selected={activeSidePanel === 'lyrics'}
              className={`ms-np-side-tab${activeSidePanel === 'lyrics' ? ' on' : ''}`}
              onClick={() => chooseTab('lyrics')}
            >
              <Icon name="lyrics" size={18} fill={activeSidePanel === 'lyrics'} />
              <span>Lyrics</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSidePanel === 'queue'}
              className={`ms-np-side-tab${activeSidePanel === 'queue' ? ' on' : ''}`}
              onClick={() => chooseTab('queue')}
            >
              <Icon name="queue_music" size={18} fill={activeSidePanel === 'queue'} />
              <span>Up next</span>
            </button>
            {landscape && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 4 }}>
                <GearCircleIndicator size={22} />
              </div>
            )}
          </div>
          <PanelSwap panel={activeSidePanel} />
        </section>
      )}

      <div className="ms-np-corner">
        <IconButton icon="lyrics" label="Lyrics" filled={(landscape ? activeSidePanel : panel) === 'lyrics'} onClick={() => chooseTab('lyrics')} />
        {phonePortrait ? (
          <span className="ms-np-corner-mid"><GearSwitch /><GearCircleIndicator size={22} /></span>
        ) : (
          <>
            {!landscape && <GearCircleIndicator size={24} />}
            <GearSwitch />
          </>
        )}
        <IconButton icon="queue_music" label="Up next" filled={(landscape ? activeSidePanel : panel) === 'queue'} onClick={() => chooseTab('queue')} />
      </div>
    </div>
  )
}

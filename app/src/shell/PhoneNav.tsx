// The phone layout (plan §70 B1): bottom tabs instead of the sidebar, and a mini player above them instead of the
// player bar, as in Mornye's phone captures. Database lives on Home (owner's answer, 2026-11-07), so four tabs.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Cover, Icon, IconButton } from './ui'
import { useShell, type Route } from './context'
import { useCoverStyle } from './cover'
import { isLiked, toggleLike, useFavorites } from './favorites'
import { useIsBuffering, useLivePosition } from './engine'
import { WaveTrack } from './WaveTrack'
import { PlaylistAddButton } from './pages/TrackMenu'

/**
 * The phone layout: a phone held upright (narrow), or turned sideways (short), or a very narrow window. Turned
 * sideways a phone is wider than 640 px but only about 400 px tall: the PC layout's sidebar and player bar don't fit.
 */
// a touch screen on its side counts as a phone only while short: a tablet in landscape (800+ px tall) gets the wide layout
const PHONE_QUERY = '(max-width: 640px), (max-height: 540px), (orientation: landscape) and (pointer: coarse) and (max-height: 600px)'

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null
export const usePhone = () =>
  useSyncExternalStore(
    (l) => {
      query?.addEventListener('change', l)
      return () => query?.removeEventListener('change', l)
    },
    () => query?.matches ?? false,
  )

const TABS = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'library', label: 'Library', icon: 'library_music' },
  { page: 'tournament', label: 'Tournament', icon: 'emoji_events' },
  { page: 'settings', label: 'Settings', icon: 'settings' },
] as const

/** Which tab a page belongs to: album, artist, song pages sit under Library; Database and gear pages under Home. */
export function tabOf(r: Route): (typeof TABS)[number]['page'] {
  switch (r.page) {
    case 'library': case 'album': case 'artist': case 'playlist': case 'song': case 'folder': return 'library'
    case 'tournament': return 'tournament'
    case 'settings': return 'settings'
    default: return 'home'
  }
}

export function PhoneTabs({ route, go }: { route: Route; go: (r: Route) => void }) {
  const on = tabOf(route)
  return (
    <nav className="ms-btabs" aria-label="Main">
      {TABS.map((t) => (
        <button type="button" key={t.page} className={`ms-btab${on === t.page ? ' on' : ''}`} aria-current={on === t.page ? 'page' : undefined} onClick={() => go({ page: t.page })}>
          <span className="ms-btab-pill"><Icon name={t.icon} fill={on === t.page} /></span>
          <span className="ms-btab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

/** The bar above the tabs: tap opens Now Playing; play/pause and next stay one tap away. */
/** §91 C: while songs are being picked, their actions take the mini player's place (Samsung Music). */
export interface SelectionAction { icon: string; label: string; onClick: () => void; disabled?: boolean }
let selectionBar: SelectionAction[] | null = null
const barListeners = new Set<() => void>()
export function setSelectionBar(actions: SelectionAction[] | null) {
  selectionBar = actions
  barListeners.forEach((l) => l())
}
const useSelectionBar = () => useSyncExternalStore((l) => { barListeners.add(l); return () => { barListeners.delete(l) } }, () => selectionBar)

export function PhoneMini() {
  const bar = useSelectionBar()
  if (bar) {
    return (
      <div className="ms-pselect" role="toolbar" aria-label="Selected songs">
        {bar.map((a) => (
          <button type="button" key={a.label} disabled={a.disabled} onClick={a.onClick}>
            <Icon name={a.icon} size={24} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    )
  }
  return <PhoneMiniPlayer />
}

function PhoneMiniPlayer() {
  const position = useLivePosition()
  const { current, playing, loading, setPlaying, setNowPlaying, step, data, replaceData, closed, closePlayer } = useShell()
  const isBuffering = useIsBuffering()
  useFavorites()
  const coverStyle = useCoverStyle(current?.cover)
  if (!current || closed) return null
  const done = current.sec ? Math.min(1, position / current.sec) : 0
  return (
    <div className="ms-pmini" style={coverStyle}>
      <WaveTrack share={done} moving={playing} compact />
      <button type="button" className="ms-pmini-open" aria-label="Open Now Playing" onClick={() => setNowPlaying(true)}>
        <div className={`ms-pmini-art-wrap ${playing ? 'playing' : 'paused'}`} style={{ position: 'relative', display: 'inline-flex', overflow: 'hidden', flex: 'none' }}>
          <Cover id={current.cover} className="ms-pmini-art" genre={current.genre} speciality={current.category} title={current.title} />
          {isBuffering && (
            <div className="ms-buffer-overlay" aria-label="Buffering">
              <div className="ms-spinner" />
            </div>
          )}
        </div>
        <span className="ms-player-text">
          <span className="ms-player-title">{current.title}</span>
          <span className="ms-player-artist">{current.artist || 'Unknown Artist'}</span>
        </span>
      </button>
      <IconButton icon="skip_previous" label="Previous" onClick={() => step(-1)} />
      <button type="button" className={`ms-play${playing ? ' on' : ''}`} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
        {loading ? <span className="ms-spinner" /> : <Icon name={playing ? 'pause' : 'play_arrow'} fill size={26} />}
      </button>
      <IconButton icon="skip_next" label="Next" onClick={() => step(1)} />
      <IconButton
        icon={isLiked(current.id) ? 'favorite' : 'favorite_border'}
        label={isLiked(current.id) ? 'Remove from Favorites' : 'Add to Favorites'}
        active={isLiked(current.id)}
        onClick={() => toggleLike(current, data, replaceData)}
      />
      {/* §104: shown in landscape only (phoneLayout.css); portrait has no room for it */}
      <PlaylistAddButton track={current} />
      <IconButton icon="close" label="Close player" onClick={closePlayer} />
    </div>
  )
}

export { onPhoneBack, runPhoneBack } from './phoneBack'

/**
 * Is the on-screen keyboard up? Android shrinks the page to make room for it, so a page much shorter than the tallest
 * seen at this width means it's open. (The tabs then hide: they rode up above the keyboard and covered search results.)
 */
export function useKeyboardOpen(on: boolean) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!on) return
    let tallest = window.innerHeight
    let width = window.innerWidth
    const check = () => {
      // turning the phone starts over; the keyboard can nudge the width by a few pixels, which doesn't count
      if (Math.abs(window.innerWidth - width) > 50) { width = window.innerWidth; tallest = window.innerHeight }
      tallest = Math.max(tallest, window.innerHeight)
      setOpen(window.innerHeight < tallest - 150)
    }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [on])
  return open
}

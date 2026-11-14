import { Icon, IconButton } from './ui'
import { useShell, type Route } from './context'
import { useMemo } from 'react'
import { useLibrary, visiblePlaylists } from './library'

const MAIN = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'library', label: 'Library', icon: 'library_music' },
  { page: 'tournament', label: 'Tournament', icon: 'emoji_events' },
  { page: 'database', label: 'Database', icon: 'database' },
] as const

export function Sidebar({ expanded, onToggle, route, go }: {
  expanded: boolean
  onToggle: () => void
  route: Route
  go: (r: Route) => void
}) {
  const { data } = useShell()
  const tracks = useLibrary()
  const playlists = useMemo(() => visiblePlaylists(data.playlists, new Set(tracks.map((t) => t.id))), [data.playlists, tracks])
  const inLibrary = route.page === 'library' || route.page === 'album' || route.page === 'artist' || route.page === 'song'
  const selected = (page: string) => (page === 'library' ? inLibrary : route.page === page)

  return (
    <nav className={`ms-rail${expanded ? ' expanded' : ''}`} aria-label="Main">
      <div className="ms-rail-top">
        <IconButton icon={expanded ? 'menu_open' : 'menu'} label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={onToggle} />
        <span className="ms-dest-label" style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: 'var(--text-strong)', letterSpacing: '0.6px' }}>AVSB</span>
      </div>
      <div className="ms-rail-main">
        {MAIN.map((d) => (
          <button
            type="button"
            key={d.page}
            className={`ms-dest${selected(d.page) ? ' on' : ''}`}
            aria-current={selected(d.page) ? 'page' : undefined}
            title={expanded ? undefined : d.label}
            onClick={() => go({ page: d.page })}
          >
            <span className="ms-dest-pill">
              <Icon name={d.icon} fill={selected(d.page)} />
              <span className="ms-dest-label">{d.label}</span>
            </span>
          </button>
        ))}
        <div className="ms-rail-lists">
          <div className="ms-rail-heading">Playlists</div>
          <button type="button" className="ms-rail-row" onClick={() => go({ page: 'library', tab: 'playlists' })}>
            <Icon name="queue_music" />
            <span>All Playlists</span>
          </button>
          {playlists.map((p) => (
            <button type="button" key={p.id} className={`ms-rail-row${route.page === 'playlist' && route.id === p.id ? ' on' : ''}`} onClick={() => go({ page: 'playlist', id: p.id })}>
              <Icon name="playlist_play" />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={`ms-dest settings${route.page === 'settings' ? ' on' : ''}`}
        title={expanded ? undefined : 'Settings'}
        onClick={() => go({ page: 'settings' })}
      >
        <span className="ms-dest-pill">
          <Icon name="settings" fill={route.page === 'settings'} />
          <span className="ms-dest-label">Settings</span>
        </span>
      </button>
    </nav>
  )
}

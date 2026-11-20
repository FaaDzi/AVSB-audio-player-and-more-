import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Chip, Cover, Dialog, Icon, IconButton, Menu, PlayCircle, useLongPress } from '../ui'
import { useShell } from '../context'
import {
  FORMATS, METADATA_FILTERS, NO_FILTERS, SORTS, activeFilterCount, filterTracks, folderName, folderPath, groupAlbums, groupArtists, groupFolders, hideFolder, initial,
  isPcTrack, isPremiumQuality, mergeTwins, onLibrarySearch, playlistCount, qualityLabel, shuffled, sortByFileName, sortIcon, sortTracks, takePendingLibrarySearch, trackCount, useLibrary, visiblePlaylists, type Album, type Filters, type SortMode, type Track,
} from '../library'
import { TrackTable } from './TrackTable'
import { sharePlaylist } from './playlistCover'
import { DeletePlaylistDialog, useTrackMenu } from './TrackMenu'
import { SearchResults } from './SearchResults'
import { useLeaving } from '../motion'
import { useArtistSeparators, useArtistsByAlbumArtist } from '../settings/store'
import { useLibraryStatus } from '../localLibrary'

const TABS = ['songs', 'albums', 'artists', 'playlists', 'folders'] as const
type Tab = (typeof TABS)[number]

/** A circle with soft scallops, as a clip-path. `depth` is how far the notches cut in, as a share of the radius. */
function scallop(lobes: number, depth: number): string {
  const steps = lobes * 8
  const points = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI - Math.PI / 2
    const radius = 50 * (1 - (depth * (1 - Math.cos(lobes * (angle + Math.PI / 2)))) / 2)
    return `${(50 + radius * Math.cos(angle)).toFixed(2)}% ${(50 + radius * Math.sin(angle)).toFixed(2)}%`
  })
  return `polygon(${points.join(',')})`
}
const AVATAR_SHAPE = scallop(9, 0.1)
const BADGE_SHAPE = scallop(12, 0.2)

export const sortMenuItems = (current: SortMode, choose: (mode: SortMode) => void) =>
  SORTS.map(([id, label]) => ({ label, icon: sortIcon(id), checked: id === current, onSelect: () => choose(id) }))

/** Opens a menu along the bottom-left corner of the button pressed. */
export function below(e: React.MouseEvent<HTMLElement>) {
  const box = e.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom }
}

export function LibraryPage({ initialTab = 'songs' }: { initialTab?: Tab }) {
  const { data } = useShell()
  const libraryTracks = useLibrary()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [query, setQuery] = useState(() => takePendingLibrarySearch() ?? '')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [sort, setSort] = useState<SortMode>('latest')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [filtering, setFiltering] = useState(false)
  const [singles, setSingles] = useState(false)
  const [asList, setAsList] = useState(false)

  useEffect(() => {
    if (query) searchInputRef.current?.focus()
    return onLibrarySearch((q) => {
      setQuery(q)
      requestAnimationFrame(() => searchInputRef.current?.focus())
    })
  }, [])

  // a song on both the phone and the PC is listed once (council 2026-11-19); folders keep every file
  const visible = useMemo(() => sortTracks(filterTracks(mergeTwins(libraryTracks), filters, query), sort), [libraryTracks, filters, query, sort])
  const groups = useMemo(() => groupAlbums(visible, sort), [visible, sort])
  const { scanning } = useLibraryStatus()
  const separators = useArtistSeparators()
  const byAlbumArtist = useArtistsByAlbumArtist()
  const artists = useMemo(() => groupArtists(visible, separators, byAlbumArtist), [visible, separators, byAlbumArtist])
  // the Folders tab has no filter button, so a filter set on another tab must not hide tracks here
  const folders = useMemo(() => groupFolders(filterTracks(libraryTracks, NO_FILTERS, query)), [libraryTracks, query])

  const visiblePlaylistsCount = useMemo(
    () => visiblePlaylists(data.playlists, new Set(libraryTracks.map((t) => t.id))).length,
    [data.playlists, libraryTracks],
  )

  const counts: Record<Tab, number | null> = {
    songs: visible.length,
    albums: groups.albums.length,
    artists: null,
    playlists: visiblePlaylistsCount,
    folders: null,
  }
  const active = activeFilterCount(filters)
  const sortLabel = SORTS.find(([id]) => id === sort)?.[1]
  // tab content moves sideways with the tab, the old one leaving as the new one arrives
  const leavingTab = useLeaving(tab, 300)
  const slideFrom = leavingTab && TABS.indexOf(tab) > TABS.indexOf(leavingTab) ? 'right' : 'left'
  const searching = query.trim().length > 0
  // the underline is one element that travels: the leading edge moves first, so it stretches on the way
  const tabBar = useRef<HTMLDivElement>(null)
  const [line, setLine] = useState<{ left: number; right: number; toward: string } | null>(null)
  const countsKey = Object.values(counts).join()
  useLayoutEffect(() => {
    const bar = tabBar.current
    const on = bar?.querySelector<HTMLElement>('.ms-tab.on')
    if (!bar || !on) return
    const left = on.offsetLeft + 16
    const right = bar.clientWidth - on.offsetLeft - on.offsetWidth + 16
    setLine((now) => ({ left, right, toward: !now ? '' : left >= now.left ? 'toward-right' : 'toward-left' }))
  }, [tab, searching, countsKey])

  const controls = (
    <>
      <button type="button" className="ms-tool" onClick={(e) => setSortMenu(below(e))}>
        <Icon name="sort" size={20} /> {sortLabel}
      </button>
      <button type="button" className="ms-tool" onClick={() => setFiltering(true)}>
        <span className="ms-tool-icon"><Icon name="filter_list" size={20} />{active > 0 && <span className="ms-tool-badge">{active}</span>}</span> Filters
      </button>
    </>
  )

  const tabContent = (t: Tab) => (
    <>
        {t === 'songs' && (
          <>
            <div className="ms-row">
              <span className="ms-count">{trackCount(visible.length)}</span>
              <div className="ms-tools">
                {controls}
                <button type="button" className="ms-tool icon" aria-label={asList ? 'Show as grid' : 'Show as list'} title={asList ? 'Show as grid' : 'Show as list'} onClick={() => setAsList(!asList)}>
                  <Icon name={asList ? 'grid_view' : 'view_list'} fill size={22} />
                </button>
              </div>
            </div>
            {!visible.length ? <NoMatches onReset={() => { setFilters(NO_FILTERS); setQuery('') }} /> : asList ? <TrackTable tracks={visible} numbers="none" /> : (
              <GrowingSongGrid tracks={visible} />
            )}
          </>
        )}

        {t === 'albums' && (
          <>
            <div className="ms-segment" role="tablist">
              <button type="button" className={!singles ? 'on' : ''} onClick={() => setSingles(false)}>Albums</button>
              <button type="button" className={singles ? 'on' : ''} onClick={() => setSingles(true)}>Singles</button>
            </div>
            <div className="ms-row">
              <span className="ms-count">{singles ? trackCount(groups.singles.length) : `${groups.albums.length} albums`}</span>
              <div className="ms-tools">{controls}</div>
            </div>
            <div className="ms-grid">{(singles ? groups.singles : groups.albums).map((a) => <AlbumCard key={a.key} album={a} />)}</div>
          </>
        )}

        {t === 'artists' && <ArtistList artists={artists} />}
        {t === 'playlists' && <Playlists />}
        {t === 'folders' && <Folders folders={folders} />}
    </>
  )

  return (
    <div className="ms-scroll">
      <div className="ms-page ms-library">
        <h1 className="ms-h1">Library</h1>
        {scanning && (
          <div className="ms-scan-line" role="status">
            <Icon name="sync" size={18} />
            <span>Scanning your folders: {scanning.read} of {scanning.found} read</span>
            <i style={{ width: `${scanning.found ? (100 * scanning.read) / scanning.found : 0}%` }} />
          </div>
        )}
        <label className="ms-search">
          <Icon name="search" />
          <input ref={searchInputRef} placeholder="Search your library" aria-label="Search your library" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <IconButton icon="close" label="Clear search" small onClick={() => setQuery('')} />}
        </label>
        {!searching && <div className="ms-tabs" role="tablist" ref={tabBar}>
          {TABS.map((t) => (
            <button type="button" role="tab" key={t} aria-selected={tab === t} className={`ms-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {counts[t] !== null && <span className="ms-tab-count">{counts[t]}</span>}
            </button>
          ))}
          {line && <span className={`ms-tab-line ${line.toward}`} style={{ left: line.left, right: line.right }} />}
        </div>}

        {!searching && (
          <div className={`ms-tab-view${leavingTab ? ' sliding' : ''}`}>
            {leavingTab && <div className={`ms-tab-pane out to-${slideFrom === 'right' ? 'left' : 'right'}`} key={leavingTab} inert>{tabContent(leavingTab)}</div>}
            <div className={`ms-tab-pane${leavingTab ? ` in from-${slideFrom}` : ''}`} key={tab}>{tabContent(tab)}</div>
          </div>
        )}
      </div>
      {searching && <SearchResults query={query} />}

      {sortMenu && (
        <Menu compact x={sortMenu.x} y={sortMenu.y} onClose={() => setSortMenu(null)} items={sortMenuItems(sort, setSort)} />
      )}
      {filtering && <FilterDialog value={filters} sort={sort} tracks={libraryTracks} onApply={(f, s) => { setFilters(f); setSort(s) }} onClose={() => setFiltering(false)} />}
    </div>
  )
}

function SongCard({ track, list }: { track: Track; list: Track[] }) {
  const { play, current, playing, loading, setPlaying, push } = useShell()
  const menu = useTrackMenu()
  const active = current?.id === track.id
  return (
    <article className={`ms-card${active ? ' on' : ''}`} onClick={() => push({ page: 'song', id: track.id })} onContextMenu={(e) => menu.open(e, track)}>
      <div className="ms-card-art">
        <Cover id={track.cover} alt="" genre={track.genre} speciality={track.category} title={track.title} />
        <span className={`ms-badge${isPremiumQuality(track) ? ' hi' : ''}`}>{qualityLabel(track)}</span>
        {!track.downloaded && (
          <span className="ms-card-local" title={track.pcTwin ? 'On this phone and your PC' : isPcTrack(track) ? 'On your PC' : 'On this device'}>
            <Icon name={track.pcTwin ? 'devices' : isPcTrack(track) ? 'computer' : 'folder'} fill size={14} />
          </span>
        )}
        <PlayCircle title={track.title} active={active} playing={playing} loading={loading} onStart={() => play(track, list)} onToggle={() => setPlaying(!playing)} />
      </div>
      <button type="button" className="ms-card-title as-button">{track.title}</button>
      <div className="ms-card-sub">{track.artist || 'Unknown Artist'}</div>
      <span onClick={(e) => e.stopPropagation()}>{menu.node}</span>
    </article>
  )
}

export function AlbumCard({ album }: { album: Album }) {
  const { push, play, current, playing, loading, setPlaying, queue, setQueue, showToast } = useShell()
  const active = album.tracks.some((t) => t.id === current?.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const open = () => push({ page: 'album', key: album.key })
  const items = [
    { label: 'Play', icon: 'play_arrow', onSelect: () => play(album.tracks[0], album.tracks) },
    { label: 'Shuffle', icon: 'shuffle', onSelect: () => { const s = shuffled(album.tracks); if (s[0]) play(s[0], s) } },
    { label: 'Add to queue', icon: 'playlist_add', divider: true, onSelect: () => { setQueue([...queue, ...album.tracks]); showToast(`Added ${trackCount(album.tracks.length)} to the queue`) } },
    { label: 'Open album', icon: 'album', onSelect: open },
    ...(album.artist ? [{ label: 'Go to Artist', icon: 'person', onSelect: () => push({ page: 'artist', name: album.artist }) }] : []),
    { label: 'Copy album name', icon: 'content_copy', onSelect: () => { void navigator.clipboard?.writeText(album.name); showToast('Album name copied') } },
  ]
  return (
    <article className={`ms-card${active ? ' on' : ''}`} onClick={open} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}>
      <div className="ms-card-art">
        <Cover id={album.cover} alt="" genre={album.tracks[0]?.genre} speciality={album.tracks[0]?.category} title={album.name} />
        <span className="ms-badge count"><Icon name="music_note" size={14} fill /> {album.tracks.length}</span>
        <PlayCircle title={album.name} active={active} playing={playing} loading={loading} onStart={() => play(album.tracks[0], album.tracks)} onToggle={() => setPlaying(!playing)} />
      </div>
      <button type="button" className="ms-card-title as-button">{album.name}</button>
      <div className="ms-card-sub">{album.artist || 'Unknown Artist'}</div>
      {menu && <span onClick={(e) => e.stopPropagation()}><Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} /></span>}
    </article>
  )
}

/** The cover grid on artist pages and in Folders: square art, plain text under it, Play on hover. */
export function Tile({ cover, title, sub, tracks, onOpen, onPlay, onMenu }: {
  cover: string
  title: string
  sub: string
  /** What this tile plays, so its circle can show pause while one of them is playing. */
  tracks: Track[]
  onOpen: () => void
  onPlay: () => void
  onMenu?: (e: React.MouseEvent) => void
}) {
  const { current, playing, loading, setPlaying } = useShell()
  const active = tracks.some((t) => t.id === current?.id)
  return (
    <article className="ms-tile" onClick={onOpen} onContextMenu={onMenu}>
      <div className="ms-tile-art">
        <Cover id={cover} alt="" genre={tracks[0]?.genre} speciality={tracks[0]?.category} title={title} />
        <PlayCircle title={title} active={active} playing={playing} loading={loading} onStart={onPlay} onToggle={() => setPlaying(!playing)} />
      </div>
      <button type="button" className="ms-tile-title">{title}</button>
      <div className="ms-tile-sub">{sub}</div>
    </article>
  )
}

/** Play, shuffle and add to queue for every track given, on a folder's page and in the one-folder view. */
export function FolderActions({ tracks }: { tracks: Track[] }) {
  const { play, queue, setQueue, showToast } = useShell()
  return (
    <div className="ms-folder-actions">
      <button type="button" className="ms-btn primary" onClick={() => tracks[0] && play(tracks[0], tracks)}><Icon name="play_arrow" fill size={20} /> Play</button>
      <IconButton icon="shuffle" label="Shuffle" filled onClick={() => { const s = shuffled(tracks); if (s[0]) play(s[0], s) }} />
      <IconButton icon="playlist_add" label="Add to queue" filled onClick={() => { setQueue([...queue, ...tracks]); showToast(`Added ${trackCount(tracks.length)} to the queue`) }} />
    </div>
  )
}

function Folders({ folders }: { folders: ReturnType<typeof groupFolders> }) {
  const { play, push, queue, setQueue, showToast } = useShell()
  const [menu, setMenu] = useState<{ x: number; y: number; folder: string; tracks: Track[] } | null>(null)
  const sorted = useMemo(() => folders.map((f) => ({ ...f, tracks: sortByFileName(f.tracks) })), [folders])

  // a library with one folder has nothing to choose between, so its songs show straight away
  if (sorted.length === 1) {
    const [only] = sorted
    return (
      <>
        <div className="ms-row ms-folder-summary">
          <div>
            <div className="ms-folder-path">{folderPath(only.folder)}</div>
            <div className="ms-folder-path">{trackCount(only.tracks.length)}</div>
          </div>
          <FolderActions tracks={only.tracks} />
        </div>
        <TrackTable tracks={only.tracks} numbers="none" />
      </>
    )
  }

  const allTracks = sorted.flatMap((f) => f.tracks)
  return (
    <>
    <div className="ms-row ms-folder-summary">
      <span className="ms-count">{sorted.length} folders · {trackCount(allTracks.length)}</span>
      <FolderActions tracks={allTracks} />
    </div>
    <div className="ms-tiles ms-folder-tiles">
      {sorted.map((f) => (
        <Tile
          key={f.folder}
          cover={f.tracks.find((t) => t.cover)?.cover ?? ''}
          title={folderName(f.folder)}
          sub={trackCount(f.tracks.length)}
          tracks={f.tracks}
          onOpen={() => push({ page: 'folder', folder: f.folder })}
          onPlay={() => play(f.tracks[0], f.tracks)}
          onMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, folder: f.folder, tracks: f.tracks }) }}
        />
      ))}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Play', icon: 'play_arrow', onSelect: () => play(menu.tracks[0], menu.tracks) },
            { label: 'Shuffle', icon: 'shuffle', onSelect: () => { const s = shuffled(menu.tracks); play(s[0], s) } },
            { label: 'Add to queue', icon: 'playlist_add', divider: true, onSelect: () => { setQueue([...queue, ...menu.tracks]); showToast(`Added ${trackCount(menu.tracks.length)} to the queue`) } },
            { label: 'Hide this folder', icon: 'folder_off', onSelect: () => { hideFolder(menu.folder); showToast(`Hid "${folderName(menu.folder)}". You can add it back in Settings → Library.`) } },
          ]}
        />
      )}
    </div>
    </>
  )
}

/** Shown only when the library has tracks from the last four weeks. */
export function RewindBanner() {
  return (
    <div className="ms-rewind">
      <span className="ms-rewind-badge" style={{ clipPath: BADGE_SHAPE }}><Icon name="auto_awesome" fill size={24} /></span>
      <div className="grow">
        <b>Rewind</b>
        <p>Your last 4 weeks are ready to replay</p>
      </div>
      <Icon name="chevron_right" />
    </div>
  )
}

function ArtistList({ artists }: { artists: ReturnType<typeof groupArtists> }) {
  const { push } = useShell()
  const sections = new Map<string, typeof artists>()
  for (const a of artists) {
    const k = initial(a.name)
    sections.set(k, [...(sections.get(k) ?? []), a])
  }
  const order = [...sections.keys()].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
  return (
    <div className="ms-artists">
      {order.map((k) => (
        <section key={k}>
          <h3 className="ms-section-head">{k}</h3>
          <div className="ms-artist-group">
            {sections.get(k)!.map((a) => (
              <button type="button" className="ms-artist" key={a.name} onClick={() => push({ page: 'artist', name: a.name })}>
                <span className="ms-artist-avatar" style={{ clipPath: AVATAR_SHAPE }}>
                  {a.cover ? <Cover id={a.cover} /> : <span className="ms-cover ms-cover-none"><Icon name="person" /></span>}
                </span>
                <span className="grow ms-ellipsis">{a.name}<small>{trackCount(a.tracks.length)}</small></span>
                <Icon name="chevron_right" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Playlists() {
  const { data, openPlaylist, replaceData } = useShell()
  const tracks = useLibrary()
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const create = () => replaceData({ ...data, playlists: [...data.playlists, { id: `p-${Date.now()}`, name: `Playlist ${data.playlists.length + 1}`, tracks: [] }] })
  const press = useLongPress()
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const deletingList = data.playlists.find((p) => p.id === deleting)

  const shownPlaylists = useMemo(() => visiblePlaylists(data.playlists, byId), [data.playlists, byId])

  return (
    <>
      <div className="ms-row">
        <span className="ms-count">{playlistCount(shownPlaylists.length)}</span>
        <button type="button" className="ms-link" onClick={create}><Icon name="add" size={18} /> Create playlist</button>
      </div>
      <div className="ms-grid square">
        {shownPlaylists.map((p) => {
          const cover = p.cover || (p.tracks.map((id) => byId.get(id)?.cover).find(Boolean) ?? '')
          const activeTrackCount = p.tracks.filter((id) => byId.has(id)).length
          return (
            <article className="ms-card" key={p.id} onClick={() => openPlaylist(p.id)} {...press((x, y) => setMenu({ x, y, id: p.id }))}>
              <div className="ms-card-art"><Cover id={cover} alt="" /></div>
              <button type="button" className="ms-card-title as-button">{p.name}</button>
              <div className="ms-card-sub">{trackCount(activeTrackCount || p.tracks.length)}</div>
            </article>
          )
        })}
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open playlist', icon: 'queue_music', onSelect: () => openPlaylist(menu.id) },
            { label: 'Rename', icon: 'edit', divider: true, onSelect: () => setRenaming({ id: menu.id, name: data.playlists.find((p) => p.id === menu.id)?.name ?? '' }) },
            { label: 'Share', icon: 'ios_share', onSelect: () => { const p = data.playlists.find((x) => x.id === menu.id); if (p) void sharePlaylist(p.name, p.tracks.map((id) => byId.get(id)).filter((t): t is Track => !!t)) } },
            { label: 'Delete playlist', icon: 'delete', danger: true, onSelect: () => setDeleting(menu.id) },
          ]}
        />
      )}
      {renaming && (
        <Dialog
          title="Rename playlist"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button type="button" className="ms-btn text" onClick={() => setRenaming(null)}>Cancel</button>
              <button
                type="button"
                className="ms-btn primary"
                disabled={!renaming.name.trim()}
                onClick={() => {
                  replaceData({ ...data, playlists: data.playlists.map((p) => (p.id === renaming.id ? { ...p, name: renaming.name.trim() } : p)) })
                  setRenaming(null)
                }}
              >
                Save
              </button>
            </>
          }
        >
          <input className="ms-input filled" aria-label="Playlist name" autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
        </Dialog>
      )}
      {deletingList && <DeletePlaylistDialog playlist={deletingList} onClose={() => setDeleting(null)} />}
    </>
  )
}

function NoMatches({ onReset }: { onReset: () => void }) {
  return (
    <div className="ms-empty small">
      <Icon name="search_off" />
      <p>No songs match.</p>
      <button type="button" className="ms-btn tonal" onClick={onReset}>Reset filters and search</button>
    </div>
  )
}

export function FilterDialog({ value, sort, tracks, onApply, onClose }: {
  value: Filters
  sort: SortMode
  tracks: Track[]
  onApply: (f: Filters, sort: SortMode) => void
  onClose: () => void
}) {
  const [f, setF] = useState(value)
  const [s, setS] = useState(sort)
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch })
  // a preview of what Apply will show, so a filter that finds nothing is obvious before you commit to it
  const matching = useMemo(() => filterTracks(tracks, f).length, [tracks, f])

  return (
    <Dialog
      wide
      title="Filters"
      onClose={onClose}
      headerAction={<button type="button" className="ms-btn text" onClick={() => { setF(NO_FILTERS); setS('latest') }}>Reset</button>}
    >
      <FilterGroup label="Source">
        <Chip label="All" selected={!f.source} onClick={() => set({ source: null })} />
        <Chip label="Downloaded" selected={f.source === 'downloaded'} onClick={() => set({ source: 'downloaded' })} />
        <Chip label="Local" selected={f.source === 'local'} onClick={() => set({ source: 'local' })} />
      </FilterGroup>
      <FilterGroup label="Quality">
        <Chip label="All" selected={!f.quality} onClick={() => set({ quality: null })} />
        <Chip label="Hi-Res (24bit)" selected={f.quality === 'hires'} onClick={() => set({ quality: 'hires' })} />
        <Chip label="CD (16bit)" selected={f.quality === 'cd'} onClick={() => set({ quality: 'cd' })} />
        <Chip label="Lossy" selected={f.quality === 'lossy'} onClick={() => set({ quality: 'lossy' })} />
      </FilterGroup>
      <FilterGroup label="Format">
        <Chip label="All" selected={!f.format} onClick={() => set({ format: null })} />
        {FORMATS.map((x) => <Chip key={x} label={x} selected={f.format === x} onClick={() => set({ format: x })} />)}
      </FilterGroup>
      <FilterGroup label="Metadata">
        <Chip label="All" selected={!f.metadata} onClick={() => set({ metadata: null })} />
        {METADATA_FILTERS.map(([id, label]) => <Chip key={id} label={label} selected={f.metadata === id} onClick={() => set({ metadata: id })} />)}
      </FilterGroup>
      <FilterGroup label="Sort">
        {SORTS.map(([id, label]) => <Chip key={id} label={label} selected={s === id} onClick={() => setS(id)} />)}
      </FilterGroup>
      <button type="button" className="ms-btn primary full ms-filter-apply" onClick={() => { onApply(f, s); onClose() }}>Apply ({trackCount(matching)})</button>
    </Dialog>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="ms-filter-group">
      <h3>{label}</h3>
      <div className="ms-chips">{children}</div>
    </section>
  )
}

/** Cards built per batch, more as the end comes near: 1500 at once held a phone up for seconds after start. */
const GRID_BATCH = 120

function GrowingSongGrid({ tracks }: { tracks: Track[] }) {
  const [shown, setShown] = useState(GRID_BATCH)
  const end = useRef<HTMLDivElement>(null)
  // a new list (search, sort, filter) starts from the top again
  useEffect(() => {
    setShown((s) => (s === GRID_BATCH ? s : GRID_BATCH))
  }, [tracks])
  useEffect(() => {
    setShown((s) => (s === GRID_BATCH ? s : GRID_BATCH))
  }, [tracks])
  useEffect(() => {
    const el = end.current
    if (!el || shown >= tracks.length) return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + GRID_BATCH)
    }, { rootMargin: '1200px 0px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [shown, tracks.length])
  return (
    <>
      <div className="ms-grid songs">{tracks.slice(0, shown).map((t) => <SongCard key={t.id} track={t} list={tracks} />)}</div>
      {shown < tracks.length && <div ref={end} aria-hidden="true" style={{ height: 1 }} />}
    </>
  )
}

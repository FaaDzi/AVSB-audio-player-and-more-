import { useEffect, useMemo, useRef, useState } from 'react'
import { Cover, Dialog, Icon, IconButton, Menu, TopBar } from '../ui'
import { useShell } from '../context'
import {
  NO_FILTERS, activeFilterCount, filterTracks, folderPath, groupAlbums, groupArtists, isPcTrack, isPremiumQuality, moveItem, shuffled, sortByFileName, sortTracks, trackCount, useLibrary,
  type Filters, type SortMode, type Track,
} from '../library'
import { missingTrack } from '../playlistSync'
import { TrackTable } from './TrackTable'
import { FilterDialog, FolderActions, Tile, below, sortMenuItems } from './LibraryPage'
import { useCoverStyle } from '../cover'
import { useListening } from '../stats'
import { buildHomeShelves } from './HomePage'
import { pickSquareImage, SHELF_PREFIX } from './playlistCover'
import { getSetting, setSetting, useArtistSeparators } from '../settings/store'

export type PlaylistSortMode =
  | 'custom'
  | 'title'
  | 'artist'
  | 'album'
  | 'added-desc'
  | 'added-asc'
  | 'duration-asc'
  | 'duration-desc'
  | 'quality'

export const PLAYLIST_SORTS: readonly [PlaylistSortMode, string, string][] = [
  ['custom', 'Custom / Playlist Order', 'queue_music'],
  ['title', 'Title (A → Z)', 'sort_by_alpha'],
  ['artist', 'Artist (A → Z)', 'person'],
  ['album', 'Album (A → Z)', 'album'],
  ['added-desc', 'Date Added (Newest)', 'schedule'],
  ['added-asc', 'Date Added (Oldest)', 'history'],
  ['duration-asc', 'Track Duration (Shortest)', 'timer'],
  ['duration-desc', 'Track Duration (Longest)', 'timelapse'],
  ['quality', 'Audio Quality / Format (Hi-Res FLAC, CD FLAC, Lossy)', 'high_quality'],
]

export type PlaylistSourceFilter = 'all' | 'local' | 'pc' | 'lossless'

export const PLAYLIST_SOURCE_CHIPS: readonly [PlaylistSourceFilter, string][] = [
  ['all', 'All'],
  ['local', 'Local Phone'],
  ['pc', 'PC Stream'],
  ['lossless', 'Lossless Only'],
]

/** The sort chosen per playlist (setting `plsort`); a playlist not in it shows in its own order. */
function savedSorts(): Record<string, PlaylistSortMode> {
  try {
    return JSON.parse(String(getSetting('plsort') ?? '{}')) as Record<string, PlaylistSortMode>
  } catch {
    return {}
  }
}

function qualityTier(t: Track): number {
  if (isPremiumQuality(t)) return 0 // Hi-Res FLAC/Lossless, Dolby
  if (!t.lossy) return 1 // CD FLAC/Lossless
  return 2 // Lossy
}

export function sortAndFilterPlaylistTracks(
  tracks: Track[],
  query: string,
  sourceFilter: PlaylistSourceFilter,
  sortMode: PlaylistSortMode,
): Track[] {
  const q = query.trim().toLowerCase()
  const filtered = tracks.filter((t) => {
    if (sourceFilter === 'local' && isPcTrack(t)) return false
    if (sourceFilter === 'pc' && !isPcTrack(t)) return false
    if (sourceFilter === 'lossless' && t.lossy) return false
    if (q) {
      const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  if (sortMode === 'custom') return filtered
  const copy = [...filtered]
  switch (sortMode) {
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    case 'artist':
      return copy.sort((a, b) => (a.artist || 'Unknown').localeCompare(b.artist || 'Unknown') || a.title.localeCompare(b.title))
    case 'album':
      return copy.sort((a, b) => (a.album || 'Unknown').localeCompare(b.album || 'Unknown') || a.track - b.track || a.title.localeCompare(b.title))
    case 'added-desc':
      return copy.sort((a, b) => b.added - a.added || a.title.localeCompare(b.title))
    case 'added-asc':
      return copy.sort((a, b) => a.added - b.added || a.title.localeCompare(b.title))
    case 'duration-asc':
      return copy.sort((a, b) => a.sec - b.sec || a.title.localeCompare(b.title))
    case 'duration-desc':
      return copy.sort((a, b) => b.sec - a.sec || a.title.localeCompare(b.title))
    case 'quality':
      return copy.sort(
        (a, b) =>
          qualityTier(a) - qualityTier(b) ||
          b.bits - a.bits ||
          b.rate - a.rate ||
          b.kbps - a.kbps ||
          a.title.localeCompare(b.title),
      )
  }
}

export function PlaylistPage({ id, back }: { id: string; back: () => void }) {
  const { data, play, push, replaceData, showToast } = useShell()
  const libraryTracks = useLibrary()
  const listening = useListening()
  // a Home shelf opens here too (§89 C): shown like a playlist, kept only if saved, replaced at the next shelf refresh
  const shelfId = id.startsWith(SHELF_PREFIX) ? id.slice(SHELF_PREFIX.length) : null
  const shelf = useMemo(
    () => (shelfId ? buildHomeShelves(libraryTracks, listening).find((x) => x.id === shelfId) : undefined),
    [shelfId, libraryTracks, listening],
  )
  const playlist = data.playlists.find((p) => p.id === id) ?? (shelf ? { id, name: shelf.title, tracks: shelf.tracks.map((t) => t.id) } : undefined)
  const [editingOrder, setEditingOrder] = useState(false)
  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<PlaylistSourceFilter>('all')
  // the view you chose for this playlist is remembered (§86 F). Sorting is only a view: the playlist's own order,
  // the one you made with "Edit order", is never changed by it and is what "Custom" always comes back to.
  const [sortMode, setSortState] = useState<PlaylistSortMode>(() => savedSorts()[id] ?? 'custom')
  const setSortMode = (mode: PlaylistSortMode) => {
    setSortState(mode)
    const { [id]: _was, ...rest } = savedSorts()
    setSetting('plsort', JSON.stringify(mode === 'custom' ? rest : { ...rest, [id]: mode }))
  }
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null)

  const byId = useMemo(() => new Map(libraryTracks.map((t) => [t.id, t])), [libraryTracks])
  const tracks = useMemo(
    // a song only the phone has shows as a greyed-out "(missing song)" row until the phone sends it (§80 A)
    () => (playlist ? playlist.tracks.map((x) => byId.get(x) ?? (playlist.missing?.[x] ? missingTrack(x, playlist.missing[x]) : undefined)).filter((t): t is Track => !!t) : []),
    [playlist, byId],
  )
  const visibleTracks = useMemo(
    () => sortAndFilterPlaylistTracks(tracks, query, sourceFilter, sortMode),
    [tracks, query, sourceFilter, sortMode],
  )

  if (!playlist) return <div className="ms-empty"><p>{shelfId ? 'This mix has been refreshed. Home has new ones.' : 'This playlist no longer exists.'}</p></div>
  const update = (patch: Partial<typeof playlist>) => replaceData({ ...data, playlists: data.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const cover = playlist.cover || (tracks.find((t) => t.cover)?.cover ?? '')
  const save = () => {
    const copy = { id: `p-${Date.now()}`, name: playlist.name, tracks: [...playlist.tracks] }
    replaceData({ ...data, playlists: [...data.playlists, copy] })
    showToast(`Saved "${copy.name}" to your playlists`)
    push({ page: 'playlist', id: copy.id })
  }
  const chooseCover = () => {
    void pickSquareImage().then((image) => { if (image) update({ cover: image }) }).catch((e: unknown) => showToast(`Couldn't use that image: ${String(e)}`))
  }
  const currentSortLabel = PLAYLIST_SORTS.find(([k]) => k === sortMode)?.[1] ?? 'Custom / Playlist Order'
  const currentFilterLabel = PLAYLIST_SOURCE_CHIPS.find(([k]) => k === sourceFilter)?.[1] ?? 'All'

  if (editingOrder) {
    return (
      <OrderEditor
        name={playlist.name}
        cover={cover}
        tracks={tracks}
        onClose={() => setEditingOrder(false)}
        onSave={(ids) => {
          // a song missing from the library keeps its place at the end, so saving an order can't lose it
          update({ tracks: [...ids, ...playlist.tracks.filter((x) => !tracks.some((t) => t.id === x))] })
          setEditingOrder(false)
          showToast('Order saved')
        }}
      />
    )
  }

  return (
    <div className="ms-scroll">
      {/* §89 D: rename, share and delete live in the playlist's long-press menu in Library; the cover changes on a tap */}
      <TopBar title={playlist.name} back={back} />
      <div className="ms-detail">
        <DetailHeader
          cover={cover}
          title={playlist.name}
          onCover={shelf ? undefined : (e) => (playlist.cover ? setCoverMenu(below(e)) : chooseCover())}
          sub={
            <>
              <Icon name="queue_music" size={18} />{' '}
              {visibleTracks.length !== tracks.length
                ? `${visibleTracks.length} of ${trackCount(tracks.length)}`
                : trackCount(tracks.length)}
            </>
          }
          actions={
            <>
              {shelf
                ? <IconButton icon="playlist_add" label="Save playlist" filled onClick={save} />
                : <IconButton icon="download" label="Download" filled onClick={() => showToast('Download is here for layout only')} />}
              <button
                type="button"
                className="ms-btn play"
                onClick={() => visibleTracks[0] && play(visibleTracks[0], visibleTracks)}
              >
                <Icon name="play_arrow" fill size={20} /> Play
              </button>
              <IconButton
                icon="shuffle"
                label="Shuffle"
                filled
                onClick={() => {
                  const s = shuffled(visibleTracks)
                  if (s[0]) play(s[0], s)
                }}
              />
            </>
          }
        />

        <div className="ms-playlist-controls" style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '8px 0 12px' }}>
          <label className="ms-search">
            <Icon name="search" />
            <input
              placeholder="Search in playlist..."
              aria-label="Search in playlist"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <IconButton icon="close" label="Clear search" small onClick={() => setQuery('')} />}
          </label>
          {/* §86 F: one row. Sort on the left, the filter as one button beside it, and "Edit order" while the
              playlist shows in its own order */}
          <div className="ms-tools" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="ms-tool"
              aria-label={`Sort playlist: ${currentSortLabel}`}
              onClick={(e) => setSortMenu(below(e))}
            >
              <Icon name="sort" size={20} /> {currentSortLabel}
            </button>
            <button
              type="button"
              className={`ms-tool${sourceFilter !== 'all' ? ' on' : ''}`}
              aria-label={`Filter: ${currentFilterLabel}`}
              onClick={(e) => setFilterMenu(below(e))}
            >
              <Icon name="filter_list" size={20} /> {sourceFilter === 'all' ? 'Filter' : currentFilterLabel}
            </button>
            {!shelf && sortMode === 'custom' && sourceFilter === 'all' && !query && tracks.length > 1 && (
              <button type="button" className="ms-tool" onClick={() => setEditingOrder(true)}>
                <Icon name="drag_handle" size={20} /> Edit order
              </button>
            )}
          </div>
        </div>

        <TrackTable tracks={visibleTracks} playlistId={shelf ? undefined : playlist.id} />
      </div>

      {filterMenu && (
        <Menu
          compact
          x={filterMenu.x}
          y={filterMenu.y}
          onClose={() => setFilterMenu(null)}
          items={PLAYLIST_SOURCE_CHIPS.map(([f, label]) => ({ label, checked: sourceFilter === f, onSelect: () => setSourceFilter(f) }))}
        />
      )}
      {sortMenu && (
        <Menu
          compact
          x={sortMenu.x}
          y={sortMenu.y}
          onClose={() => setSortMenu(null)}
          items={PLAYLIST_SORTS.map(([mode, label, icon]) => ({
            label,
            icon,
            checked: sortMode === mode,
            onSelect: () => setSortMode(mode),
          }))}
        />
      )}

      {coverMenu && (
        <Menu
          compact
          x={coverMenu.x}
          y={coverMenu.y}
          onClose={() => setCoverMenu(null)}
          items={[
            { label: 'Choose an image', icon: 'image', onSelect: chooseCover },
            { label: 'Use song covers', icon: 'library_music', onSelect: () => update({ cover: undefined }) },
          ]}
        />
      )}
    </div>
  )
}

export function AlbumPage({ albumKey, back }: { albumKey: string; back: () => void }) {
  const { play, push, showToast } = useShell()
  const libraryTracks = useLibrary()
  const album = useMemo(() => {
    const { albums, singles } = groupAlbums(libraryTracks)
    return [...albums, ...singles].find((a) => a.key === albumKey)
  }, [libraryTracks, albumKey])
  const coverStyle = useCoverStyle(album?.cover)
  if (!album) return <div className="ms-empty"><p>This album is no longer in the library.</p></div>
  const minutes = Math.round(album.tracks.reduce((n, t) => n + t.sec, 0) / 60)
  const qualities = [...new Set(album.tracks.map((t) => (t.lossy ? `${t.format} ${t.kbps}kbps` : `${t.bits}-bit/${t.rate / 1000}kHz`)))].join(', ')

  return (
    <div className="ms-scroll">
      <TopBar back={back} actions={<IconButton icon="more_horiz" label="More" filled onClick={() => showToast('Album options come with the real library')} />} />
      <div className="ms-detail">
        <header className="ms-detail-head ms-album-head" style={coverStyle}>
          <Cover id={album.cover} alt={album.name} className="ms-album-cover" genre={album.tracks[0]?.genre} speciality={album.tracks[0]?.category} title={album.name} />
          <div className="ms-detail-info">
            <div>
              <h1>{album.name}</h1>
              <button type="button" className="ms-album-artist" onClick={() => push({ page: 'artist', name: album.artist })}>{album.artist}</button>
              <p className="ms-album-meta">{trackCount(album.tracks.length)} · {minutes} min · <Icon name="graphic_eq" size={16} /> {qualities}</p>
            </div>
            <div className="ms-album-actions">
              <button type="button" className="ms-btn accent" onClick={() => play(album.tracks[0], album.tracks)}><Icon name="play_arrow" fill size={20} /> Play</button>
              <IconButton icon="shuffle" label="Shuffle" filled onClick={() => { const s = shuffled(album.tracks); play(s[0], s) }} />
              <IconButton icon="playlist_add" label="Add to queue" filled onClick={() => showToast(`Added ${trackCount(album.tracks.length)} to the queue`)} />
            </div>
          </div>
        </header>
        <TrackTable tracks={album.tracks} columns={['artist', 'quality']} numbers="track" thumbs={false} />
      </div>
    </div>
  )
}

function OrderEditor({ name, cover, tracks, onClose, onSave }: {
  name: string
  cover: string
  tracks: Track[]
  onClose: () => void
  onSave: (ids: string[]) => void
}) {
  const [before] = useState(() => tracks.map((t) => t.id))
  const [ids, setIds] = useState(before)
  const [discarding, setDiscarding] = useState(false)
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null)
  const held = useRef<{ id: string; pointer: number; startY: number; startIndex: number; rowHeight: number; scroller: HTMLElement } | null>(null)
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const changed = ids.some((id, i) => id !== before[i])

  const follow = () => {
    const h = held.current
    if (!h) return
    const moved = h.pointer + h.scroller.scrollTop - h.startY
    const to = Math.max(0, Math.min(before.length - 1, h.startIndex + Math.round(moved / h.rowHeight)))
    setIds((list) => moveItem(list, list.indexOf(h.id), to))
    setDrag({ id: h.id, offset: moved - (to - h.startIndex) * h.rowHeight })
  }

  // holding a row near the top or bottom edge keeps the list moving
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const tick = () => {
      const h = held.current
      if (h) {
        const box = h.scroller.getBoundingClientRect()
        const edge = 48
        const speed = h.pointer < box.top + edge ? -8 : h.pointer > box.bottom - edge ? 8 : 0
        if (speed) {
          h.scroller.scrollTop += speed
          follow()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  const grab = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    const row = e.currentTarget.closest<HTMLElement>('.ms-order-row')
    const scroller = e.currentTarget.closest<HTMLElement>('.ms-scroll')
    if (!row || !scroller) return
    e.currentTarget.setPointerCapture(e.pointerId)
    held.current = { id, pointer: e.clientY, startY: e.clientY + scroller.scrollTop, startIndex: ids.indexOf(id), rowHeight: row.offsetHeight, scroller }
    setDrag({ id, offset: 0 })
  }
  const release = () => {
    held.current = null
    setDrag(null)
  }

  return (
    <div className="ms-scroll">
      <div className="ms-topbar">
        <div className="ms-topbar-side"><IconButton icon="close" label="Close" filled onClick={() => (changed ? setDiscarding(true) : onClose())} /></div>
        <div className="ms-topbar-title">Edit order</div>
        <div className="ms-topbar-side end">
          <button type="button" className="ms-btn text ms-order-save" disabled={!changed} onClick={() => onSave(ids)}>Save</button>
        </div>
      </div>
      <div className="ms-detail">
        <DetailHeader cover={cover} title={name} sub={<><Icon name="queue_music" size={18} /> {trackCount(ids.length)}</>} />
        <p className="ms-hint">Drag a track by its handle, or touch and hold it, to move it.</p>
        <div className="ms-order">
          {ids.map((id, i) => {
            const t = byId.get(id)
            if (!t) return null
            const moving = drag?.id === id
            return (
              <div className={`ms-order-row${moving ? ' moving' : ''}`} key={id} style={moving ? { transform: `translateY(${drag.offset}px)` } : undefined}>
                <Cover id={t.cover} className="ms-order-cover" genre={t.genre} speciality={t.category} title={t.title} />
                <div className="grow ms-order-text"><div className="ms-ellipsis">{t.title}</div><small className="ms-ellipsis">{t.artist || 'Unknown Artist'}</small></div>
                <button
                  type="button"
                  className="ms-order-handle"
                  aria-label={`Move ${t.title}. Use the up and down arrow keys.`}
                  onPointerDown={(e) => grab(e, id)}
                  onPointerMove={(e) => {
                    if (!held.current) return
                    held.current.pointer = e.clientY
                    follow()
                  }}
                  onPointerUp={release}
                  onPointerCancel={release}
                  onKeyDown={(e) => {
                    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                    if (!step) return
                    e.preventDefault()
                    setIds((list) => moveItem(list, i, i + step))
                  }}
                >
                  <Icon name="drag_handle" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {discarding && (
        <Dialog
          title="Discard changes?"
          onClose={() => setDiscarding(false)}
          footer={
            <>
              <button type="button" className="ms-btn text" onClick={() => setDiscarding(false)}>Cancel</button>
              <button type="button" className="ms-btn danger" onClick={onClose}>Discard</button>
            </>
          }
        >
          <p>Your new track order hasn't been saved.</p>
        </Dialog>
      )}
    </div>
  )
}

export function ArtistPage({ name, back }: { name: string; back: () => void }) {
  const { play, push } = useShell()
  const libraryTracks = useLibrary()
  const separators = useArtistSeparators()
  const artist = useMemo(() => groupArtists(libraryTracks, separators).find((a) => a.name === name), [libraryTracks, name, separators])
  const [query, setQuery] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('latest')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filtering, setFiltering] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const albums = useMemo(() => {
    if (!artist) return []
    const { albums: a, singles } = groupAlbums(sortTracks(filterTracks(artist.tracks, filters), sort))
    const q = (query ?? '').toLowerCase()
    return [...a, ...singles].filter((x) => x.name.toLowerCase().includes(q))
  }, [artist, filters, query, sort])
  if (!artist) return <div className="ms-empty"><p>This artist is no longer in the library.</p></div>

  return (
    <div className="ms-scroll">
      <TopBar
        back={back}
        actions={
          <>
            <IconButton icon="search" label="Search this artist" onClick={() => setQuery(query === null ? '' : null)} />
            <IconButton icon="sort" label="Sort" onClick={(e) => setMenu(below(e))} />
            <IconButton icon="filter_list" label="Filters" active={activeFilterCount(filters) > 0} onClick={() => setFiltering(true)} />
          </>
        }
      />
      <div className="ms-page ms-artist-page">
        <h1 className="ms-h1">{artist.name}</h1>
        {query !== null && <input className="ms-input" autoFocus aria-label="Search this artist" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />}
        <div className="ms-tiles">
          {albums.map((a) => (
            <Tile key={a.key} tracks={a.tracks} cover={a.cover} title={a.name} sub={a.artist} onOpen={() => push({ page: 'album', key: a.key })} onPlay={() => play(a.tracks[0], a.tracks)} />
          ))}
        </div>
      </div>
      {menu && <Menu compact x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={sortMenuItems(sort, setSort)} />}
      {filtering && <FilterDialog value={filters} sort={sort} tracks={artist.tracks} onApply={(f, s) => { setFilters(f); setSort(s) }} onClose={() => setFiltering(false)} />}
    </div>
  )
}

export function FolderPage({ folder, back }: { folder: string; back: () => void }) {
  const libraryTracks = useLibrary()
  const tracks = useMemo(() => sortByFileName(libraryTracks.filter((t) => t.folder === folder)), [libraryTracks, folder])
  const coverStyle = useCoverStyle(tracks.find((t) => t.cover)?.cover)
  if (!tracks.length) return <div className="ms-empty"><p>This folder is no longer in the library.</p></div>
  return (
    <div className="ms-scroll">
      <TopBar back={back} />
      <div className="ms-detail ms-folder-page" style={coverStyle}>
        <DetailHeader
          cover={tracks.find((t) => t.cover)?.cover ?? ''}
          title={folderPath(folder)}
          sub={trackCount(tracks.length)}
          actions={<FolderActions tracks={tracks} />}
          genre={tracks[0]?.genre}
          speciality={tracks[0]?.category}
        />
        <TrackTable tracks={tracks} numbers="none" />
      </div>
    </div>
  )
}

function DetailHeader({ cover, title, sub, actions, genre, speciality, onCover }: { cover: string; title: string; sub: React.ReactNode; actions?: React.ReactNode; genre?: string; speciality?: string; onCover?: (e: React.MouseEvent<HTMLElement>) => void }) {
  const art = <Cover id={cover} alt={title} className="ms-detail-cover" genre={genre} speciality={speciality} title={title} />
  return (
    <header className="ms-detail-head">
      {onCover ? <button type="button" className="ms-detail-cover-btn" aria-label="Change cover" onClick={onCover}>{art}<span className="ms-detail-cover-edit"><Icon name="photo_camera" size={20} /></span></button> : art}
      <div className="ms-detail-info">
        <div>
          <h1>{title}</h1>
          <p className="ms-detail-sub">{sub}</p>
        </div>
        {actions && <div className="ms-detail-actions">{actions}</div>}
      </div>
    </header>
  )
}

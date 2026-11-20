import { useMemo, useState } from 'react'
import { Cover, Icon, IconButton, Menu, TopBar } from '../ui'
import { useShell } from '../context'
import {
  NO_FILTERS, activeFilterCount, filterTracks, folderPath, groupAlbums, groupArtists, isPcTrack, mergeTwins, isPremiumQuality, shuffled, sortByFileName, sortTracks, trackCount, useLibrary,
  type Filters, type SortMode, type Track,
} from '../library'
import { missingTrack } from '../playlistSync'
import { TrackTable } from './TrackTable'
import { FilterDialog, FolderActions, Tile, below, sortMenuItems } from './LibraryPage'
import { useCoverStyle } from '../cover'
import { useListening } from '../stats'
import { buildHomeShelves } from './HomePage'
import { pickSquareImage, SHELF_PREFIX } from './playlistCover'
import { getSetting, setSetting, useArtistSeparators, useArtistsByAlbumArtist } from '../settings/store'

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

/** §94 B: the tool row's button says only this, so sort, Filter and Edit order fit on one line on the phone. */
const SHORT_SORT: Record<PlaylistSortMode, string> = {
  custom: 'Playlist order', title: 'Title', artist: 'Artist', album: 'Album', 'added-desc': 'Newest', 'added-asc': 'Oldest',
  'duration-asc': 'Shortest', 'duration-desc': 'Longest', quality: 'Quality',
}

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
  const [editing, setEditing] = useState(false)
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
  const coverStyle = useCoverStyle(playlist?.cover || tracks.find((t) => t.cover)?.cover)

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

  // §91 C/D: songs move right in the list, only while it shows the playlist's own order; each move is saved at once
  const canMove = !shelf && sortMode === 'custom' && sourceFilter === 'all' && !query
  const reorder = (ids: string[]) => {
    const before = playlist.tracks
    // a song missing from the library keeps its place at the end, so a move can't lose it
    update({ tracks: [...ids, ...playlist.tracks.filter((x) => !tracks.some((t) => t.id === x))] })
    showToast({ message: 'Order saved', action: { label: 'Undo', onClick: () => update({ tracks: before }) } })
  }

  return (
    <div className="ms-scroll">
      {/* §89 D: rename, share and delete live in the playlist's long-press menu in Library; the cover changes on a tap */}
      <TopBar title={playlist.name} back={back} />
      <div className="ms-detail">
        <DetailHeader
          cover={cover}
          title={playlist.name}
          kicker={shelf ? 'Mix' : 'Playlist'}
          style={coverStyle}
          onCover={shelf ? undefined : (e) => (playlist.cover ? setCoverMenu(below(e)) : chooseCover())}
          sub={
            <>
              <Icon name="queue_music" size={18} />{' '}
              {visibleTracks.length !== tracks.length
                ? `${visibleTracks.length} of ${trackCount(tracks.length)}`
                : trackCount(tracks.length)}
              {' · '}{totalTime(visibleTracks)}
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
          <div className="ms-tools ms-pl-tools">
            <button
              type="button"
              className="ms-tool"
              aria-label={`Sort playlist: ${currentSortLabel}`}
              onClick={(e) => setSortMenu(below(e))}
            >
              <Icon name="sort" size={20} /> {SHORT_SORT[sortMode]}
            </button>
            <button
              type="button"
              className={`ms-tool${sourceFilter !== 'all' ? ' on' : ''}`}
              aria-label={`Filter: ${currentFilterLabel}`}
              onClick={(e) => setFilterMenu(below(e))}
            >
              <Icon name="filter_list" size={20} /> {sourceFilter === 'all' ? 'Filter' : currentFilterLabel}
            </button>
            {!shelf && tracks.length > 1 && (
              <button type="button" className={`ms-tool${editing ? ' on' : ''}`} onClick={() => setEditing(!editing)}>
                <Icon name="drag_handle" size={20} /> Edit order
              </button>
            )}
          </div>
        </div>

        {editing && !canMove && (
          <button type="button" className="ms-move-hint" onClick={() => { setSortMode('custom'); setSourceFilter('all'); setQuery('') }}>
            <Icon name="swap_vert" size={18} /> Switch to Playlist order to move songs
          </button>
        )}
        <TrackTable
          tracks={visibleTracks}
          playlistId={shelf ? undefined : playlist.id}
          playlistName={playlist.name}
          editing={editing}
          onEditing={setEditing}
          onReorder={canMove ? reorder : undefined}
        />
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
    const { albums, singles } = groupAlbums(mergeTwins(libraryTracks))
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

export function ArtistPage({ name, back }: { name: string; back: () => void }) {
  const { play, push } = useShell()
  const libraryTracks = useLibrary()
  const separators = useArtistSeparators()
  const byAlbumArtist = useArtistsByAlbumArtist()
  // a guest-only artist (opened from search) still has a page: their songs from the full list
  const artist = useMemo(
    () => groupArtists(mergeTwins(libraryTracks), separators, byAlbumArtist).find((a) => a.name === name) ?? groupArtists(mergeTwins(libraryTracks), separators).find((a) => a.name === name),
    [libraryTracks, name, separators, byAlbumArtist],
  )
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
        {artist.appearsOn.length > 0 && query === null && (
          <>
            <h2 className="ms-h2">Appears on</h2>
            <TrackTable tracks={artist.appearsOn} />
          </>
        )}
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

/** "1 hr 12 min" / "48 min": a list's total length, as Spotify writes it. */
export function totalTime(tracks: Track[]): string {
  const min = Math.round(tracks.reduce((sum, t) => sum + (t.sec || 0), 0) / 60)
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`
}

function DetailHeader({ cover, title, sub, actions, genre, speciality, onCover, kicker, style }: { cover: string; title: string; sub: React.ReactNode; actions?: React.ReactNode; genre?: string; speciality?: string; onCover?: (e: React.MouseEvent<HTMLElement>) => void; kicker?: string; style?: React.CSSProperties }) {
  const art = <Cover id={cover} alt={title} className="ms-detail-cover" genre={genre} speciality={speciality} title={title} />
  return (
    // §91 D: with a kicker ("Playlist") the PC shows Spotify's header: a band tinted from the cover, a large title
    <header className={`ms-detail-head${kicker ? ' band' : ''}`} style={style}>
      {/* §91 B: only the photo button changes the cover; a tap on the cover itself does nothing */}
      {onCover ? <div className="ms-detail-cover-btn">{art}<button type="button" className="ms-detail-cover-edit" aria-label="Change cover" title="Change cover" onClick={onCover}><Icon name="photo_camera" size={20} /></button></div> : art}
      <div className="ms-detail-info">
        <div>
          {kicker && <span className="ms-detail-kicker">{kicker}</span>}
          <h1>{title}</h1>
          <p className="ms-detail-sub">{sub}</p>
        </div>
        {actions && <div className="ms-detail-actions">{actions}</div>}
      </div>
    </header>
  )
}

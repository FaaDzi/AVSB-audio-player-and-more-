import { useMemo, useState } from 'react'
import { Cover, Icon, IconButton } from '../ui'
import { useShell } from '../context'
import { groupAlbums, groupArtists, trackCount } from '../library'
import { useTrackMenu } from './TrackMenu'
import { useArtistSeparators } from '../settings/store'

const KINDS = ['All', 'Songs', 'Albums', 'Artists', 'Playlists'] as const
type Kind = (typeof KINDS)[number]

/** Library search: its own layout with kind chips and sections, as on the reference. */
export function SearchResults({ query }: { query: string }) {
  const { data, play, push, openPlaylist, current, playing, setPlaying } = useShell()
  const [kind, setKind] = useState<Kind>('All')
  const [songsAsGrid, setSongsAsGrid] = useState(false)
  const menu = useTrackMenu()
  const q = query.trim().toLowerCase()
  const separators = useArtistSeparators()

  const found = useMemo(() => {
    const has = (...parts: string[]) => parts.some((p) => p?.toLowerCase().includes(q))
    const { albums, singles } = groupAlbums(data.tracks)
    return {
      songs: data.tracks.filter((t) => has(t.title, t.artist, t.album)),
      albums: [...albums, ...singles].filter((a) => has(a.name, a.artist)),
      artists: groupArtists(data.tracks, separators).filter((a) => has(a.name)),
      playlists: data.playlists.filter((p) => has(p.name)),
    }
  }, [data, q, separators])

  const limit = (n: number) => (kind === 'All' ? n : Infinity)
  const show = (k: Kind, count: number) => (kind === 'All' || kind === k) && count > 0
  const nothing = !found.songs.length && !found.albums.length && !found.artists.length && !found.playlists.length
  const heading = (title: Kind, extra?: React.ReactNode) => (
    <header className="ms-sr-head">
      <h2>{title}</h2>
      {extra}
      {kind === 'All' && <IconButton icon="chevron_right" label={`All ${title.toLowerCase()}`} onClick={() => setKind(title)} />}
    </header>
  )

  return (
    <div className="ms-sr">
      <div className="ms-chips">
        {KINDS.map((k) => (
          <button type="button" key={k} className={`ms-chip big${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>
        ))}
      </div>
      {nothing && <div className="ms-empty small"><Icon name="search_off" size={32} /><p>No results</p></div>}

      {show('Songs', found.songs.length) && (
        <section>
          {heading('Songs', <IconButton icon={songsAsGrid ? 'view_list' : 'grid_view'} label={songsAsGrid ? 'Show as list' : 'Show as grid'} active={songsAsGrid} onClick={() => setSongsAsGrid(!songsAsGrid)} />)}
          <div className={songsAsGrid ? 'ms-sr-grid' : 'ms-sr-list'}>
            {found.songs.slice(0, limit(5)).map((t) => (
              <article className="ms-sr-song" key={t.id} onClick={() => play(t, found.songs)} onContextMenu={(e) => menu.open(e, t)}>
                <button type="button" className="ms-thumb-link" aria-label={`Details for ${t.title}`} onClick={(e) => { e.stopPropagation(); push({ page: 'song', id: t.id }) }}>
                  <Cover id={t.cover} className="ms-sr-art" />
                </button>
                <span className="ms-sr-text">
                  <b>{t.title}</b>
                  <small>{t.artist || 'Unknown Artist'}</small>
                </span>
                <IconButton icon={current?.id === t.id && playing ? 'pause' : 'play_arrow'} label={`${current?.id === t.id && playing ? 'Pause' : 'Play'} ${t.title}`} onClick={(e) => { e.stopPropagation(); if (current?.id === t.id) setPlaying(!playing); else play(t, found.songs) }} />
              </article>
            ))}
          </div>
        </section>
      )}

      {show('Albums', found.albums.length) && (
        <section>
          {heading('Albums')}
          {found.albums.slice(0, limit(5)).map((a) => (
            <button type="button" className="ms-sr-row" key={a.key} onClick={() => push({ page: 'album', key: a.key })}>
              <Cover id={a.cover} className="ms-sr-art" />
              <span className="ms-sr-text"><b>{a.name}</b><small>{a.artist} · {trackCount(a.tracks.length)}</small></span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </section>
      )}

      {show('Artists', found.artists.length) && (
        <section>
          {heading('Artists')}
          {found.artists.slice(0, limit(5)).map((a) => (
            <button type="button" className="ms-sr-row" key={a.name} onClick={() => push({ page: 'artist', name: a.name })}>
              <Cover id={a.cover} className="ms-sr-art round" />
              <span className="ms-sr-text"><b>{a.name}</b><small>{trackCount(a.tracks.length)}</small></span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </section>
      )}

      {show('Playlists', found.playlists.length) && (
        <section>
          {heading('Playlists')}
          {found.playlists.slice(0, limit(5)).map((p) => (
            <button type="button" className="ms-sr-row" key={p.id} onClick={() => openPlaylist(p.id)}>
              <span className="ms-sr-art ms-cover-none"><Icon name="queue_music" /></span>
              <span className="ms-sr-text"><b>{p.name}</b><small>{trackCount(p.tracks.length)}</small></span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </section>
      )}
      {menu.node}
    </div>
  )
}

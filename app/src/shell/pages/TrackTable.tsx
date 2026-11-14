import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cover, Icon, IconButton, Menu, useLongPress, type MenuItem } from '../ui'
import { useShell } from '../context'
import { canPlay, duration, removeFromPlaylist, type Track } from '../library'
import { useTrackMenu } from './TrackMenu'

type Column = 'artist' | 'album' | 'quality'

/** The numbered song table on playlist, album and folder pages. Double-click plays, as on the reference. */
export function TrackTable({ tracks, columns = ['artist', 'album', 'quality'], numbers = 'position', thumbs = true, playlistId }: {
  tracks: Track[]
  columns?: Column[]
  numbers?: 'position' | 'track' | 'none'
  thumbs?: boolean
  /** Set on a playlist page, which adds "Remove from playlist" to the selection menu. */
  playlistId?: string
}) {
  const { current, data, playing, play, push, replaceData, showToast } = useShell()
  const menu = useTrackMenu(playlistId)
  const press = useLongPress()
  // right-click enters selection mode, with a "1 selected" bar over the page and a menu for the selection
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickMenu, setPickMenu] = useState<{ x: number; y: number } | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const selecting = picked.size > 0
  const pickedTracks = tracks.filter((t) => picked.has(t.id))

  useEffect(() => {
    if (!selecting) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.ms-menu-scrim:not(.ms-exit)')) setPicked(new Set()) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [selecting])

  const toggle = (id: string) => setPicked((now) => {
    const next = new Set(now)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const pickItems = (): MenuItem[] => {
    const n = pickedTracks.length
    const first = pickedTracks[0]
    if (!first) return []
    return [
      { label: 'Play', icon: 'play_arrow', onSelect: () => { play(first, pickedTracks); setPicked(new Set()) } },
      { label: 'Show details', icon: 'info', divider: true, onSelect: () => { setPicked(new Set()); push({ page: 'song', id: first.id }) } },
      { label: `Add to playlist (${n})`, icon: 'playlist_add', divider: Boolean(playlistId), onSelect: () => { menu.addToPlaylist(pickedTracks); setPicked(new Set()) } },
      ...(playlistId ? [{
        label: `Remove from playlist (${n})`, icon: 'do_not_disturb_on', danger: true, onSelect: () => {
          const ids = new Set(pickedTracks.map((t) => t.id))
          replaceData(removeFromPlaylist(data, playlistId, [...ids]))
          showToast(n === 1 ? `Removed "${first.title}"` : `Removed ${n} songs`)
          setPicked(new Set())
        },
      }] : []),
    ]
  }
  const template = `${numbers === 'none' ? '' : '52px '}minmax(0, 1.65fr) ${columns.map((c) => (c === 'quality' ? '135px' : 'minmax(0, 1fr)')).join(' ')} 72px 36px`

  return (
    <div className="ms-table" role="table" ref={anchor} style={{ '--cols': template } as React.CSSProperties}>
      <div className="ms-tr head" role="row">
        {numbers !== 'none' && <div className="ms-td num" role="columnheader">#</div>}
        <div className="ms-td" role="columnheader">Title</div>
        {columns.map((c) => <div className="ms-td" role="columnheader" key={c}>{c[0].toUpperCase() + c.slice(1)}</div>)}
        <div className="ms-td end" role="columnheader">Duration</div>
        <div />
      </div>
      {tracks.map((t, i) => {
        const on = current?.id === t.id
        return (
          <div
            className={`ms-tr${on ? ' on' : ''}${picked.has(t.id) ? ' picked' : ''}${canPlay(t) ? '' : ' unplayable'}`}
            title={canPlay(t) ? undefined : t.missing ? 'Only on your phone: send it from the phone' : t.offline ? 'Its folder isn’t connected' : `${t.format} files can’t be played yet`}
            role="row"
            key={`${t.id}-${i}`}
            onClick={() => {
              if (selecting) toggle(t.id)
              else play(t, tracks)
            }}
            // right-click, or hold on a touch screen: select the row and open the selection menu
            {...press((x, y) => {
              setPicked((now) => (now.has(t.id) ? now : new Set(now).add(t.id)))
              setPickMenu({ x, y })
            })}
          >
            {numbers !== 'none' && (
              <div className="ms-td num" role="cell">
                {on ? <Bars moving={playing} /> : numbers === 'track' ? t.track || '-' : i + 1}
              </div>
            )}
            <div className="ms-td title" role="cell">
              {thumbs && (
                <button type="button" className="ms-thumb-link" aria-label={`Details for ${t.title}`} onClick={(e) => { if (!selecting) { e.stopPropagation(); push({ page: 'song', id: t.id }) } }}>
                  <Cover id={t.cover} className="ms-thumb" genre={t.genre} speciality={t.category} title={t.title} />
                </button>
              )}
              <span className="ms-title-stack">
                <span className="ms-title-link">{t.title}</span>
                {/* the phone shows one line under the title instead of the Artist, Album and Quality columns */}
                <span className="ms-phone-sub">{t.artist || 'Unknown Artist'} · {t.lossy ? t.format : `${t.format} ${t.bits}-bit`}</span>
              </span>
              {thumbs && numbers !== 'none' && <span className="ms-local" title="On this computer"><Icon name="folder" size={16} /></span>}
            </div>
            {columns.map((c) => (
              <div className="ms-td ms-ellipsis" role="cell" key={c}>{c === 'artist' ? t.artist || 'Unknown Artist' : c === 'album' ? t.album || 'Unknown Album' : t.lossy ? `${t.format} ${t.kbps}kbps` : `${t.bits}-bit/${t.rate / 1000}kHz`}</div>
            ))}
            <div className="ms-td end" role="cell">{duration(t.sec)}</div>
            <div className="ms-td more" role="cell">
              <button type="button" className="ms-rowmenu" aria-label={`More for ${t.title}`} onClick={(e) => { e.stopPropagation(); menu.open(e, t) }}>
                <Icon name="more_vert" size={20} />
              </button>
            </div>
          </div>
        )
      })}
      {menu.node}
      {pickMenu && selecting && <Menu x={pickMenu.x} y={pickMenu.y} items={pickItems()} onClose={() => setPickMenu(null)} />}
      {selecting && anchor.current?.closest('.ms-layer') && createPortal(
        <div className="ms-select-bar">
          <IconButton icon="close" label="Clear selection" filled onClick={() => setPicked(new Set())} />
          <b>{picked.size} selected</b>
        </div>,
        anchor.current.closest('.ms-layer')!,
      )}
    </div>
  )
}

function Bars({ moving }: { moving: boolean }) {
  return <span className={`ms-bars${moving ? ' moving' : ''}`} aria-label="Playing"><i /><i /><i /></span>
}

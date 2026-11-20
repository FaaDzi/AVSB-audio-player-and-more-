import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cover, Icon, IconButton, Menu, useLongPress, type MenuItem } from '../ui'
import { useShell } from '../context'
import { canPlay, duration, moveItem, removeFromPlaylist, type Track } from '../library'
import { onPhoneBack, setSelectionBar, usePhone } from '../PhoneNav'
import { sharePlaylist } from './playlistCover'
import { useTrackMenu } from './TrackMenu'

type Column = 'artist' | 'album' | 'quality'

/**
 * The numbered song table on playlist, album and folder pages. Selection mode (§91 C/D): hold a row on the phone, or
 * right-click / Ctrl / Shift on the PC. On a playlist in its own order, rows move by drag (the phone's handle, the
 * PC's whole row) and each move is saved at once, with Undo.
 */
export function TrackTable({ tracks, columns = ['artist', 'album', 'quality'], numbers = 'position', thumbs = true, playlistId, playlistName, editing = false, onEditing, onReorder }: {
  tracks: Track[]
  columns?: Column[]
  numbers?: 'position' | 'track' | 'none'
  thumbs?: boolean
  /** Set on a playlist page, which adds "Remove from playlist" to the selection. */
  playlistId?: string
  playlistName?: string
  /** Edit mode with nothing picked yet (the playlist's "Edit order" button). */
  editing?: boolean
  onEditing?: (on: boolean) => void
  /** Given only while the list shows the playlist's own order: the new order of these songs' ids. */
  onReorder?: (ids: string[]) => void
}) {
  const { current, data, playing, play, push, replaceData, showToast } = useShell()
  const phone = usePhone()
  const menu = useTrackMenu(playlistId)
  const press = useLongPress()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickMenu, setPickMenu] = useState<{ x: number; y: number } | null>(null)
  const lastClicked = useRef<number | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const selecting = editing || picked.size > 0
  const pickedTracks = tracks.filter((t) => picked.has(t.id))
  const exit = () => {
    setPicked(new Set())
    onEditing?.(false)
  }

  // ---- moving rows: the index being dragged and where it would land
  const [drag, setDrag] = useState<{ from: number; to: number; offset: number } | null>(null)
  const dragNow = useRef(drag)
  dragNow.current = drag
  const held = useRef<{ from: number; pointer: number; startY: number; rowHeight: number; scroller: HTMLElement } | null>(null)
  const pending = useRef<{ index: number; y: number } | null>(null)
  const justDragged = useRef(false)
  const follow = () => {
    const h = held.current
    if (!h) return
    const moved = h.pointer + h.scroller.scrollTop - h.startY
    const to = Math.max(0, Math.min(tracks.length - 1, h.from + Math.round(moved / h.rowHeight)))
    setDrag({ from: h.from, to, offset: moved - (to - h.from) * h.rowHeight })
  }
  const grab = (e: React.PointerEvent<HTMLElement>, from: number) => {
    const row = e.currentTarget.closest<HTMLElement>('.ms-tr')
    const scroller = e.currentTarget.closest<HTMLElement>('.ms-scroll')
    if (!row || !scroller) return
    e.currentTarget.setPointerCapture(e.pointerId)
    held.current = { from, pointer: e.clientY, startY: e.clientY + scroller.scrollTop, rowHeight: row.offsetHeight, scroller }
    setDrag({ from, to: from, offset: 0 })
  }
  const release = () => {
    pending.current = null
    if (!held.current) return
    held.current = null
    const d = dragNow.current
    setDrag(null)
    if (!d || d.from === d.to || !onReorder) return
    justDragged.current = true
    onReorder(moveItem(tracks.map((t) => t.id), d.from, d.to))
  }
  const move = (e: React.PointerEvent<HTMLElement>, index: number) => {
    if (held.current) {
      held.current.pointer = e.clientY
      follow()
    } else if (pending.current?.index === index && Math.abs(e.clientY - pending.current.y) > 6) {
      grab(e, index)
    }
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
        const speed = h.pointer < box.top + 56 ? -8 : h.pointer > box.bottom - 56 ? 8 : 0
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

  // ---- leaving selection: Escape on the PC, back on the phone
  useEffect(() => {
    if (!selecting) return
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.ms-menu-scrim:not(.ms-exit), .ms-scrim:not(.ms-exit)')) return
      if (e.key === 'Escape') exit()
      // Delete removes the selected songs from the playlist, with Undo (Spotify)
      if ((e.key === 'Delete' || e.key === 'Backspace') && playlistId && picked.size && !(e.target instanceof HTMLInputElement)) removePicked()
    }
    window.addEventListener('keydown', key)
    const unBack = onPhoneBack(() => { exit(); return true })
    return () => { window.removeEventListener('keydown', key); unBack() }
  })

  const toggle = (id: string) => setPicked((now) => {
    const next = new Set(now)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const removePicked = () => {
    if (!playlistId) return
    const n = pickedTracks.length
    const before = data
    replaceData(removeFromPlaylist(data, playlistId, pickedTracks.map((t) => t.id)))
    showToast({ message: n === 1 ? `Removed "${pickedTracks[0].title}"` : `Removed ${n} songs`, action: { label: 'Undo', onClick: () => replaceData(before) } })
    exit()
  }
  const playPicked = () => { if (pickedTracks[0]) play(pickedTracks[0], pickedTracks); exit() }
  const addPicked = () => { menu.addToPlaylist(pickedTracks); exit() }
  const sharePicked = () => { void sharePlaylist(playlistName ?? 'Songs', pickedTracks); exit() }

  // the phone's bar in the mini player's place, as in Samsung Music
  const none = picked.size === 0
  useEffect(() => {
    if (!phone || !selecting) return
    setSelectionBar([
      { icon: 'play_arrow', label: 'Play', disabled: none, onClick: playPicked },
      { icon: 'playlist_add', label: 'Add', disabled: none, onClick: addPicked },
      { icon: 'share', label: 'Share', disabled: none, onClick: sharePicked },
      ...(playlistId ? [{ icon: 'do_not_disturb_on', label: 'Remove', disabled: none, onClick: removePicked }] : []),
    ])
    return () => setSelectionBar(null)
  })

  const pickItems = (): MenuItem[] => {
    const n = pickedTracks.length
    const first = pickedTracks[0]
    if (!first) return []
    return [
      { label: 'Play', icon: 'play_arrow', onSelect: playPicked },
      { label: 'Show details', icon: 'info', divider: true, onSelect: () => { exit(); push({ page: 'song', id: first.id }) } },
      { label: `Add to playlist (${n})`, icon: 'playlist_add', divider: Boolean(playlistId), onSelect: addPicked },
      ...(playlistId ? [{ label: `Remove from this playlist (${n})`, icon: 'do_not_disturb_on', danger: true, onSelect: removePicked }] : []),
    ]
  }
  const template = `${numbers === 'none' ? '' : '52px '}minmax(0, 1.65fr) ${columns.map((c) => (c === 'quality' ? '135px' : 'minmax(0, 1fr)')).join(' ')} 72px 36px`
  const order = drag ? moveItem(tracks.map((_, i) => i), drag.from, drag.to) : tracks.map((_, i) => i)
  const handles = phone && selecting && Boolean(onReorder)
  const allPicked = tracks.length > 0 && tracks.every((t) => picked.has(t.id))

  return (
    <div className={`ms-table${selecting ? ' selecting' : ''}${onReorder && !phone ? ' movable' : ''}`} role="table" ref={anchor} style={{ '--cols': template } as React.CSSProperties}>
      <div className="ms-tr head" role="row">
        {numbers !== 'none' && <div className="ms-td num" role="columnheader">#</div>}
        <div className="ms-td" role="columnheader">Title</div>
        {columns.map((c) => <div className="ms-td" role="columnheader" key={c}>{c[0].toUpperCase() + c.slice(1)}</div>)}
        <div className="ms-td end" role="columnheader">Duration</div>
        <div />
      </div>
      {order.map((i, place) => {
        const t = tracks[i]
        const on = current?.id === t.id
        const moving = drag?.from === i
        const hold = press((x, y) => {
          setPicked((now) => (now.has(t.id) ? now : new Set(now).add(t.id)))
          // the phone just enters selection mode; the PC's right-click also opens the selection's menu
          if (!phone) setPickMenu({ x, y })
        })
        return (
          <div
            className={`ms-tr${on ? ' on' : ''}${picked.has(t.id) ? ' picked' : ''}${moving ? ' moving' : ''}${canPlay(t) ? '' : ' unplayable'}`}
            title={canPlay(t) ? undefined : t.missing ? 'Only on your phone: send it from the phone' : t.offline ? 'Its folder isn’t connected' : `${t.format} files can’t be played yet`}
            role="row"
            key={`${t.id}-${i}`}
            style={moving ? { transform: `translateY(${drag.offset}px)` } : undefined}
            onClick={(e) => {
              if (justDragged.current) { justDragged.current = false; return }
              if (!phone && e.shiftKey && lastClicked.current !== null) {
                const [a, b] = [Math.min(lastClicked.current, place), Math.max(lastClicked.current, place)]
                setPicked(new Set(order.slice(a, b + 1).map((j) => tracks[j].id)))
              } else if (!phone && (e.ctrlKey || e.metaKey)) {
                toggle(t.id)
                lastClicked.current = place
              } else if (selecting) {
                toggle(t.id)
                lastClicked.current = place
              } else {
                play(t, tracks)
              }
            }}
            {...hold}
            // the PC drags a whole row (after a few pixels, so a click still plays)
            onPointerDown={(e) => {
              hold.onPointerDown(e)
              if (onReorder && !phone && e.pointerType === 'mouse' && e.button === 0 && !e.shiftKey && !e.ctrlKey) pending.current = { index: i, y: e.clientY }
            }}
            onPointerMove={(e) => { if (!phone) move(e, i) }}
            onPointerUp={(e) => { hold.onPointerUp(); if (!phone) release(); void e }}
            onPointerCancel={() => { hold.onPointerCancel(); if (!phone) release() }}
          >
            {numbers !== 'none' && (
              <div className="ms-td num" role="cell">
                {on ? <Bars moving={playing} /> : numbers === 'track' ? t.track || '-' : place + 1}
              </div>
            )}
            <div className="ms-td title" role="cell">
              {phone && selecting && <span className={`ms-check${picked.has(t.id) ? ' on' : ''}`} aria-hidden="true"><Icon name="check" size={16} /></span>}
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
              {handles ? (
                <span
                  className="ms-drag-handle"
                  aria-label={`Move ${t.title}`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => { e.stopPropagation(); grab(e, i) }}
                  onPointerMove={(e) => move(e, i)}
                  onPointerUp={release}
                  onPointerCancel={release}
                >
                  <Icon name="drag_handle" size={22} />
                </span>
              ) : !(phone && selecting) && (
                <button type="button" className="ms-rowmenu" aria-label={`More for ${t.title}`} onClick={(e) => { e.stopPropagation(); menu.open(e, t) }}>
                  <Icon name="more_vert" size={20} />
                </button>
              )}
            </div>
          </div>
        )
      })}
      {menu.node}
      {pickMenu && picked.size > 0 && <Menu x={pickMenu.x} y={pickMenu.y} items={pickItems()} onClose={() => setPickMenu(null)} />}
      {selecting && anchor.current?.closest('.ms-layer') && createPortal(
        <div className="ms-select-bar">
          <IconButton icon="close" label="Leave selection" filled onClick={exit} />
          <button type="button" className={`ms-select-all${allPicked ? ' on' : ''}`} onClick={() => setPicked(allPicked ? new Set() : new Set(tracks.map((t) => t.id)))}>
            <span className="ms-check" aria-hidden="true"><Icon name="check" size={16} /></span>
            All
          </button>
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

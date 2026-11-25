import { useState } from 'react'
import { Dialog, Icon, IconButton, Menu, type MenuItem } from '../ui'
import { useShell } from '../context'
import { albumKey, deletePlaylist, folderName, folderPath, hideFolder as hideLibraryFolder, isFavoritesList, isPcPlaylist, isPcTrack, isPlaylistSaved, playlistNamesForTrack, removeFromPlaylist, trashTrackOnHost, type Playlist, type Track } from '../library'
import { android, hideFolder as hideHostFolder } from '../localLibrary'
import { savedDetails, undoTrackDetails } from '../metadata'
import { clearFavorites, isLiked, toggleLike } from '../favorites'
import { setPlaylistHidden } from '../playlistLink'
import { logLine } from '../logs'
import { phoneLink } from '../linkClient'

function parentFolderOf(t: Track): string {
  if (t.folder && t.folder !== '.') return t.folder
  const norm = (t.path || '').replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx > 0 ? norm.slice(0, idx) : ''
}

function formatSizeMb(bytes: number): string {
  if (!bytes || bytes <= 0) return 'Unknown size'
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

/**
 * The song ⋮ menu, including "Hide this folder" (§71.F3) and recoverable "Delete from device…" (§72.B). On a playlist
 * page (playlistId) it also offers "Remove from playlist".
 */
export function useTrackMenu(playlistId?: string) {
  const { data, replaceData, queue, setQueue, push, showToast } = useShell()
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track } | null>(null)
  const [adding, setAdding] = useState<Track[] | null>(null)
  const [deleting, setDeleting] = useState<Track | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const open = (e: React.MouseEvent, track: Track) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, track })
  }
  const openAt = (x: number, y: number, track: Track) => setMenu({ x, y, track })
  const inPlaylist = data.playlists.find((p) => p.id === playlistId)

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    showToast(`Copied "${text}"`)
  }

  const onHideFolder = (t: Track) => {
    const folder = parentFolderOf(t)
    if (!folder) return
    hideLibraryFolder(folder)
    if (android) {
      void hideHostFolder(folder).catch(() => { /* local filter already applied */ })
    }
    showToast(`${folderPath(folder)} hidden. Add it back in Settings → Local Library`)
  }

  const confirmDelete = async (t: Track) => {
    if (busyDelete) return
    setBusyDelete(true)
    try {
      const res = await trashTrackOnHost(t)
      if (!res.ok) { setDeleting(null); return }
      // Remove from active library state, queue, and playlists while keeping stats.ts intact (§72.B3)
      replaceData({
        ...data,
        tracks: data.tracks.filter((x) => x.id !== t.id),
        playlists: data.playlists.map((p) => ({
          ...p,
          tracks: p.tracks.filter((id) => id !== t.id),
        })),
      })
      if (queue.some((x) => x.id === t.id)) {
        setQueue(queue.filter((x) => x.id !== t.id))
      }
      setDeleting(null)
      if (isPcTrack(t) || res.where === 'cache') {
        showToast(`Removed "${t.title}" from this phone's cache`)
      } else if (android || res.where === 'trash') {
        showToast(`Moved "${t.title}" to the phone's trash`)
      } else {
        showToast(`Moved "${t.title}" to the Recycle Bin`)
      }
    } finally {
      setBusyDelete(false)
    }
  }

  const items = (t: Track): MenuItem[] => {
    const parentFolder = parentFolderOf(t)
    const remotePc = isPcTrack(t)
    return [
      ...(inPlaylist && !isPcPlaylist(inPlaylist)
        ? [{
            label: `Remove from "${inPlaylist.name}"`,
            icon: 'do_not_disturb_on',
            danger: true,
            divider: true,
            onSelect: () => {
              replaceData(removeFromPlaylist(data, inPlaylist.id, [t.id]))
              showToast(`Removed "${t.title}"`)
            },
          }]
        : []),
      { label: 'Download', icon: 'download', divider: true, onSelect: () => showToast('Download is here for layout only') },
      // §80 A: a phone song the PC doesn't have (a "missing song" in a shared playlist) goes into its library
      ...(android && !remotePc && phoneLink?.upload
        ? [{
            label: 'Send to PC',
            icon: 'upload',
            divider: true,
            onSelect: () => {
              showToast(`Sending "${t.title}" to the PC…`)
              phoneLink!.upload!({ uri: t.path, name: `${t.artist} - ${t.title}.${t.format.toLowerCase()}` })
                .then(() => showToast(`"${t.title}" is on the PC now`))
                .catch((e: unknown) => showToast(`Couldn't send "${t.title}": ${e instanceof Error ? e.message : String(e)}`))
            },
          }]
        : []),
      {
        label: isLiked(t.id) ? 'Remove from Loved' : 'Add to Loved',
        icon: isLiked(t.id) ? 'favorite' : 'favorite_border',
        onSelect: () => {
          const liked = toggleLike(t, data, replaceData)
          showToast(liked ? `"${t.title}" added to Loved` : `"${t.title}" removed from Loved`)
        },
      },
      { label: 'Add to Wishlist', icon: 'bookmark', onSelect: () => showToast(`"${t.title}" added to Wishlist`) },
      { label: 'Add to playlist', icon: 'playlist_add', divider: true, onSelect: () => setAdding([t]) },
      ...(albumKey(t) ? [{ label: 'Go to Album', icon: 'album', divider: true, onSelect: () => push({ page: 'album', key: albumKey(t) }) }] : []),
      { label: 'Copy track name', icon: 'content_copy', onSelect: () => copy(t.title) },
      { label: 'Copy artist', icon: 'content_copy', onSelect: () => copy(t.artist) },
      { label: 'Copy track and artist', icon: 'content_copy', divider: true, onSelect: () => copy(`${t.title} - ${t.artist}`) },
      ...(parentFolder
        ? [{
            label: `Hide this folder (${folderName(parentFolder)})`,
            icon: 'visibility_off',
            onSelect: () => onHideFolder(t),
          }]
        : []),
      ...(savedDetails(t.id) || t.originalTitle
        ? [{
            label: 'Restore original file tags',
            icon: 'undo',
            divider: true,
            onSelect: async () => {
              await undoTrackDetails(t.id)
              showToast(`Restored original file tags for "${t.originalTitle ?? t.title}"`)
            },
          }]
        : []),
      {
        label: remotePc ? "Remove from this phone's cache…" : 'Delete from device…',
        icon: 'delete',
        onSelect: () => setDeleting(t),
      },
    ]
  }

  const node = (
    <>
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.track)} onClose={() => setMenu(null)} />}
      {adding && <AddToPlaylist tracks={adding} onClose={() => setAdding(null)} />}
      {deleting && (
        <Dialog
          title={isPcTrack(deleting) ? "Remove from this phone's cache?" : 'Delete from device?'}
          onClose={() => !busyDelete && setDeleting(null)}
          footer={
            <>
              <button type="button" className="ms-btn text" disabled={busyDelete} onClick={() => setDeleting(null)}>Cancel</button>
              <button
                type="button"
                className="ms-btn danger"
                disabled={busyDelete}
                onClick={() => void confirmDelete(deleting)}
              >
                {isPcTrack(deleting) ? 'Remove from cache' : 'Delete'}
              </button>
            </>
          }
        >
          <p>
            <b>{deleting.title}</b>
            {deleting.artist ? ` — ${deleting.artist}` : ''} ({formatSizeMb(deleting.size)})
          </p>
          <p style={{ opacity: 0.8, fontSize: 13 }}>
            {isPcTrack(deleting)
              ? "Remove from this phone's cache. The original file on your PC is untouched, and your listening stats are kept."
              : android
                ? "Moved to the phone's trash (recoverable for 30 days). Your listening stats are kept."
                : 'Moved to the Recycle Bin. You can restore it from there anytime, and your listening stats are kept.'}
          </p>
        </Dialog>
      )}
    </>
  )
  return { open, openAt, node, addToPlaylist: setAdding }
}

function AddToPlaylist({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { data, replaceData, showToast } = useShell()
  // §98: the PC's playlists are read-only on a phone, so they aren't offered here
  const own = data.playlists.filter((p) => !isPcPlaylist(p))
  const [ticked, setTicked] = useState(() => new Set(own.filter((p) => tracks.every((t) => p.tracks.includes(t.id))).map((p) => p.id)))
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const done = () => {
    const playlists = data.playlists.map((p) => {
      if (isPcPlaylist(p)) return p
      const ids = tracks.map((t) => t.id)
      const hasAll = ids.every((id) => p.tracks.includes(id))
      if (ticked.has(p.id) && !hasAll) return { ...p, tracks: [...p.tracks, ...ids.filter((id) => !p.tracks.includes(id))] }
      if (!ticked.has(p.id) && hasAll) return { ...p, tracks: p.tracks.filter((x) => !ids.includes(x)) }
      return p
    })
    if (name.trim()) playlists.push({ id: `p-${Date.now()}`, name: name.trim(), tracks: tracks.map((t) => t.id) })
    replaceData({ ...data, playlists })
    showToast(tracks.length === 1 ? `Saved "${tracks[0].title}"` : `Saved ${tracks.length} songs`)
    onClose()
  }

  return (
    <Dialog
      title="Add to playlist"
      onClose={onClose}
      footer={<button type="button" className="ms-btn primary" onClick={done}>Done</button>}
    >
      {creating ? (
        <input className="ms-input" autoFocus placeholder="Playlist name" value={name} onChange={(e) => setName(e.target.value)} />
      ) : (
        <button type="button" className="ms-list-row" onClick={() => setCreating(true)}>
          <Icon name="add" />
          <span>Create playlist</span>
        </button>
      )}
      {own.map((p) => (
        <label className="ms-list-row" key={p.id}>
          <Icon name="queue_music" />
          <span className="grow">{p.name}<small>{p.tracks.length} {p.tracks.length === 1 ? 'track' : 'tracks'}</small></span>
          <input
            type="checkbox"
            checked={ticked.has(p.id)}
            onChange={(e) => {
              const next = new Set(ticked)
              if (e.target.checked) next.add(p.id)
              else next.delete(p.id)
              setTicked(next)
            }}
          />
        </label>
      ))}
    </Dialog>
  )
}

/**
 * "Delete playlist?" with its songs kept in the library. §98: Favorites is never deleted, only emptied (hearts too);
 * the PC's playlist on a phone is hidden there instead.
 */
export function DeletePlaylistDialog({ playlist, onClose, onDeleted }: { playlist: Playlist; onClose: () => void; onDeleted?: () => void }) {
  const { data, replaceData, showToast } = useShell()
  const kind = isFavoritesList(playlist) ? 'empty' : isPcPlaylist(playlist) ? 'hide' : 'delete'
  const act = () => {
    if (kind === 'empty') {
      clearFavorites()
      replaceData({ ...data, playlists: data.playlists.map((p) => (p.id === playlist.id ? { ...p, tracks: [] } : p)) })
      showToast('Emptied Favorites')
    } else if (kind === 'hide') {
      setPlaylistHidden(playlist.id, true)
      showToast(`Hid "${playlist.name}". It's under Hidden from the PC`)
    } else {
      replaceData(deletePlaylist(data, playlist.id))
      logLine('INFO', 'Library', `Deleted playlist "${playlist.name}" (${playlist.tracks.length} songs)`)
      showToast(`Deleted "${playlist.name}"`)
    }
    onClose()
    if (kind !== 'empty') onDeleted?.()
  }
  return (
    <Dialog
      title={kind === 'empty' ? 'Empty Favorites?' : kind === 'hide' ? 'Hide this playlist?' : 'Delete playlist?'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ms-btn text" onClick={onClose}>Cancel</button>
          <button type="button" className="ms-btn danger" onClick={act}>{kind === 'empty' ? 'Empty' : kind === 'hide' ? 'Hide' : 'Delete'}</button>
        </>
      }
    >
      <p>
        {kind === 'empty'
          ? <>Favorites stays, with no songs in it, and every heart on this device is cleared. Its songs remain in your Library.</>
          : kind === 'hide'
            ? <>"<b>{playlist.name}</b>" belongs to the PC, so it can only be deleted there. Hide it on this phone? It stays under Hidden from the PC at the bottom of Playlists.</>
            : <>Delete playlist "<b>{playlist.name}</b>"? Its songs remain in your Library.</>}
      </p>
    </Dialog>
  )
}

/** The + beside the heart: add to a playlist. Yellow while the song sits in one of your own playlists. */
export function PlaylistAddButton({ track, size }: { track: Track; size?: 'small' }) {
  const { data } = useShell()
  const [adding, setAdding] = useState(false)
  const saved = isPlaylistSaved(data.playlists, track.id)
  const names = playlistNamesForTrack(data.playlists, track.id)
  return (
    <>
      <span className={`ms-pl-add${saved ? ' saved' : ''}`}>
        <IconButton
          icon="add"
          label={saved ? `In ${names.join(', ')}. Add to another playlist` : 'Add to playlist'}
          small={size === 'small'}
          onClick={(e) => { e.stopPropagation(); setAdding(true) }}
        />
      </span>
      {adding && <AddToPlaylist tracks={[track]} onClose={() => setAdding(false)} />}
    </>
  )
}

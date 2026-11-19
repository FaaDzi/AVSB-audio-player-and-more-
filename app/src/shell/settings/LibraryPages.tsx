// Settings → Local Library & Metadata naming: real track count, folder list, hidden folders (§71.F),
// background YouTube-rip naming & "Check these" review list (§72.A5/A6), and Review duplicates (§63).
import { useMemo, useState } from 'react'
import { Cover, Icon, IconButton } from '../ui'
import { useShell } from '../context'
import { importSongArt, stopBulk, syncLyrics, useBulkStatus, type BulkKind } from '../bulkMeta'
import { host } from '../host'
import {
  clearHiddenFolders, duration, folderPath, qualityLabel, unhideFolder, useHiddenFolders, useLibrary, type Track,
} from '../library'
import {
  acceptPossibleMatch, getMatchedTracks, isNamingEnabled, rejectPossibleMatch,
  resetNamingAndRescan, setNamingEnabled, undoTrackDetails, upsertPossibleMatch, useNamingStatus,
} from '../metadata'
import {
  addFolder, android, duplicateGroups, keepSubfolder, lastScanText, refresh, setFolders, subfoldersOf,
  useLibraryStatus, type LibraryFolder,
} from '../localLibrary'

export function LibraryCount() {
  const tracks = useLibrary()
  const { folders, scanning } = useLibraryStatus()
  const last = Math.max(0, ...folders.map((f) => f.lastScan || 0))
  return (
    <div className="ms-lib-count">
      <i className="blob" aria-hidden="true" />
      <span className="ghost" aria-hidden="true"><Icon name="library_music" size={190} /></span>
      <span className="tile"><Icon name="music_note" fill size={30} /></span>
      <b>{tracks.length}</b>
      <span className="what">{tracks.length === 1 ? 'track' : 'tracks'}</span>
      <small>
        <Icon name={scanning ? 'sync' : 'history'} size={16} />{' '}
        {scanning ? `Scanning: ${scanning.read} of ${scanning.found} read` : `Last scanned: ${lastScanText(last)}`}
      </small>
    </div>
  )
}

/** Each chosen folder with its own subfolders switch, expandable subfolder list, Hidden folders (§71.F), and Add library folder. */
export function LibraryFolders() {
  const { showToast } = useShell()
  const { folders, hidden } = useLibraryStatus()
  const [open, setOpen] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const bridge = host()
  const listed = folders.map((f) => ({ path: f.path, subfolders: f.subfolders, exclude: f.exclude }))

  const add = (folder: string | null) => {
    if (!folder) return
    void addFolder(folder, true).then(
      (added) => showToast(added ? `Added ${folder}. Scanning…` : 'That folder is already in your library'),
      () => showToast("That folder couldn't be added"),
    )
  }
  const remove = (path: string) => {
    if (!android && folders.length <= 1) {
      showToast('Add another library folder before removing the last one')
      return
    }
    void setFolders(listed.filter((f) => f.path !== path)).then(() =>
      showToast(android ? 'Folder hidden. Its songs are no longer listed; nothing was deleted' : 'Folder removed. Its songs are no longer listed'),
    )
  }
  const toggle = (path: string, subfolders: boolean) => {
    void setFolders(listed.map((f) => (f.path === path ? { ...f, subfolders } : f))).then(() =>
      showToast(subfolders ? 'Subfolders included. Scan Library to read them' : 'Subfolders left out'),
    )
  }

  const clientHidden = useHiddenFolders()
  const combinedHidden = useMemo(() => {
    const list: { path: string; count?: number }[] = [...hidden]
    for (const p of clientHidden) {
      if (!list.some((h) => h.path.toLowerCase() === p.toLowerCase())) {
        list.push({ path: p })
      }
    }
    return list
  }, [hidden, clientHidden])

  const unhide = (path: string) => {
    unhideFolder(path)
    if (android) {
      void android.hideFolder({ path, hidden: false }).then(() => refresh())
    } else {
      void setFolders([...listed, { path, subfolders: true }])
    }
    showToast(`${folderPath(path)} is back. Its songs are listed again`)
  }

  const unhideAll = () => {
    clearHiddenFolders()
    if (android) {
      for (const h of combinedHidden) {
        void android.hideFolder({ path: h.path, hidden: false })
      }
      void refresh()
    } else {
      void setFolders(listed.map((f) => ({ ...f, exclude: [] })))
    }
    showToast('All hidden folders restored')
  }

  return (
    <>
      <div className="ms-set-group">
        {folders.map((f) => (
          <div key={f.path} className={`ms-set-row ms-lib-folder${f.online ? '' : ' dim'}`}>
            <Icon name={f.online ? 'folder' : 'folder_off'} />
            <span className="grow ms-set-text">
              <span className="ms-set-label">{folderPath(f.path)}</span>
              <small>{f.online ? 'Online' : "Offline: not found, songs kept until it's back"} · {f.count} {f.count === 1 ? 'track' : 'tracks'} · Last scanned: {lastScanText(f.lastScan)}</small>
            </span>
            {!android && (
              <label className="ms-lib-sub" title="Include subfolders">
                <small>Subfolders</small>
                <input type="checkbox" role="switch" className="ms-switch" checked={f.subfolders} aria-label={`Include subfolders of ${f.path}`} onChange={(e) => toggle(f.path, e.target.checked)} />
              </label>
            )}
            <IconButton icon={open === f.path ? 'expand_less' : 'expand_more'} label={`Choose which subfolders of ${f.path} to keep`} small onClick={() => setOpen(open === f.path ? null : f.path)} />
            {(android || folders.length > 1) && (
              <IconButton icon={android ? 'visibility_off' : 'close'} label={`${android ? 'Hide' : 'Remove'} ${f.path}`} small onClick={() => remove(f.path)} />
            )}
            {open === f.path && <SubfolderList folder={f} />}
          </div>
        ))}

        {android ? null : typing ? (
          <form className="ms-set-row ms-lib-type" onSubmit={(e) => { e.preventDefault(); add(typed.trim()); setTyping(false); setTyped('') }}>
            <Icon name="create_new_folder" />
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="D:\Music" aria-label="Folder path" />
            <button type="submit" className="ms-btn text" disabled={!typed.trim()}>Add</button>
          </form>
        ) : (
          <button type="button" className="ms-set-row clickable" onClick={() => { if (bridge) void bridge.chooseFolder().then(add); else setTyping(true) }}>
            <Icon name="create_new_folder" />
            <span className="grow ms-set-text"><span className="ms-set-label">Add library folder</span><small>Another folder on this PC or an external drive</small></span>
            <Icon name="chevron_right" size={20} />
          </button>
        )}
      </div>

      {combinedHidden.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 4px 8px' }}>
            <h3 className="ms-lib-hidden-title" style={{ margin: 0 }}>Hidden folders</h3>
            <button type="button" className="ms-btn text" onClick={unhideAll}>Restore all</button>
          </div>
          <div className="ms-set-group">
            {combinedHidden.map((f) => (
              <div key={f.path} className="ms-set-row ms-lib-folder dim">
                <Icon name="folder_off" />
                <span className="grow ms-set-text">
                  <span className="ms-set-label">{folderPath(f.path)}</span>
                  <small>{f.count !== undefined ? `${f.count} ${f.count === 1 ? 'file' : 'files'} left out · ` : ''}listening stats kept</small>
                </span>
                <button type="button" className="ms-btn text" onClick={() => unhide(f.path)}>Add back</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** Inside one library folder: every subfolder with a switch, "keep it or not" (owner 2026-11-07). Nothing is deleted. */
function SubfolderList({ folder }: { folder: LibraryFolder }) {
  const { data, showToast } = useShell()
  const { hidden } = useLibraryStatus()
  const subs = subfoldersOf(folder, data.tracks, hidden)
  if (!subs.length) return <p className="ms-lib-subs-none">No subfolders with songs in them</p>
  return (
    <div className="ms-lib-subs">
      {subs.map((sub) => (
        <label key={sub.name} className={`ms-lib-subrow${sub.kept ? '' : ' off'}`}>
          <Icon name={sub.kept ? 'folder' : 'folder_off'} size={20} />
          <span className="grow ms-set-text"><span className="ms-set-label">{sub.name}</span><small>{sub.kept ? `${sub.count} ${sub.count === 1 ? 'song' : 'songs'}` : 'Left out'}</small></span>
          <input
            type="checkbox"
            role="switch"
            className="ms-switch"
            checked={sub.kept}
            aria-label={`Keep ${sub.name}`}
            onChange={(e) => {
              const keep = e.target.checked
              void keepSubfolder(folder, sub, keep).then(
                () => showToast(keep ? `${sub.name} is back in your library` : `${sub.name} left out. Its songs stay on the ${android ? 'phone' : 'disk'}`),
                () => showToast("That folder couldn't be changed"),
              )
            }}
          />
        </label>
      ))}
    </div>
  )
}

/**
 * §72.A5 & A6 — Background Library Naming Runner & "Check these" review queue.
 * Off by default until switched on; looks up only tracks with missing artist or YouTube-style filenames at 1 req / 1.1s.
 */
const BULK: Record<BulkKind, { label: string; icon: string; idle: string; start: (t: Track[]) => Promise<void> }> = {
  art: { label: 'Import song art', icon: 'imagesmode', idle: 'Adds covers to songs without one and replaces covers under 300 px', start: importSongArt },
  lyrics: { label: 'Sync lyrics', icon: 'lyrics', idle: 'Fetches lyrics for songs without any, timed ones first', start: syncLyrics },
}

/** §87: the two library-wide jobs, each a row with its own progress and Stop. */
export function BulkMetaRows() {
  return (
    <div className="ms-set-group">
      <BulkRow kind="art" />
      <BulkRow kind="lyrics" />
    </div>
  )
}

function BulkRow({ kind }: { kind: BulkKind }) {
  const tracks = useLibrary()
  const st = useBulkStatus(kind)
  const job = BULK[kind]
  const percent = st.total ? Math.round((st.done / st.total) * 100) : 0
  const sub = st.running
    ? st.waiting || `${st.done} of ${st.total} · ${st.found} found${st.current ? ` · ${st.current}` : ''}`
    : st.total
      ? `${st.found} found in ${st.done} songs`
      : job.idle
  return (
    <>
      <div className="ms-set-row">
        <Icon name={job.icon} />
        <span className="grow ms-set-text">
          <span className="ms-set-label">{job.label}</span>
          <small>{sub}</small>
        </span>
        {st.running
          ? <button type="button" className="ms-btn tonal small" onClick={() => stopBulk(kind)}><Icon name="stop" size={18} /> Stop</button>
          : <button type="button" className="ms-btn tonal small" onClick={() => void job.start(tracks)}><Icon name="play_arrow" size={18} /> Start</button>}
      </div>
      {st.running && (
        <div className="ms-scan-line" role="status" style={{ margin: '0 16px 12px' }}>
          <Icon name="sync" size={18} />
          <span>{st.done} of {st.total} ({percent}%)</span>
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
    </>
  )
}

export function MetadataNamingSection() {
  const { showToast } = useShell()
  const status = useNamingStatus()
  const tracks = useLibrary()
  const matched = useMemo(() => getMatchedTracks(tracks), [tracks, status])
  const [reviewMode, setReviewMode] = useState<'candidates' | 'matched' | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'low'>('all')

  const percent = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0
  const isFinished = !status.running && status.total > 0 && status.done >= status.total

  const filteredCandidates = useMemo(() => {
    let list = status.possible
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((item) =>
        item.suggestedTitle.toLowerCase().includes(q) ||
        item.suggestedArtist.toLowerCase().includes(q) ||
        (item.suggestedAlbum && item.suggestedAlbum.toLowerCase().includes(q)) ||
        item.originalTitle.toLowerCase().includes(q)
      )
    }
    if (confidenceFilter === 'high') list = list.filter((i) => (i.confidence ?? 0.8) >= 0.85)
    else if (confidenceFilter === 'low') list = list.filter((i) => (i.confidence ?? 0.8) < 0.85)
    return list
  }, [status.possible, searchQuery, confidenceFilter])

  const filteredMatched = useMemo(() => {
    let list = matched
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(({ track, details }) => {
        const title = (details.title || track.title).toLowerCase()
        const artist = (details.artist || track.artist).toLowerCase()
        const origTitle = (details.originalTitle || track.title).toLowerCase()
        return title.includes(q) || artist.includes(q) || origTitle.includes(q)
      })
    }
    return list
  }, [matched, searchQuery])

  if (reviewMode === 'candidates') {
    return (
      <div className="ms-review-subpage">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button type="button" className="ms-btn text" onClick={() => { setReviewMode(null); setSearchQuery('') }}>
            <Icon name="arrow_back" size={18} /> Back to Metadata
          </button>
          <button
            type="button"
            className="ms-btn primary"
            disabled={filteredCandidates.length === 0}
            onClick={async () => {
              for (const item of filteredCandidates) {
                await acceptPossibleMatch(item.id)
              }
              showToast(`Accepted ${filteredCandidates.length} matches`)
            }}
          >
            <Icon name="done_all" size={18} /> Accept all ({filteredCandidates.length})
          </button>
        </div>

        <h3>Check proposed matches ({status.possible.length})</h3>
        <div className="ms-search small" style={{ margin: '8px 0 12px' }}>
          <Icon name="search" size={20} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, artist, album, or original filename…"
          />
        </div>

        <div className="ms-chips" style={{ marginBottom: 16 }}>
          <button type="button" className={`ms-chip${confidenceFilter === 'all' ? ' on' : ''}`} onClick={() => setConfidenceFilter('all')}>
            All ({status.possible.length})
          </button>
          <button type="button" className={`ms-chip${confidenceFilter === 'high' ? ' on' : ''}`} onClick={() => setConfidenceFilter('high')}>
            High confidence (≥85%)
          </button>
          <button type="button" className={`ms-chip${confidenceFilter === 'low' ? ' on' : ''}`} onClick={() => setConfidenceFilter('low')}>
            Needs review (&lt;85%)
          </button>
        </div>

        <div className="ms-review-list">
          {filteredCandidates.map((item) => (
            <div key={item.id} className="ms-review-card">
              <div className="ms-review-row proposed">
                <span className="ms-review-badge proposed">
                  <Icon name="auto_fix_high" size={14} /> Proposed Match
                </span>
                <div className="ms-review-meta">
                  <b className="ms-review-title">{item.suggestedTitle}</b>
                  <span className="ms-review-artist">
                    {item.suggestedArtist}
                    {item.suggestedAlbum ? ` · ${item.suggestedAlbum}` : ''}
                  </span>
                </div>
              </div>

              <div className="ms-review-divider" />

              <div className="ms-review-row original">
                <span className="ms-review-badge original">
                  <Icon name="description" size={14} /> Original File Tags
                </span>
                <div className="ms-review-meta">
                  <b className="ms-review-title">{item.originalTitle}</b>
                  <span className="ms-review-artist">{item.originalArtist || 'Untagged / Unknown artist'}</span>
                </div>
              </div>

              <div className="ms-review-actions">
                <button
                  type="button"
                  className="ms-btn primary"
                  onClick={() => {
                    void acceptPossibleMatch(item.id).then(() => {
                      showToast({
                        message: `Kept "${item.suggestedTitle}"`,
                        action: {
                          label: 'Undo',
                          onClick: async () => {
                            await undoTrackDetails(item.id)
                            upsertPossibleMatch(item)
                            showToast(`Restored original file tags for "${item.originalTitle}"`)
                          },
                        },
                      })
                    })
                  }}
                >
                  <Icon name="check" size={18} /> Keep Proposed Match
                </button>
                <button
                  type="button"
                  className="ms-btn tonal"
                  onClick={() => {
                    rejectPossibleMatch(item.id)
                    showToast({
                      message: `Kept original file tags for "${item.originalTitle}"`,
                      action: {
                        label: 'Undo',
                        onClick: () => {
                          undoTrackDetails(item.id)
                          upsertPossibleMatch(item)
                          showToast(`Restored "${item.originalTitle}" to Check these`)
                        },
                      },
                    })
                  }}
                >
                  <Icon name="close" size={18} /> Keep Original File Tags
                </button>
              </div>
            </div>
          ))}
          {filteredCandidates.length === 0 && (
            <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)' }}>No songs match your search</p>
          )}
        </div>
      </div>
    )
  }

  if (reviewMode === 'matched') {
    return (
      <div className="ms-review-subpage">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button type="button" className="ms-btn text" onClick={() => { setReviewMode(null); setSearchQuery('') }}>
            <Icon name="arrow_back" size={18} /> Back to Metadata
          </button>
          <button
            type="button"
            className="ms-btn tonal"
            disabled={filteredMatched.length === 0}
            onClick={async () => {
              for (const { track } of filteredMatched) {
                await undoTrackDetails(track.id)
              }
              showToast(`Restored original file tags for ${filteredMatched.length} songs`)
            }}
          >
            <Icon name="undo" size={18} /> Restore all ({filteredMatched.length})
          </button>
        </div>

        <h3>Matched songs ({matched.length})</h3>
        <div className="ms-search small" style={{ margin: '8px 0 16px' }}>
          <Icon name="search" size={20} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search matched title, artist, or original filename…"
          />
        </div>

        <div className="ms-review-list">
          {filteredMatched.map(({ track, details }) => {
            const origTitle = details.originalTitle || track.originalTitle || track.title
            const origArtist = details.originalArtist || track.originalArtist || track.artist
            const matchedTitle = details.title || track.title
            const matchedArtist = details.artist || track.artist
            const matchedAlbum = (details.values?.album as string) || track.album

            return (
              <div key={track.id} className="ms-review-card">
                <div className="ms-review-row proposed">
                  <span className="ms-review-badge proposed">
                    <Icon name="cloud_done" size={14} /> Active Online Metadata
                  </span>
                  <div className="ms-review-meta">
                    <b className="ms-review-title">{matchedTitle}</b>
                    <span className="ms-review-artist">
                      {matchedArtist}
                      {matchedAlbum ? ` · ${matchedAlbum}` : ''}
                    </span>
                  </div>
                </div>

                <div className="ms-review-divider" />

                <div className="ms-review-row original">
                  <span className="ms-review-badge original">
                    <Icon name="audio_file" size={14} /> Original File Tags
                  </span>
                  <div className="ms-review-meta">
                    <b className="ms-review-title">{origTitle}</b>
                    <span className="ms-review-artist">{origArtist || 'Untagged / Unknown artist'}</span>
                  </div>
                </div>

                <div className="ms-review-actions">
                  <button
                    type="button"
                    className="ms-btn tonal"
                    onClick={async () => {
                      await undoTrackDetails(track.id)
                      showToast({
                        message: `Restored original file tags for "${origTitle}"`,
                      })
                    }}
                  >
                    <Icon name="undo" size={18} /> Restore Original File Tags
                  </button>
                </div>
              </div>
            )
          })}
          {filteredMatched.length === 0 && (
            <p style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)' }}>No songs match your search</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8, marginTop: 4 }}>
        <h3>Name untagged songs & missing metadata</h3>
        <button
          type="button"
          className="ms-btn tonal small"
          style={{ height: 32, fontSize: 13, gap: 6 }}
          onClick={() => {
            resetNamingAndRescan()
            showToast('Re-checking library metadata online…')
          }}
          disabled={status.running}
          title="Clear search cache and look up missing metadata online"
        >
          <Icon name="refresh" size={16} /> Re-check Library
        </button>
      </div>

      <div className="ms-set-group">
        <label className="ms-set-row clickable">
          <Icon name="auto_fix_high" />
          <span className="grow ms-set-text">
            <span className="ms-set-label">Find missing artist, title, album and cover</span>
            <small>
              {status.running
                ? `Checking "${status.currentTitle || 'song'}" (${status.done} of ${status.total}) · ${percent}%…`
                : isFinished
                  ? `✓ Checked all ${status.total} songs · All metadata is up to date`
                  : status.total > 0
                    ? `${status.done} of ${status.total} tracks checked · files on disk are never modified`
                    : 'Looks up missing metadata in the background (1 song / sec). Original files are never modified.'}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="ms-switch"
            checked={isNamingEnabled()}
            aria-label="Find missing artist, title, album and cover"
            onChange={(e) => {
              const on = e.target.checked
              setNamingEnabled(on)
              showToast(on ? 'Naming songs in the background…' : 'Background naming paused')
            }}
          />
        </label>

        {status.running && (
          <div className="ms-scan-line" role="status" style={{ margin: '0 16px 12px' }}>
            <Icon name="sync" size={18} />
            <span>Naming library: {status.done} of {status.total} ({percent}%)</span>
            <i style={{ width: `${percent}%` }} />
          </div>
        )}

        {isFinished && (
          <div className="ms-scan-line done" role="status" style={{ margin: '0 16px 12px', color: 'var(--accent, #00e676)' }}>
            <Icon name="check_circle" size={18} />
            <span>Metadata up to date: all {status.total} tracks checked</span>
          </div>
        )}
      </div>

      {status.possible.length > 3 ? (
        <div className="ms-set-group" style={{ marginTop: 16 }}>
          <div className="ms-set-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="rate_review" size={24} />
              <div>
                <b>Check proposed matches ({status.possible.length} songs)</b>
                <small style={{ display: 'block', color: 'var(--text-dim)', fontSize: 13 }}>Review and confirm suggested tags from MusicBrainz &amp; Deezer</small>
              </div>
            </div>
            <button type="button" className="ms-btn primary" onClick={() => setReviewMode('candidates')}>
              Review matches →
            </button>
          </div>
        </div>
      ) : status.possible.length > 0 ? (
        <>
          <h3 className="ms-lib-hidden-title">Check these ({status.possible.length})</h3>
          <p className="ms-set-note" style={{ margin: '-4px 16px 12px', opacity: 0.8 }}>
            Review suggested metadata from MusicBrainz &amp; Deezer. Files on disk are never modified.
          </p>
          <div className="ms-review-list">
            {status.possible.map((item) => (
              <div key={item.id} className="ms-review-card">
                <div className="ms-review-row proposed">
                  <span className="ms-review-badge proposed">
                    <Icon name="auto_fix_high" size={14} /> Proposed Match
                  </span>
                  <div className="ms-review-meta">
                    <b className="ms-review-title">{item.suggestedTitle}</b>
                    <span className="ms-review-artist">
                      {item.suggestedArtist}
                      {item.suggestedAlbum ? ` · ${item.suggestedAlbum}` : ''}
                    </span>
                  </div>
                </div>

                <div className="ms-review-divider" />

                <div className="ms-review-row original">
                  <span className="ms-review-badge original">
                    <Icon name="description" size={14} /> Original File Tags
                  </span>
                  <div className="ms-review-meta">
                    <b className="ms-review-title">{item.originalTitle}</b>
                    <span className="ms-review-artist">{item.originalArtist || 'Untagged / Unknown artist'}</span>
                  </div>
                </div>

                <div className="ms-review-actions">
                  <button
                    type="button"
                    className="ms-btn primary"
                    onClick={() => {
                      void acceptPossibleMatch(item.id).then(() => {
                        showToast({
                          message: `Kept "${item.suggestedTitle}"`,
                          action: {
                            label: 'Undo',
                            onClick: async () => {
                              await undoTrackDetails(item.id)
                              upsertPossibleMatch(item)
                              showToast(`Restored original file tags for "${item.originalTitle}"`)
                            },
                          },
                        })
                      })
                    }}
                  >
                    <Icon name="check" size={18} /> Keep Proposed Match
                  </button>
                  <button
                    type="button"
                    className="ms-btn tonal"
                    onClick={() => {
                      rejectPossibleMatch(item.id)
                      showToast({
                        message: `Kept original file tags for "${item.originalTitle}"`,
                        action: {
                          label: 'Undo',
                          onClick: () => {
                            undoTrackDetails(item.id)
                            upsertPossibleMatch(item)
                            showToast(`Restored "${item.originalTitle}" to Check these`)
                          },
                        },
                      })
                    }}
                  >
                    <Icon name="close" size={18} /> Keep Original File Tags
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {matched.length > 3 ? (
        <div className="ms-set-group" style={{ marginTop: 16 }}>
          <div className="ms-set-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="cloud_done" size={24} />
              <div>
                <b>Matched songs ({matched.length} songs tagged)</b>
                <small style={{ display: 'block', color: 'var(--text-dim)', fontSize: 13 }}>Search, filter, or restore original file tags at any time</small>
              </div>
            </div>
            <button type="button" className="ms-btn tonal" onClick={() => setReviewMode('matched')}>
              Manage matched tags →
            </button>
          </div>
        </div>
      ) : matched.length > 0 ? (
        <>
          <h3 className="ms-lib-hidden-title" style={{ marginTop: 24 }}>Matched songs ({matched.length})</h3>
          <p className="ms-set-note" style={{ margin: '-4px 16px 12px', opacity: 0.8 }}>
            Songs enriched with online metadata. You can restore original file tags at any time with 1 tap.
          </p>
          <div className="ms-review-list">
            {matched.map(({ track, details }) => {
              const origTitle = details.originalTitle || track.originalTitle || track.title
              const origArtist = details.originalArtist || track.originalArtist || track.artist
              const matchedTitle = details.title || track.title
              const matchedArtist = details.artist || track.artist
              const matchedAlbum = (details.values?.album as string) || track.album

              return (
                <div key={track.id} className="ms-review-card">
                  <div className="ms-review-row proposed">
                    <span className="ms-review-badge proposed">
                      <Icon name="cloud_done" size={14} /> Active Online Metadata
                    </span>
                    <div className="ms-review-meta">
                      <b className="ms-review-title">{matchedTitle}</b>
                      <span className="ms-review-artist">
                        {matchedArtist}
                        {matchedAlbum ? ` · ${matchedAlbum}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="ms-review-divider" />

                  <div className="ms-review-row original">
                    <span className="ms-review-badge original">
                      <Icon name="audio_file" size={14} /> Original File Tags
                    </span>
                    <div className="ms-review-meta">
                      <b className="ms-review-title">{origTitle}</b>
                      <span className="ms-review-artist">{origArtist || 'Untagged / Unknown artist'}</span>
                    </div>
                  </div>

                  <div className="ms-review-actions">
                    <button
                      type="button"
                      className="ms-btn tonal"
                      onClick={async () => {
                        await undoTrackDetails(track.id)
                        showToast({
                          message: `Restored original file tags for "${origTitle}"`,
                        })
                      }}
                    >
                      <Icon name="undo" size={18} /> Restore Original File Tags
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </>
  )
}

export const MetadataPage = MetadataNamingSection
export const LocalLibraryPage = LibraryFolders

/** The same song found more than once: same title and artist, lengths within 2 seconds. */
export function DuplicatesPage() {
  const { play, push } = useShell()
  const tracks = useLibrary()
  const groups = useMemo(() => duplicateGroups(tracks), [tracks])
  if (!groups.length) return <div className="ms-empty small"><Icon name="task_alt" size={40} /><p>No song is in your library more than once.</p></div>
  return (
    <>
      <p className="ms-priority-text">{groups.length} {groups.length === 1 ? 'song is' : 'songs are'} stored more than once. Nothing is deleted from here.</p>
      {groups.map((g) => (
        <section key={g[0].id} className="ms-set-section">
          <h3>{g[0].title} · {g[0].artist || 'Unknown Artist'}</h3>
          <div className="ms-set-group">
            {g.map((t) => (
              <div key={t.id} className="ms-set-row">
                <Cover id={t.cover} alt="" className="ms-dupe-cover" genre={t.genre} speciality={t.category} title={t.title} />
                <span className="grow ms-set-text">
                  <span className="ms-set-label">{folderPath(t.path)}</span>
                  <small>{qualityLabel(t)} · {duration(t.sec)} · {(t.size / 1048576).toFixed(1)} MB</small>
                </span>
                <IconButton icon="play_arrow" label={`Play ${t.path}`} small onClick={() => play(t, g)} />
                <IconButton icon="info" label="Song details" small onClick={() => push({ page: 'song', id: t.id })} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

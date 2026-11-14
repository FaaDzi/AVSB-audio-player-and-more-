import { useMemo } from 'react'
import { Cover, Icon } from '../ui'
import { useShell } from '../context'
import { topArtists, topSongs, totalHeard, totalPlays, useListening, withoutSongs } from '../stats'
import { hiddenTrackIds, useHiddenFolders } from '../library'

function listened(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`
}

/** Listening statistics, all from what's been saved on this computer. */
export function StatsPage() {
  const { data, play } = useShell()
  const all = useListening()
  const hidden = useHiddenFolders()
  const tracks = useMemo(() => data?.tracks ?? [], [data])
  const state = useMemo(() => withoutSongs(all, hiddenTrackIds(tracks, hidden)), [all, tracks, hidden])
  const songs = useMemo(() => topSongs(state, tracks), [state, tracks])
  const artists = useMemo(() => topArtists(state, tracks), [state, tracks])
  const plays = totalPlays(state)

  if (!plays) {
    return <div className="ms-set-card"><Icon name="bar_chart" size={20} /><p>Songs you play show up here. A song counts after 30 seconds, or half of it if it's shorter.</p></div>
  }
  return (
    <>
      <div className="ms-stats-top">
        <div><b>{listened(totalHeard(state))}</b><span>listened</span></div>
        <div><b>{plays}</b><span>plays</span></div>
        <div><b>{Object.values(state.songs).filter((s) => s.plays).length}</b><span>songs</span></div>
      </div>
      <section className="ms-set-section">
        <h3>Top songs</h3>
        <div className="ms-set-group">
          {songs.map(({ track, plays: count }) => (
            <button type="button" className="ms-set-row clickable" key={track.id} onClick={() => play(track)}>
              <Cover id={track.cover} className="ms-stats-cover" />
              <span className="grow ms-set-text ms-ellipsis">{track.title}<small>{track.artist || 'Unknown Artist'}</small></span>
              <span className="ms-value">{count}</span>
            </button>
          ))}
        </div>
      </section>
      {artists.length > 0 && (
        <section className="ms-set-section">
          <h3>Top artists</h3>
          <div className="ms-set-group">
            {artists.map((a) => (
              <div className="ms-set-row" key={a.name}>
                <Icon name="person" />
                <span className="grow ms-set-text ms-ellipsis">{a.name}<small>{listened(a.heard)}</small></span>
                <span className="ms-value">{a.plays}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

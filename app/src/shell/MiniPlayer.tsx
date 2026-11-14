import { Cover, Icon, IconButton } from './ui'
import { useShell } from './context'
import { useLivePosition } from './engine'
import { Slider } from './PlayerBar'
import { useCoverStyle } from './cover'
import { host } from './host'
import { isLiked, toggleLike, useFavorites } from './favorites'

/** Mornye shrinks to a small window. In Electron it resizes to an always-on-top draggable desktop widget. */
export function MiniPlayer() {
  const position = useLivePosition()
  const { current, playing, loading, setPlaying, setPosition, setMini, step, setPanel, setNowPlaying, data, replaceData } = useShell()
  useFavorites()
  const liked = !!current && isLiked(current.id)
  const coverStyle = useCoverStyle(current?.cover)

  const exitMini = () => {
    void host()?.setMiniMode?.(false)
    setMini(false)
  }

  return (
    <div className="ms-mini-page">
      <div className="ms-mini" style={coverStyle}>
        <Cover id={current?.cover ?? ''} className="ms-mini-art" />
        <div className="ms-mini-text">
          <div className="ms-player-title">{current?.title}</div>
          <div className="ms-player-artist">{current?.artist}</div>
        </div>
        <IconButton icon="open_in_full" label="Back to full window" small onClick={exitMini} />
        <div className="ms-mini-buttons">
          <IconButton icon="skip_previous" label="Previous" onClick={() => step(-1)} />
          <button type="button" className={`ms-play${playing ? ' on' : ''}`} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
            {loading ? <span className="ms-spinner" /> : <Icon name={playing ? 'pause' : 'play_arrow'} fill size={26} />}
          </button>
          <IconButton icon="skip_next" label="Next" onClick={() => step(1)} />
          {current && <IconButton icon={liked ? 'favorite' : 'favorite_border'} label={liked ? 'Remove from Favorites' : 'Add to Favorites'} active={liked} onClick={() => toggleLike(current, data, replaceData)} />}
        </div>
        <IconButton icon="lyrics" label="Lyrics" onClick={() => { exitMini(); setPanel('lyrics'); setNowPlaying(true) }} />
        <Slider wavy={playing} value={current?.sec ? position / current.sec : 0} label="Seek" onChange={(v) => setPosition(v * (current?.sec ?? 0))} />
      </div>
    </div>
  )
}

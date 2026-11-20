import { useState } from 'react'
import { Cover, Icon, IconButton } from './ui'
import { SleepButton } from './sleepTimer'
import { useShell } from './context'
import { duration } from './library'
import { WaveTrack } from './WaveTrack'
import { useCoverStyle } from './cover'
import { GearCircleIndicator } from './sound/GearCircleIndicator'
import { GearSwitch } from './sound/GearSwitch'
import { isLiked, toggleLike, useFavorites } from './favorites'
import { useIsBuffering, useLivePosition } from './engine'
import { PlaylistAddButton } from './pages/TrackMenu'

/** Same layout as the reference. No audio until Phase 3. */
export function PlayerBar() {
  const position = useLivePosition()
  const { current, playing, loading, volume, panel, nowPlaying, setPlaying, setPosition, setVolume, setPanel, setNowPlaying, setMini, step, showToast, data, replaceData } = useShell()
  useFavorites()
  const length = current?.sec ?? 0
  const coverStyle = useCoverStyle(current?.cover)
  const isBuffering = useIsBuffering()

  return (
    <footer className="ms-player" style={coverStyle}>
      <div className="ms-player-left">
        {current && (
          <>
            <button type="button" className="ms-player-open" aria-label="Open Now Playing" onClick={() => setNowPlaying(true)}>
              <div className={`ms-player-art-wrap ${playing ? 'playing' : 'paused'}`} style={{ position: 'relative', display: 'inline-flex', overflow: 'hidden' }}>
                <Cover id={current.cover} className="ms-player-art" genre={current.genre} speciality={current.category} title={current.title} />
                {isBuffering && (
                  <div className="ms-buffer-overlay" aria-label="Buffering">
                    <div className="ms-spinner" />
                  </div>
                )}
              </div>
              <span className="ms-player-text">
                <span className="ms-player-title">{current.title}</span>
                <span className="ms-player-artist">{current.artist || 'Unknown Artist'}</span>
              </span>
            </button>
            <IconButton
              icon={isLiked(current.id) ? 'favorite' : 'favorite_border'}
              label={isLiked(current.id) ? 'Remove from Favorites' : 'Add to Favorites'}
              active={isLiked(current.id)}
              onClick={() => toggleLike(current, data, replaceData)}
            />
            <PlaylistAddButton track={current} />
          </>
        )}
        <div className="ms-player-gear-group" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
          <GearSwitch />
          <GearCircleIndicator size={20} />
        </div>
      </div>

      <div className="ms-player-center">
        <div className="ms-player-buttons">
          <IconButton icon="skip_previous" label="Previous" onClick={() => step(-1)} />
          <button type="button" className={`ms-play${playing ? ' on' : ''}`} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onClick={() => current && setPlaying(!playing)}>
            {loading ? <span className="ms-spinner" /> : <Icon name={playing ? 'pause' : 'play_arrow'} fill size={26} />}
          </button>
          <IconButton icon="skip_next" label="Next" onClick={() => step(1)} />
        </div>
        <div className="ms-seek">
          <span className="ms-time">{duration(position)}</span>
          {/* flat while Now Playing covers the bar: its wave would keep drawing unseen */}
          <Slider wavy={playing && !nowPlaying} value={length ? position / length : 0} label="Seek" onChange={(v) => setPosition(v * length)} />
          <span className="ms-time">{duration(length)}</span>
        </div>
      </div>

      <div className="ms-player-right">
        <IconButton icon="lyrics" label="Lyrics" active={panel === 'lyrics'} onClick={() => setPanel(panel === 'lyrics' ? null : 'lyrics')} />
        <IconButton icon="queue_music" label="Up next" active={panel === 'queue'} onClick={() => setPanel(panel === 'queue' ? null : 'queue')} />
        <SleepButton current={current} />
        <IconButton icon="picture_in_picture_alt" label="Mini player" onClick={() => (current ? setMini(true) : showToast('Play a song first'))} />
        <VolumeControl value={volume} onChange={setVolume} />
      </div>
    </footer>
  )
}

export function VolumeControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="ms-volume" onWheel={(e) => onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * 0.05)))}>
      <Icon name="volume_down" size={22} />
      <Slider value={value} label="Volume" onChange={onChange} />
      <Icon name="volume_up" size={22} />
    </div>
  )
}

/** Material 3 slider: active track, handle, a gap, then the inactive track ending in a stop dot. Wavy while playing. */
export function Slider({ value, onChange, label, wavy, thick, min = 0, max = 1, step = 0.001 }: {
  value: number
  onChange: (v: number) => void
  label: string
  wavy?: boolean
  thick?: boolean
  min?: number
  max?: number
  step?: number
}) {
  const share = (value - min) / (max - min)
  const clamped = Math.min(1, Math.max(0, share))
  const pct = `${clamped * 100}%`
  // the seek track passes wavy true or false; it goes flat while dragged and at the very end
  const [dragging, setDragging] = useState(false)
  const isSeek = wavy !== undefined
  const centred = Boolean(thick) && min < 0 && max > 0
  const zero = ((0 - min) / (max - min)) * 100
  const centreStyle = centred ? { '--from': `${Math.min(zero, clamped * 100)}%`, '--span': `${Math.abs(clamped * 100 - zero)}%` } : {}
  return (
    <div className={`ms-slider${thick ? ' thick' : ''}${centred ? ' centred' : ''}`} style={{ '--pct': pct, ...centreStyle } as unknown as React.CSSProperties}>
      {isSeek ? <WaveTrack share={clamped} moving={Boolean(wavy) && !dragging && clamped < 1} /> : <div className="ms-slider-active" />}
      <div className="ms-slider-handle" />
      <div className="ms-slider-rest" />
      <input onPointerDown={() => setDragging(true)} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

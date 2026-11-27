// §119: the 360 screen's live view, seen from above: the listener in the middle, nose pointing where the head tracker
// says, and the virtual sound sources around them sending rays in. Turning your head turns the head; the sources stay
// put, which is what shows the tracking works. Line art in the theme's accent, like the noise scene.
import { useHeadTracking } from '../../headtrack/driver'

// the stage's front pair at ±30° (spatial/stage.ts) and the rest of the 360 field
const SOURCES: [number, boolean][] = [[-30, true], [30, true], [-110, false], [110, false], [180, false]]

export function Spatial360View({ on }: { on: boolean }) {
  const track = useHeadTracking()
  const live = on && track.status === 'on'
  const yaw = live ? track.yaw ?? 0 : 0
  const c = 100
  const r = 78
  const at = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return [c + rad * Math.cos(a), c + rad * Math.sin(a)]
  }
  return (
    <div className={`ms-360-view${on ? '' : ' dim'}`}>
      <svg viewBox="0 0 200 200" role="img" aria-label={live ? `Head turned ${Math.round(yaw)} degrees` : '360 view'}>
        <circle className="thin" cx={c} cy={c} r={r} strokeDasharray="3 5" />
        {SOURCES.map(([deg, front]) => {
          const [x, y] = at(deg, r)
          const [x2, y2] = at(deg, 34)
          return (
            <g key={deg} className={front ? undefined : 'faint'}>
              <path className="thin ray" d={`M${x} ${y} L${x2} ${y2}`} strokeDasharray="2 6" />
              <circle cx={x} cy={y} r={front ? 7 : 5} />
            </g>
          )
        })}
        {/* the head, turned by the tracker (a left turn is a positive yaw) */}
        <g transform={`rotate(${-yaw} ${c} ${c})`}>
          <circle cx={c} cy={c} r={20} />
          <path d={`M${c - 6} ${c - 19} L${c} ${c - 30} L${c + 6} ${c - 19}`} />
          <rect x={c - 26} y={c - 6} width="7" height="12" rx="3" />
          <rect x={c + 19} y={c - 6} width="7" height="12" rx="3" />
        </g>
      </svg>
      <span className={`ms-360-dot${live ? ' live' : ''}`}>
        {!on ? '360 is off' : track.status === 'on' ? `Tracking · ${Math.round(yaw)}°` : track.status === 'starting' ? 'Starting tracking…' : 'Head tracking off'}
      </span>
    </div>
  )
}

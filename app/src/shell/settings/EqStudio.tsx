// The EQ tab's graph and its two guided steps (plan §84 B, C, E): AutoEQ to a target, then fine-tune by ear.
import '../eqStudio.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSpatial, onSpatialChange } from '../../spatial/settings'
import { Dialog, Icon, IconButton } from '../ui'
import { Slider } from '../PlayerBar'
import type { Database } from '../database/catalog'
import { DevicePickerModal } from '../sound/AudioProfileSheet'
import { familyOf, targetsFor, type Aim } from '../sound/soundCurve'
import { autoEq, CANAL_PEAK_HZ, curveAt, midLevel, NO_PREFS, type AutoEqResult, type EqPrefs, type EqScene, type FitDepth } from '../eqStudio'
import { getSetting, setSetting } from './store'

// ---- what the AutoEQ card remembers, per device

export interface EqLab {
  aim: Aim
  prefs: EqPrefs
  gentle: boolean
  depth: FitDepth
  filters: number
  /** Let the HRTF picked in Spatial shape the target. */
  hrtf: boolean
}
export const LAB_DEFAULT: EqLab = { aim: { kind: 'off' }, prefs: NO_PREFS, gentle: true, depth: 'normal', filters: 8, hrtf: true }

function labStore(): Record<string, Partial<EqLab>> {
  try {
    return JSON.parse(String(getSetting('eqlab') ?? '{}')) as Record<string, Partial<EqLab>>
  } catch {
    return {}
  }
}
export const getLab = (deviceId: string | null): EqLab => ({ ...LAB_DEFAULT, ...labStore()[deviceId ?? ''] })
export const setLab = (deviceId: string | null, patch: Partial<EqLab>) =>
  setSetting('eqlab', JSON.stringify({ ...labStore(), [deviceId ?? '']: { ...getLab(deviceId), ...patch } }))

// ---- the graph

const DB_RANGE = 18
const W = 1000
const H = 300
const xOf = (hz: number) => (Math.log10(hz / 20) / 3) * W
const yOf = (db: number) => H / 2 - (Math.max(-DB_RANGE, Math.min(DB_RANGE, db)) * H) / 2 / DB_RANGE
const hzOf = (fx: number) => 20 * 1000 ** Math.max(0, Math.min(1, fx))
const dbOf = (fy: number) => (0.5 - Math.max(0, Math.min(1, fy))) * 2 * DB_RANGE
export const hzLabel = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`)
const signed = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`

/** One colour per filter, the same on the graph and in the table. */
export const FILTER_COLORS = ['#7cc4ff', '#ffb86b', '#9be28a', '#ff8fa3', '#c9a5ff', '#ffe066', '#5ee0d0', '#ff9d5c']
export const filterColor = (i: number) => FILTER_COLORS[i % FILTER_COLORS.length]

export interface GraphHandle {
  hz: number
  db: number
}

export function EqGraph(props: {
  on: boolean
  compact: boolean
  grid: ArrayLike<number>
  /** The EQ alone, and anything else in the chain (the Sound aim), dB on `grid`. */
  eqDb: ArrayLike<number>
  extraDb: ArrayLike<number> | null
  device: ArrayLike<number> | null
  target: ArrayLike<number> | null
  ears: { left: ArrayLike<number>; right: ArrayLike<number> } | null
  handles: GraphHandle[]
  /** Handles slide along the frequency axis too (parametric filters), not just up and down (bands). */
  freeHz: boolean
  onHandle?: (i: number, to: Partial<GraphHandle>) => void
  onHandleQ?: (i: number, factor: number) => void
  onAdd?: (at: GraphHandle) => void
  onRemove?: (i: number) => void
  /** The test tone's frequency while it plays; the graph then moves it instead of showing a readout. */
  toneHz: number | null
  onTone?: (hz: number) => void
}) {
  const { grid, eqDb, device, target, handles } = props
  const plot = useRef<HTMLDivElement>(null)
  const drag = useRef<number | 'tone' | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [sel, setSel] = useState<number | null>(null)

  const lines = useMemo(() => {
    const pts = (c: ArrayLike<number>, off = 0) => Array.from(grid, (f, i) => `${xOf(f).toFixed(1)},${yOf(c[i] - off).toFixed(1)}`).join(' ')
    const total = Float64Array.from(eqDb, (v, i) => v + (props.extraDb?.[i] ?? 0))
    const eq = pts(eqDb)
    const area = `${xOf(grid[0])},${H / 2} ${eq} ${xOf(grid[grid.length - 1])},${H / 2}`
    if (!device) return { eq, area, device: null, target: null, after: null, afterDb: null as Float64Array | null }
    const level = midLevel(grid, device)
    const afterDb = Float64Array.from(device, (v, i) => v + total[i] - level)
    // the target sits on the result's level, so a good match reads as the two lines lying on each other
    const targetLine = target ? pts(target, midLevel(grid, target) - midLevel(grid, afterDb)) : null
    return { eq, area, device: pts(device, level), target: targetLine, after: pts(afterDb), afterDb }
  }, [grid, eqDb, props.extraDb, device, target])

  const earLines = useMemo(() => {
    if (!props.ears) return null
    const pts = (c: ArrayLike<number>) => Array.from(grid, (f, i) => `${xOf(f).toFixed(1)},${yOf(eqDb[i] + c[i]).toFixed(1)}`).join(' ')
    return { left: pts(props.ears.left), right: pts(props.ears.right) }
  }, [props.ears, grid, eqDb])

  const at = (e: { clientX: number; clientY: number }) => {
    const r = plot.current!.getBoundingClientRect()
    return { hz: hzOf((e.clientX - r.left) / r.width), db: dbOf((e.clientY - r.top) / r.height) }
  }
  const move = (e: React.PointerEvent) => {
    const p = at(e)
    const d = drag.current
    if (d === 'tone') props.onTone?.(p.hz)
    else if (d !== null) props.onHandle?.(d, props.freeHz ? { hz: Math.round(p.hz), db: Math.round(p.db * 2) / 2 } : { db: Math.round(p.db * 2) / 2 })
    else setHover(p.hz)
  }
  const end = () => { drag.current = null }
  const readHz = props.toneHz ?? hover
  const readDb = readHz === null ? null : lines.afterDb ? curveAt(grid, lines.afterDb, readHz) : curveAt(grid, eqDb, readHz)

  return (
    <div className={`ms-eqg${props.compact ? ' compact' : ''}${props.on ? ' on' : ''}${props.toneHz !== null ? ' tone' : ''}`}>
      <div className="ms-eqg-db" aria-hidden="true">
        {[12, 6, 0, -6, -12].map((db) => <span key={db} style={{ top: `${(yOf(db) / H) * 100}%` }}>{db > 0 ? `+${db}` : db}</span>)}
      </div>
      <div
        ref={plot}
        className="ms-eqg-plot"
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={(e) => {
          if (props.toneHz === null || (e.target as Element).closest('button')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = 'tone'
          props.onTone?.(at(e).hz)
        }}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('button')) props.onAdd?.({ hz: Math.round(at(e).hz), db: Math.round(at(e).db * 2) / 2 })
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {[12, 6, -6, -12].map((db) => <line key={db} className="grid" x1="0" x2={W} y1={yOf(db)} y2={yOf(db)} />)}
          {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((hz) => <line key={hz} className="grid" x1={xOf(hz)} x2={xOf(hz)} y1="0" y2={H} />)}
          <line className="zero" x1="0" x2={W} y1={H / 2} y2={H / 2} />
          <polygon className="eq-area" points={lines.area} />
          {lines.device && <polyline className="device" points={lines.device} />}
          {lines.target && <polyline className="target" points={lines.target} />}
          {earLines && <polyline className="ear-l" points={earLines.left} />}
          {earLines && <polyline className="ear-r" points={earLines.right} />}
          <polyline className={lines.after ? 'eq thin' : 'eq'} points={lines.eq} />
          {lines.after && <polyline className="after" points={lines.after} />}
          {readHz !== null && <line className={props.toneHz !== null ? 'tone' : 'cursor'} x1={xOf(readHz)} x2={xOf(readHz)} y1="0" y2={H} />}
        </svg>
        {handles.map((h, i) => (
          <button
            type="button"
            key={i}
            className={`ms-eqg-handle${sel === i ? ' on' : ''}`}
            style={{ left: `${xOf(h.hz) / 10}%`, top: `${(yOf(h.db) / H) * 100}%`, '--c': props.freeHz ? filterColor(i) : undefined } as React.CSSProperties}
            aria-label={`${hzLabel(h.hz)}, ${signed(h.db)}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = i
              setSel(i)
            }}
            onPointerMove={(e) => { if (drag.current === i) { e.stopPropagation(); move(e) } }}
            onPointerUp={end}
            onWheel={(e) => props.onHandleQ?.(i, e.deltaY < 0 ? 1.12 : 1 / 1.12)}
            onDoubleClick={(e) => { e.stopPropagation(); props.onRemove?.(i) }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.5
              if (e.key === 'ArrowUp') props.onHandle?.(i, { db: h.db + step })
              else if (e.key === 'ArrowDown') props.onHandle?.(i, { db: h.db - step })
              else if (e.key === 'ArrowRight' && props.freeHz) props.onHandle?.(i, { hz: Math.round(h.hz * 1.03) })
              else if (e.key === 'ArrowLeft' && props.freeHz) props.onHandle?.(i, { hz: Math.round(h.hz / 1.03) })
              else if ((e.key === 'Delete' || e.key === 'Backspace') && props.onRemove) props.onRemove(i)
              else return
              e.preventDefault()
            }}
          >
            {props.freeHz ? i + 1 : ''}
          </button>
        ))}
        {readHz !== null && readDb !== null && (
          <span className="ms-eqg-read" style={{ left: `${xOf(readHz) / 10}%` }}>
            <b>{hzLabel(readHz)}</b> {signed(readDb)}
          </span>
        )}
        {[100, 1000, 10000].map((hz) => <span key={hz} className="ms-eqg-hz" style={{ left: `${xOf(hz) / 10}%` }}>{hz >= 1000 ? `${hz / 1000}k` : hz}</span>)}
      </div>
      {!props.compact && (
        <div className="ms-eqg-legend">
          {lines.device && <span className="device">Your device</span>}
          {lines.target && <span className="target">Target</span>}
          {lines.after && <span className="after">With EQ</span>}
          <span className="eq">EQ</span>
          {earLines && <><span className="ear-l">Left</span><span className="ear-r">Right</span></>}
        </div>
      )}
    </div>
  )
}

// ---- step 1: AutoEQ

const PREFS: { key: keyof EqPrefs; label: string; icon: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'bass', label: 'Bass', icon: 'speaker', min: -6, max: 10, step: 0.5, unit: ' dB' },
  { key: 'tilt', label: 'Tilt', icon: 'trending_down', min: -1.5, max: 1.5, step: 0.1, unit: ' dB/oct' },
  { key: 'earGain', label: 'Ear gain', icon: 'hearing', min: -6, max: 6, step: 0.5, unit: ' dB' },
  { key: 'treble', label: 'Treble', icon: 'music_note', min: -8, max: 8, step: 0.5, unit: ' dB' },
]
const DEPTHS: [FitDepth, string][] = [['shallow', 'Shallow'], ['normal', 'Normal'], ['deep', 'Deep']]

export function AutoEqCard(props: {
  db: Database
  deviceId: string | null
  deviceName: string
  lab: EqLab
  scene: EqScene | null
  /** The HRTF picked in Spatial when it can shape the target (its name), else null. */
  hrtfName: string | null
  onLab: (patch: Partial<EqLab>) => void
  onApply: (r: AutoEqResult, targetName: string) => void
  onPickGear: () => void
}) {
  const { db, deviceId, lab, scene } = props
  const [picking, setPicking] = useState(false)
  const targets = useMemo(() => targetsFor(db.catalog, deviceId), [db, deviceId])
  const family = familyOf(db.catalog, deviceId)
  const aimDevice = lab.aim.kind === 'device' ? db.catalog.byId.get(lab.aim.id) : undefined
  const targetName = lab.aim.kind === 'target' ? lab.aim.name : aimDevice?.name ?? ''
  const result = useMemo(() => (scene ? autoEq(scene, lab.filters) : null), [scene, lab.filters])
  const touched = PREFS.some((p) => lab.prefs[p.key] !== 0)

  if (!scene?.device) {
    return (
      <section className="ms-eqlab">
        <header><em>1</em><h3>Match a target</h3></header>
        <button type="button" className="ms-eqlab-empty" onClick={props.onPickGear}>
          <Icon name="headphones" size={28} />
          <span>Choose what you listen on</span>
          <Icon name="chevron_right" />
        </button>
      </section>
    )
  }

  return (
    <section className="ms-eqlab">
      <header>
        <em>1</em>
        <h3>Match a target</h3>
        <button type="button" className="ms-eqlab-device" onClick={props.onPickGear}><Icon name="headphones" size={18} />{props.deviceName}</button>
      </header>

      <div className="ms-chips ms-eqlab-targets" role="radiogroup" aria-label="Target">
        {targets.map((t) => (
          <button type="button" role="radio" aria-checked={lab.aim.kind === 'target' && lab.aim.name === t.name} key={t.name} className={`ms-chip${lab.aim.kind === 'target' && lab.aim.name === t.name ? ' on' : ''}`} onClick={() => props.onLab({ aim: { kind: 'target', name: t.name } })}>
            {t.name}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={Boolean(aimDevice)} className={`ms-chip${aimDevice ? ' on' : ''}`} onClick={() => setPicking(true)}>
          <Icon name="swap_horiz" size={18} />{aimDevice ? aimDevice.name : 'Another device'}
        </button>
      </div>

      {lab.aim.kind !== 'off' && (
        <>
          <div className="ms-eqlab-prefs">
            {PREFS.map((p) => (
              <label key={p.key} className="ms-eqlab-pref">
                <span><Icon name={p.icon} size={18} />{p.label}<b>{lab.prefs[p.key] > 0 ? '+' : ''}{lab.prefs[p.key].toFixed(1)}{p.unit}</b></span>
                <Slider thick label={p.label} min={p.min} max={p.max} step={p.step} value={lab.prefs[p.key]} onChange={(v) => props.onLab({ prefs: { ...lab.prefs, [p.key]: v } })} />
              </label>
            ))}
          </div>

          <div className="ms-eqlab-options">
            <div className="ms-segment-small" role="radiogroup" aria-label="How far to correct">
              <button type="button" className={lab.gentle ? 'on' : ''} onClick={() => props.onLab({ gentle: true })}>Gentle</button>
              <button type="button" className={lab.gentle ? '' : 'on'} onClick={() => props.onLab({ gentle: false })}>Full</button>
            </div>
            <div className="ms-segment-small" role="radiogroup" aria-label="Number of filters">
              {[5, 8, 10].map((n) => <button type="button" key={n} className={lab.filters === n ? 'on' : ''} onClick={() => props.onLab({ filters: n })}>{n} filters</button>)}
            </div>
            {family === 'iem' && (
              <div className="ms-segment-small" role="radiogroup" aria-label="How deep the tips sit" title={`Moves the ear-canal peak: ${DEPTHS.map(([d, l]) => `${l} ${(CANAL_PEAK_HZ[d] / 1000).toFixed(1)} kHz`).join(', ')}`}>
                {DEPTHS.map(([d, label]) => <button type="button" key={d} className={lab.depth === d ? 'on' : ''} onClick={() => props.onLab({ depth: d })}>{label} fit</button>)}
              </div>
            )}
            {props.hrtfName && (
              <label className="ms-eqlab-hrtf">
                <input type="checkbox" role="switch" className="ms-switch" checked={lab.hrtf} onChange={(e) => props.onLab({ hrtf: e.target.checked })} />
                <span>Shape for HRTF <b>{props.hrtfName}</b></span>
              </label>
            )}
            {touched && <IconButton icon="restart_alt" label="Reset preferences" onClick={() => props.onLab({ prefs: NO_PREFS })} />}
          </div>

          <div className="ms-eqlab-go">
            {result && (
              <div className="ms-eqlab-score" aria-label={`From ${result.beforeDb.toFixed(1)} dB off target to ${result.afterDb.toFixed(1)} dB`}>
                <b>{result.beforeDb.toFixed(1)}</b><Icon name="arrow_forward" size={20} /><b className="good">{result.afterDb.toFixed(1)}</b><small>dB off target</small>
              </div>
            )}
            <button type="button" className="ms-btn primary ms-eqlab-apply" disabled={!result} onClick={() => result && props.onApply(result, targetName)}>
              <Icon name="auto_fix_high" size={22} /> AutoEQ
            </button>
          </div>
        </>
      )}

      {picking && (
        <Dialog title="Sound like another device" onClose={() => setPicking(false)}>
          <DevicePickerModal db={db} onPick={(id) => { props.onLab({ aim: { kind: 'device', id } }); setPicking(false) }} />
        </Dialog>
      )}
    </section>
  )
}

// ---- step 2: fine-tune by ear

/** The tone slider runs over the range where ears and units differ; the graph can take it anywhere. */
const TONE_LO = 200
const TONE_HI = 16000
const toneFrac = (hz: number) => Math.log(hz / TONE_LO) / Math.log(TONE_HI / TONE_LO)
const toneHzOf = (f: number) => TONE_LO * (TONE_HI / TONE_LO) ** f

export function FineTuneCard(props: {
  hz: number
  playing: boolean
  sweeping: boolean
  canUndo: boolean
  onHz: (hz: number) => void
  onPlay: (on: boolean) => void
  onSweep: (on: boolean) => void
  /** Too loud (−) or too quiet (+) at the tone. */
  onNudge: (dir: 1 | -1) => void
  /** The tone sits off-centre towards this side. */
  onLean: (side: 'left' | 'right') => void
  onUndo: () => void
}) {
  return (
    <section className={`ms-eqlab ms-eqtune${props.playing ? ' playing' : ''}`}>
      <header>
        <em>2</em>
        <h3>Fine-tune by ear</h3>
        {props.canUndo && <IconButton icon="undo" label="Undo the last change" onClick={props.onUndo} />}
      </header>

      <div className="ms-eqtune-tone">
        <button type="button" className="ms-eqtune-play" aria-label={props.playing ? 'Stop the tone' : 'Play the tone'} onClick={() => props.onPlay(!props.playing)}>
          <Icon name={props.playing ? 'stop' : 'play_arrow'} size={36} />
        </button>
        <div className="grow">
          <output className="ms-eqtune-hz">{hzLabel(props.hz)}</output>
          <Slider thick label="Tone frequency" min={0} max={1} step={0.002} value={Math.max(0, Math.min(1, toneFrac(props.hz)))} onChange={(f) => { props.onSweep(false); props.onHz(Math.round(toneHzOf(f))) }} />
        </div>
        <button type="button" className={`ms-chip${props.sweeping ? ' on' : ''}`} onClick={() => props.onSweep(!props.sweeping)}>
          <Icon name="waves" size={18} />Sweep
        </button>
      </div>

      <div className="ms-eqtune-acts">
        <button type="button" className="ms-eqtune-act loud" onClick={() => props.onNudge(-1)}>
          <Icon name="keyboard_double_arrow_down" size={26} /><span>Too loud here</span>
        </button>
        <button type="button" className="ms-eqtune-act quiet" onClick={() => props.onNudge(1)}>
          <Icon name="keyboard_double_arrow_up" size={26} /><span>Too quiet here</span>
        </button>
        <button type="button" className="ms-eqtune-act lean" onClick={() => props.onLean('left')}>
          <Icon name="west" size={24} /><span>Leans left</span>
        </button>
        <button type="button" className="ms-eqtune-act lean" onClick={() => props.onLean('right')}>
          <span>Leans right</span><Icon name="east" size={24} />
        </button>
      </div>
    </section>
  )
}

// ---- the HRTF picked in Spatial, as a change to the target (plan §84 D)

interface DfFile { freqs: number[]; sets: Record<string, number[]> }
let dfLoading: Promise<DfFile | null> | null = null
/** public/data/hrir/df.json (scripts/build_hrtf_df.py): each bundled HRTF's diffuse field against the generic one. */
const loadDf = () =>
  (dfLoading ??= fetch(`${import.meta.env.BASE_URL}data/hrir/df.json`).then((r) => (r.ok ? (r.json() as Promise<DfFile>) : null)).catch(() => null))

/**
 * How the chosen HRTF's outer ear differs from the dummy head the targets were made on, on `grid` (1–10 kHz only).
 * `strength` scales it: in full for in-ears (they bypass the outer ear), half for over-ears (which already play
 * through your own outer ear, so a full correction would count part of it twice). Null for the generic or an
 * imported set, and before the data has loaded.
 */
export function useHrtfTilt(grid: ArrayLike<number> | null, strength: number): { name: string; curve: Float64Array } | null {
  const [df, setDf] = useState<DfFile | null>(null)
  const [hrirId, setHrirId] = useState(() => loadSpatial().hrirId)
  useEffect(() => { void loadDf().then(setDf) }, [])
  useEffect(() => onSpatialChange((s) => setHrirId(s.hrirId)), [])
  return useMemo(() => {
    const d = df?.sets[hrirId]
    if (!df || !d || !grid || !strength) return null
    const [lo, hi] = [df.freqs[0], df.freqs[df.freqs.length - 1]]
    return { name: hrirId.replace('hutubs-', 'pp'), curve: Float64Array.from(grid, (hz) => (hz < lo || hz > hi ? 0 : curveAt(df.freqs, d, hz) * strength)) }
  }, [df, hrirId, grid, strength])
}

// ---- an imported EQ: which device is it for? (plan §85 B)

/**
 * Asked after importing an EQ file that doesn't say (squig.link, Hangout, AutoEq text): the device it was made for.
 * With one, the EQ shows up in the Database on that device; without, it's just a preset.
 */
export function ImportDeviceDialog(props: { db: Database; presetName: string; activeId: string | null; onDone: (deviceId: string | null) => void }) {
  const active = props.activeId ? props.db.catalog.byId.get(props.activeId) : undefined
  return (
    <Dialog
      title="What device is this EQ for?"
      onClose={() => props.onDone(null)}
      footer={<button type="button" className="ms-btn text" onClick={() => props.onDone(null)}>No device</button>}
    >
      <div className="ms-eqlab-import">
        <p><Icon name="tune" size={20} /><b>{props.presetName}</b></p>
        {active && (
          <button type="button" className="ms-eqlab-empty" onClick={() => props.onDone(active.id)}>
            <Icon name="headphones" size={24} />
            <span>{active.name}</span>
            <Icon name="check" />
          </button>
        )}
        <DevicePickerModal db={props.db} onPick={(id) => props.onDone(id)} />
      </div>
    </Dialog>
  )
}

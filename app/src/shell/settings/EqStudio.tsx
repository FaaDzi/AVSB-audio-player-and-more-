// The EQ tab's graph and its two guided steps (plan §84 B, C, E): AutoEQ to a target, then fine-tune by ear.
import '../eqStudio.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSpatial, onSpatialChange } from '../../spatial/settings'
import { Dialog, Icon, IconButton, Menu } from '../ui'
import { Slider } from '../PlayerBar'
import type { Database } from '../database/catalog'
import { DevicePickerModal } from '../sound/AudioProfileSheet'
import { familyOf, targetsFor, type Aim } from '../sound/soundCurve'
import { autoEq, CANAL_PEAK_HZ, curveAt, midLevel, NO_PREFS, type AutoEqResult, type EqPrefs, type EqScene, type FitDepth } from '../eqStudio'
import { getSetting, setSetting } from './store'
import type { Biquad } from '../../eq/biquad'
import { PEQ_LIMITS, PEQ_MAX_FILTERS, tidyFilter } from '../../eq/peq'
import { NumField } from '../../gallery/PeqEditor'
import { smoothLog } from '../../audio/filter'
import { getSpeakerKind, isPhoneSpeaker, setSpeakerKind, SPEAKER_KINDS } from '../sound/phoneSpeaker'

// ---- what the AutoEQ card remembers, per device

export interface EqLab {
  aim: Aim
  prefs: EqPrefs
  /** Standard (true) or Precise (§91 E2); it was Gentle/Full. Standard also aims inside what the measurements agree on. */
  gentle: boolean
  depth: FitDepth
  filters: number
  /** Let the HRTF picked in Spatial shape the target. */
  hrtf: boolean
}
export const LAB_DEFAULT: EqLab = { aim: { kind: 'off' }, prefs: NO_PREFS, gentle: true, depth: 'normal', filters: 10, hrtf: true }
/** §91 E3: 5 / 10 / 15 / 20 filters (8 was a choice before; it reads as 10). */
export const FILTER_COUNTS = [5, 10, 15, 20]

function labStore(): Record<string, Partial<EqLab>> {
  try {
    return JSON.parse(String(getSetting('eqlab') ?? '{}')) as Record<string, Partial<EqLab>>
  } catch {
    return {}
  }
}
export const getLab = (deviceId: string | null): EqLab => {
  const lab = { ...LAB_DEFAULT, ...labStore()[deviceId ?? ''] }
  return FILTER_COUNTS.includes(lab.filters) ? lab : { ...lab, filters: 10 }
}
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
/** §96: like PEQdB, a filter's colour says its type: the card, its dot and its label share it. */
export const KIND_COLOR: Record<Biquad['kind'], string> = { peak: '#ffb86b', lowshelf: '#ff7ab6', highshelf: '#c9a5ff', lowpass: '#5ee0d0', highpass: '#9be28a' }
/** Names in full on screen; the files keep Equalizer APO's PK / LSC / HSC / LPQ / HPQ. */
export const KIND_NAME: Record<Biquad['kind'], string> = { peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf', lowpass: 'Low-pass', highpass: 'High-pass' }

export interface GraphHandle {
  hz: number
  db: number
  /** A parametric filter's width, shown beside its dot while it's touched. */
  q?: number
  /** Its type, for the dot's colour. */
  kind?: Biquad['kind']
}

export function EqGraph(props: {
  on: boolean
  compact: boolean
  grid: ArrayLike<number>
  /** The EQ alone, and anything else in the chain (the Sound aim), dB on `grid`. */
  eqDb: ArrayLike<number>
  extraDb: ArrayLike<number> | null
  device: ArrayLike<number> | null
  /** The device line's name in the legend (the phone speaker's is a typical one, not yours measured). */
  deviceLabel?: string
  target: ArrayLike<number> | null
  ears: { left: ArrayLike<number>; right: ArrayLike<number> } | null
  handles: GraphHandle[]
  /** Handles slide along the frequency axis too (parametric filters), not just up and down (bands). */
  freeHz: boolean
  onHandle?: (i: number, to: Partial<GraphHandle>) => void
  onHandleQ?: (i: number, factor: number) => void
  onAdd?: (at: GraphHandle) => void
  onDoubleTap?: () => void
  onRemove?: (i: number) => void
  /** The test tone's frequency while it plays; the graph then moves it instead of showing a readout. */
  toneHz: number | null
  onTone?: (hz: number) => void
}) {
  const { grid, eqDb, device, target, handles } = props
  const plot = useRef<HTMLDivElement>(null)
  const drag = useRef<number | 'tone' | null>(null)
  // §91 F: a tap on (or near) the EQ line adds a filter there; a second finger pinches the held dot's width
  const tap = useRef<{ x: number; y: number } | null>(null)
  const fingers = useRef(new Map<number, number>())
  const pinch = useRef<number | null>(null)
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
  const pinched = (e: React.PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return false
    fingers.current.set(e.pointerId, e.clientX)
    const d = drag.current
    if (typeof d !== 'number' || fingers.current.size < 2) return false
    const [a, b] = [...fingers.current.values()]
    const gap = Math.max(12, Math.abs(a - b))
    // fingers apart: a wider filter (lower Q); together: narrower
    if (pinch.current) props.onHandleQ?.(d, Math.min(1.25, Math.max(0.8, pinch.current / gap)))
    pinch.current = gap
    return true
  }
  const move = (e: React.PointerEvent) => {
    if (pinched(e) && fingers.current.size > 1 && e.pointerType === 'touch' && !e.currentTarget.classList.contains('ms-eqg-handle')) return
    const p = at(e)
    const d = drag.current
    if (d === 'tone') props.onTone?.(p.hz)
    else if (d !== null) props.onHandle?.(d, props.freeHz ? { hz: Math.round(p.hz), db: Math.round(p.db * 2) / 2 } : { db: Math.round(p.db * 2) / 2 })
    else setHover(p.hz)
  }
  const end = (e?: React.PointerEvent) => {
    if (e) fingers.current.delete(e.pointerId)
    if (fingers.current.size < 2) pinch.current = null
    if (!fingers.current.size) drag.current = null
  }
  const maxBoost = Math.max(0, ...Array.from(eqDb))
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
        onPointerUp={(e) => {
          const t = tap.current
          tap.current = null
          if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && props.onAdd && props.freeHz) {
            const p = at(e)
            const r = plot.current!.getBoundingClientRect()
            const lineY = r.top + (yOf(curveAt(grid, eqDb, p.hz)) / H) * r.height
            if (Math.abs(e.clientY - lineY) < 24) props.onAdd({ hz: Math.round(p.hz), db: Math.round(p.db * 2) / 2 })
          }
          end(e)
        }}
        onPointerCancel={(e) => { tap.current = null; end(e) }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('button')) return
          // a second finger while a dot is held: the pinch
          if (typeof drag.current === 'number') {
            e.currentTarget.setPointerCapture(e.pointerId)
            fingers.current.set(e.pointerId, e.clientX)
            return
          }
          if (props.toneHz === null) {
            tap.current = { x: e.clientX, y: e.clientY }
            return
          }
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = 'tone'
          props.onTone?.(at(e).hz)
        }}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('button')) return
          // §100: on a phone a double tap brings the card up instead of adding a filter
          if (props.onDoubleTap) props.onDoubleTap()
          else props.onAdd?.({ hz: Math.round(at(e).hz), db: Math.round(at(e).db * 2) / 2 })
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
            style={{ left: `${xOf(h.hz) / 10}%`, top: `${(yOf(h.db) / H) * 100}%`, '--c': props.freeHz ? (h.kind ? KIND_COLOR[h.kind] : filterColor(i)) : undefined } as React.CSSProperties}
            aria-label={`${hzLabel(h.hz)}, ${signed(h.db)}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              fingers.current.set(e.pointerId, e.clientX)
              drag.current = i
              setSel(i)
            }}
            onPointerMove={(e) => { if (drag.current === i) { e.stopPropagation(); move(e) } }}
            onPointerUp={(e) => { e.stopPropagation(); end(e) }}
            onPointerCancel={(e) => end(e)}
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
        {sel !== null && handles[sel] && props.freeHz && (
          <span className="ms-eqg-dotread" style={{ left: `${xOf(handles[sel].hz) / 10}%`, top: `${(yOf(handles[sel].db) / H) * 100}%` }}>
            <b>{hzLabel(handles[sel].hz)}</b> {signed(handles[sel].db)}{handles[sel].q !== undefined && ` · Q ${handles[sel].q!.toFixed(2)}`}
          </span>
        )}
        {props.on && maxBoost > 0.05 && <span className="ms-eqg-headroom">Headroom −{maxBoost.toFixed(1)} dB</span>}
        {readHz !== null && readDb !== null && (
          <span className="ms-eqg-read" style={{ left: `${xOf(readHz) / 10}%` }}>
            <b>{hzLabel(readHz)}</b> {signed(readDb)}
          </span>
        )}
        {[100, 1000, 10000].map((hz) => <span key={hz} className="ms-eqg-hz" style={{ left: `${xOf(hz) / 10}%` }}>{hz >= 1000 ? `${hz / 1000}k` : hz}</span>)}
      </div>
      {!props.compact && (
        <div className="ms-eqg-legend">
          {lines.device && <span className="device">{props.deviceLabel ?? 'Your device'}</span>}
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
  /** Opens the HRTF test (Spatial). */
  onPickHrtf: () => void
  /** §96 D: the phone speaker's Warmth (a gentle low shelf, 0 to +3 dB). */
  warmth: number
  onWarmth: (db: number) => void
  /** §106 G: bumped by the preset bar's AutoEQ button: runs AutoEQ as this card's own button does. */
  run?: number
}) {
  const { db, deviceId, lab, scene } = props
  // §91 E5: the HRTF test first, for a closer match; asked once, Skip remembered
  const [askHrtf, setAskHrtf] = useState(false)
  const [picking, setPicking] = useState(false)
  // §91 E3: the target, the button and the score; everything else waits under Advanced
  const [advanced, setAdvanced] = useState(false)
  const targets = useMemo(() => targetsFor(db.catalog, deviceId), [db, deviceId])
  const family = familyOf(db.catalog, deviceId)
  const aimDevice = lab.aim.kind === 'device' ? db.catalog.byId.get(lab.aim.id) : undefined
  const targetName = lab.aim.kind === 'target' ? lab.aim.name : aimDevice?.name ?? ''
  const result = useMemo(() => (scene ? autoEq(scene, lab.filters, lab.gentle ? 'standard' : 'precise', family === 'iem') : null), [scene, lab.filters, lab.gentle, family])
  const runAuto = () => {
    if (!result) return
    if (!props.hrtfName && family !== 'room' && !getSetting('hrtfskip')) setAskHrtf(true)
    else props.onApply(result, targetName)
  }
  // the preset bar's button: the same as pressing AutoEQ here (nothing for the phone speaker: no target to aim at)
  const ran = useRef(props.run)
  useEffect(() => {
    if (props.run === ran.current) return
    ran.current = props.run
    if (!isPhoneSpeaker(deviceId)) runAuto()
  }, [props.run]) // eslint-disable-line react-hooks/exhaustive-deps
  const touched = PREFS.some((p) => lab.prefs[p.key] !== 0)

  // the phone's own speaker (§86 G): no measurement to aim from, but which speakers play is yours to say
  if (isPhoneSpeaker(deviceId)) {
    return (
      <section className="ms-eqlab">
        <header><em>1</em><h3>{props.deviceName}</h3><Icon name="smartphone" /></header>
        <div className="ms-segment-small big" role="radiogroup" aria-label="Which speakers play">
          {SPEAKER_KINDS.map(([kind, label]) => (
            <button type="button" key={kind} role="radio" aria-checked={getSpeakerKind() === kind} className={getSpeakerKind() === kind ? 'on' : ''} onClick={() => setSpeakerKind(kind)}>{label}</button>
          ))}
        </div>
        {/* §96 D (council 2026-11-20): flat and guarded; a bass lift only if you want it, and never past +3 dB */}
        <label className="ms-eqlab-pref ms-eqlab-warmth">
          <span><Icon name="local_fire_department" size={18} />Warmth<b>{props.warmth > 0 ? '+' : ''}{props.warmth.toFixed(1)} dB</b></span>
          <Slider thick label="Warmth" min={0} max={3} step={0.5} value={props.warmth} onChange={props.onWarmth} />
        </label>
        <p className="ms-eqlab-note">Speaker correction (limited). No standard target exists for phone speakers, so nothing is corrected unless you add Warmth or filters; the graph shows a typical phone speaker, and the speaker guard keeps the small drivers safe.</p>
      </section>
    )
  }
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

      {/* §96: the AutoEQ target is one menu, as in PEQdB; "Another device" opens the picker */}
      <label className="ms-eqlab-target">
        <span>Aim at</span>
        <select
          aria-label="AutoEQ target"
          value={lab.aim.kind === 'target' ? `t:${lab.aim.name}` : aimDevice ? 'device' : ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'pick') setPicking(true)
            else if (v.startsWith('t:')) props.onLab({ aim: { kind: 'target', name: v.slice(2) } })
          }}
        >
          {lab.aim.kind === 'off' && <option value="">Choose a target…</option>}
          {targets.map((t) => <option key={t.name} value={`t:${t.name}`}>{t.name}</option>)}
          {aimDevice && <option value="device">{aimDevice.name}</option>}
          <option value="pick">Another device…</option>
        </select>
      </label>

      {lab.aim.kind !== 'off' && (
        <>
          <div className="ms-eqlab-go">
            {result && (
              <div className="ms-eqlab-score" aria-label={`From ${result.beforeDb.toFixed(1)} dB off target to ${result.afterDb.toFixed(1)} dB`}>
                <b>{result.beforeDb.toFixed(1)}</b><Icon name="arrow_forward" size={20} /><b className="good">{result.afterDb.toFixed(1)}</b><small>dB off target</small>
              </div>
            )}
            <button
              type="button"
              className="ms-btn primary ms-eqlab-apply"
              disabled={!result}
              onClick={runAuto}
            >
              <Icon name="auto_fix_high" size={22} /> AutoEQ
            </button>
          </div>
          {askHrtf && result && (
            <div className="ms-eqlab-ask" role="alert">
              <Icon name="hearing" size={22} />
              <span className="grow">Pick your HRTF first for a closer match</span>
              <button type="button" className="ms-btn tonal" onClick={() => { setAskHrtf(false); props.onPickHrtf() }}>Pick HRTF</button>
              <button type="button" className="ms-btn text" onClick={() => { setAskHrtf(false); setSetting('hrtfskip', true); props.onApply(result, targetName) }}>Skip</button>
            </div>
          )}

          <button type="button" className={`ms-eqlab-more${advanced ? ' open' : ''}`} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            <Icon name="tune" size={18} />Advanced
            <span className="ms-eqlab-more-sum">{lab.gentle ? 'Standard' : 'Precise'} · {lab.filters} filters{touched ? ' · your taste' : ''}</span>
            <Icon name={advanced ? 'expand_less' : 'expand_more'} size={20} />
          </button>

          {advanced && (
            <>
              <div className="ms-eqlab-options">
                <div className="ms-segment-small" role="radiogroup" aria-label="How closely to follow the target">
                  <button type="button" className={lab.gentle ? 'on' : ''} title="Smooths the correction and handles the treble with one shelf" onClick={() => props.onLab({ gentle: true })}>Standard</button>
                  <button type="button" className={lab.gentle ? '' : 'on'} title="Follows the curve, with peaks up to 16 kHz" onClick={() => props.onLab({ gentle: false })}>Precise</button>
                </div>
                <div className="ms-segment-small" role="radiogroup" aria-label="Number of filters">
                  {FILTER_COUNTS.map((n) => <button type="button" key={n} className={lab.filters === n ? 'on' : ''} onClick={() => props.onLab({ filters: n })}>{n}</button>)}
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
              <div className="ms-eqlab-prefs">
                {PREFS.map((p) => (
                  <label key={p.key} className="ms-eqlab-pref">
                    <span><Icon name={p.icon} size={18} />{p.label}<b>{lab.prefs[p.key] > 0 ? '+' : ''}{lab.prefs[p.key].toFixed(1)}{p.unit}</b></span>
                    <Slider thick label={p.label} min={p.min} max={p.max} step={p.step} value={lab.prefs[p.key]} onChange={(v) => props.onLab({ prefs: { ...lab.prefs, [p.key]: v } })} />
                  </label>
                ))}
              </div>
            </>
          )}
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

/** The tone slider covers everything you can hear (§86 B). */
const TONE_LO = 20
const TONE_HI = 20000
/** The automatic sweep: the treble, where ears and units differ (the Headphone Show's method), or everything. */
export const SWEEP_TREBLE: [number, number] = [1000, 14000]
export const SWEEP_FULL: [number, number] = [TONE_LO, TONE_HI]
const toneFrac = (hz: number) => Math.log(hz / TONE_LO) / Math.log(TONE_HI / TONE_LO)
const toneHzOf = (f: number) => TONE_LO * (TONE_HI / TONE_LO) ** f

export function FineTuneCard(props: {
  hz: number
  playing: boolean
  sweeping: boolean
  /** The sweep covers 20 Hz–20 kHz instead of the treble only. */
  fullRange: boolean
  onFullRange: (on: boolean) => void
  canUndo: boolean
  onHz: (hz: number) => void
  onPlay: (on: boolean) => void
  onSweep: (on: boolean) => void
  /** Too loud (−) or too quiet (+) at the tone. */
  onNudge: (dir: 1 | -1) => void
  /** The tone sits off-centre towards this side. */
  onLean: (side: 'left' | 'right') => void
  onUndo: () => void
  /** §91 F: the treble and bass shelves' gains (dB), for the first two steps. */
  treble: number
  bass: number
  onShelf: (kind: 'lowshelf' | 'highshelf', gain: number) => void
}) {
  // PEQdB's order: the treble first (the part ears and measurements disagree on most), then bass and balance, then peaks
  const [step, setStep] = useState<'treble' | 'bass' | 'peaks'>('treble')
  return (
    <section className={`ms-eqlab ms-eqtune${props.playing ? ' playing' : ''}`}>
      <header>
        <em>2</em>
        <h3>Fine-tune by ear</h3>
        {props.canUndo && <IconButton icon="undo" label="Undo the last change" onClick={props.onUndo} />}
      </header>

      <div className="ms-segment-small big ms-eqtune-steps" role="tablist" aria-label="Fine-tune step">
        {([['treble', '1 Treble'], ['bass', '2 Bass'], ['peaks', '3 Peaks']] as const).map(([k, label]) => (
          <button type="button" role="tab" key={k} aria-selected={step === k} className={step === k ? 'on' : ''} onClick={() => setStep(k)}>{label}</button>
        ))}
      </div>

      {step !== 'peaks' && (
        <div className="ms-eqtune-shelf">
          <span className="ms-eqtune-shelf-head">
            <Icon name={step === 'treble' ? 'music_note' : 'speaker'} size={20} />
            {step === 'treble' ? 'Treble shelf · 8 kHz' : 'Bass shelf · 105 Hz'}
            <b>{signed(step === 'treble' ? props.treble : props.bass)}</b>
          </span>
          <Slider thick label={step === 'treble' ? 'Treble shelf' : 'Bass shelf'} min={-8} max={8} step={0.5} value={step === 'treble' ? props.treble : props.bass} onChange={(v) => props.onShelf(step === 'treble' ? 'highshelf' : 'lowshelf', v)} />
          {step === 'bass' && (
            <div className="ms-eqtune-acts two">
              <button type="button" className="ms-eqtune-act lean" onClick={() => props.onLean('left')}><Icon name="west" size={24} /><span>Leans left</span></button>
              <button type="button" className="ms-eqtune-act lean" onClick={() => props.onLean('right')}><span>Leans right</span><Icon name="east" size={24} /></button>
            </div>
          )}
          <button type="button" className="ms-btn text ms-eqtune-next" onClick={() => setStep(step === 'treble' ? 'bass' : 'peaks')}>
            Next<Icon name="arrow_forward" size={18} />
          </button>
        </div>
      )}

      {step === 'peaks' && (<>
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
        <button type="button" className={`ms-chip${props.fullRange ? ' on' : ''}`} aria-pressed={props.fullRange} onClick={() => props.onFullRange(!props.fullRange)}>
          <Icon name="unfold_more" size={18} />Full range
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
      </>)}
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
 * How the chosen HRTF's outer ear differs from the dummy head the targets were made on, on `grid` (1–8.5 kHz).
 * `strength` scales it: in full for in-ears (they bypass the outer ear), half for over-ears (which already play
 * through your own outer ear, so a full correction would count part of it twice). Null for the generic or an
 * imported set, and before the data has loaded.
 */
/** §91 E5: the HRTF counts in full up to 7 kHz and fades out by 8.5 kHz, where heads and measurements stop agreeing. */
export function hrtfReach(hz: number): number {
  if (hz <= 7000) return 1
  if (hz >= 8500) return 0
  return 0.5 + 0.5 * Math.cos((Math.PI * Math.log2(hz / 7000)) / Math.log2(8500 / 7000))
}

export function useHrtfTilt(grid: ArrayLike<number> | null, strength: number): { name: string; curve: Float64Array } | null {
  const [df, setDf] = useState<DfFile | null>(null)
  const [hrirId, setHrirId] = useState(() => loadSpatial().hrirId)
  useEffect(() => { void loadDf().then(setDf) }, [])
  useEffect(() => onSpatialChange((s) => setHrirId(s.hrirId)), [])
  return useMemo(() => {
    const d = df?.sets[hrirId]
    if (!df || !d || !grid || !strength) return null
    const [lo, hi] = [df.freqs[0], df.freqs[df.freqs.length - 1]]
    const raw = Float64Array.from(grid, (hz) => (hz < lo || hz > hi ? 0 : curveAt(df.freqs, d, hz) * strength * hrtfReach(hz)))
    // §91 E5: a third of an octave smooth, like Standard's treble rule: a head's fine ripples don't belong in the EQ
    const ppo = Math.round(1 / Math.log2(grid[1] / grid[0]))
    return { name: hrirId.replace('hutubs-', 'pp'), curve: smoothLog(raw, ppo, 1 / 3) }
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

// ---- §96: the filters as PEQdB's cards, coloured by type

export function FilterCards(props: {
  filters: Biquad[]
  onChange: (filters: Biquad[]) => void
}) {
  const { filters, onChange } = props
  const [typeMenu, setTypeMenu] = useState<{ i: number; x: number; y: number } | null>(null)
  const set = (i: number, patch: Partial<Biquad>) => onChange(filters.map((f, k) => (k === i ? tidyFilter({ ...f, ...patch }) : f)))
  const add = () => {
    if (filters.length >= PEQ_MAX_FILTERS) return
    // a new peak goes into the widest gap between the filters already there, and into the list at its place
    const at = [20, ...filters.map((f) => f.fc).sort((a, b) => a - b), 20000]
    let best = 1000, gap = 0
    for (let k = 1; k < at.length; k++) {
      const g = Math.log2(at[k] / at[k - 1])
      if (g > gap) { gap = g; best = Math.round(Math.sqrt(at[k] * at[k - 1])) }
    }
    const next = filters.findIndex((f) => f.fc > best)
    const fresh = tidyFilter({ kind: 'peak', fc: best, gain: 0, q: 1.41 })
    onChange(next < 0 ? [...filters, fresh] : [...filters.slice(0, next), fresh, ...filters.slice(next)])
  }
  return (
    <section className="ms-eqcards">
      <div className="ms-eqcards-tools">
        <button type="button" className="ms-btn text" disabled={filters.length >= PEQ_MAX_FILTERS} onClick={add}><Icon name="add" size={20} />Add filter</button>
        <span className="ms-eqcards-count">{filters.length} / {PEQ_MAX_FILTERS}</span>
      </div>
      {filters.map((f, i) => (
        <div key={i} className="ms-eqcard" style={{ '--c': KIND_COLOR[f.kind] } as React.CSSProperties}>
          <div className="ms-eqcard-head">
            <b>{i + 1}</b>
            <button type="button" className="ms-eqcard-kind" aria-haspopup="menu" aria-label={`Filter ${i + 1} type: ${KIND_NAME[f.kind]}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTypeMenu({ i, x: r.left, y: r.bottom + 4 }) }}>
              <span>{KIND_NAME[f.kind]}</span><Icon name="arrow_drop_down" size={18} />
            </button>
            <IconButton icon="close" label={`Remove filter ${i + 1}`} small onClick={() => onChange(filters.filter((_, k) => k !== i))} />
          </div>
          <div className="ms-eqcard-fields">
            <NumField label="Freq" value={f.fc} min={PEQ_LIMITS.fMin} max={PEQ_LIMITS.fMax} step={1} onChange={(v) => set(i, { fc: v })} />
            {f.kind === 'lowpass' || f.kind === 'highpass'
              ? <span className="peq-field off"><input disabled value="—" aria-label="No gain" /><span>Gain</span></span>
              : <NumField label="Gain" value={f.gain} min={PEQ_LIMITS.gainMin} max={PEQ_LIMITS.gainMax} step={0.1} onChange={(v) => set(i, { gain: v })} />}
            <NumField label="Q" value={f.q} min={PEQ_LIMITS.qMin} max={PEQ_LIMITS.qMax} step={0.05} onChange={(v) => set(i, { q: v })} />
          </div>
        </div>
      ))}
      {!filters.length && <p className="ms-eqcards-empty">No filters yet. Press AutoEQ, tap the EQ line on the graph, or add one with +.</p>}
      {typeMenu && filters[typeMenu.i] && (
        <Menu
          x={typeMenu.x}
          y={typeMenu.y}
          onClose={() => setTypeMenu(null)}
          items={(Object.keys(KIND_NAME) as Biquad['kind'][]).map((k) => ({
            label: KIND_NAME[k],
            checked: filters[typeMenu.i].kind === k,
            onSelect: () => set(typeMenu.i, { kind: k }),
          }))}
        />
      )}
    </section>
  )
}

// ---- §96: preference targets and devices to test as one row of pills under the graph

export function TargetPills(props: {
  targets: { id: string; name: string; color: string }[]
  items: { id: string; kind: string; name: string; color: string; strength: number }[]
  activeId: string | null
  onToggle: (t: { id: string; name: string; color: string }) => void
  onRemoveDevice: (id: string) => void
  onAddDevice: () => void
}) {
  const on = new Set(props.items.map((i) => i.id))
  const devices = props.items.filter((i) => i.kind === 'device')
  return (
    <div className="ms-tpills" role="group" aria-label="Your targets and devices to test">
      {props.targets.map((t) => (
        <button
          type="button"
          key={t.id}
          aria-pressed={on.has(t.id)}
          className={`ms-tpill${on.has(t.id) ? ' on' : ''}${props.activeId === t.id ? ' live' : ''}`}
          style={{ '--c': t.color } as React.CSSProperties}
          title={on.has(t.id) ? 'In your quick palette: tap to remove' : 'Tap to add to your quick palette'}
          onClick={() => props.onToggle(t)}
        >
          {t.name}
        </button>
      ))}
      {devices.map((d) => (
        <span key={d.id} className={`ms-tpill on device${props.activeId === d.id ? ' live' : ''}`} style={{ '--c': d.color } as React.CSSProperties}>
          {d.name} <small>{d.strength}%</small>
          <button type="button" aria-label={`Remove ${d.name}`} onClick={() => props.onRemoveDevice(d.id)}><Icon name="close" size={14} /></button>
        </span>
      ))}
      <button type="button" className="ms-tpill add" onClick={props.onAddDevice}><Icon name="add" size={16} />Device</button>
    </div>
  )
}

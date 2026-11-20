import { useMemo, useRef, useState } from 'react'
import { chainDb, type Biquad } from '../eq/biquad'
import { nextFilter, PEQ_LIMITS, PEQ_MAX_FILTERS, peqAsParametric, tidyFilter } from '../eq/peq'

/**
 * Advanced custom EQ (plan §52.3): drag a point to set a filter's frequency and gain, scroll on it
 * (or use the table) for Q. Every filter is listed below with exact values, like Equalizer APO.
 */
const W = 420
const H = 200
const PAD = 8
const DB = 15
const xOf = (f: number) => PAD + (Math.log(f / 20) / Math.log(1000)) * (W - 2 * PAD)
const fOf = (x: number) => 20 * 1000 ** ((x - PAD) / (W - 2 * PAD))
const yOf = (db: number) => H / 2 - (db / DB) * (H / 2 - PAD)
const dbOf = (y: number) => ((H / 2 - y) / (H / 2 - PAD)) * DB
const GRID_HZ = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const PLOT_HZ = Array.from({ length: 200 }, (_, i) => 20 * 1000 ** (i / 199))
const KIND_LABEL: Record<Biquad['kind'], string> = { peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf', lowpass: 'Low-pass', highpass: 'High-pass' }
const fmtHz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : `${f}`)

export function PeqEditor(props: { filters: Biquad[]; onChange: (f: Biquad[]) => void; sampleRate: number; maxFilters?: number; /** The page has its own graph with the handles (the shell's EQ tab): only the table shows, each row in its handle's colour. */ tableOnly?: (i: number) => string }) {
  const { filters, onChange, sampleRate } = props
  const max = Math.min(PEQ_MAX_FILTERS, props.maxFilters ?? PEQ_MAX_FILTERS)
  // the filter table folds away on phones (the graph stays); open on wider screens
  const [tableOpen] = useState(() => Boolean(props.tableOnly) || typeof window === 'undefined' || window.innerWidth > 640)
  const [sel, setSel] = useState<number | null>(filters.length ? 0 : null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)

  const total = useMemo(() => chainDb(filters, PLOT_HZ, sampleRate), [filters, sampleRate])
  const preamp = useMemo(() => peqAsParametric(filters, sampleRate).preampDb, [filters, sampleRate])
  const set = (i: number, patch: Partial<Biquad>) => onChange(filters.map((f, k) => (k === i ? tidyFilter({ ...f, ...patch }) : f)))

  const toSvg = (e: React.PointerEvent) => {
    const m = svgRef.current?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  const onMove = (e: React.PointerEvent) => {
    const i = dragging.current
    if (i === null) return
    const p = toSvg(e)
    if (p) set(i, { fc: fOf(p.x), gain: dbOf(p.y) })
  }

  const path = Array.from(total, (db, i) => `${i ? 'L' : 'M'}${xOf(PLOT_HZ[i]).toFixed(1)},${yOf(Math.max(-DB, Math.min(DB, db))).toFixed(1)}`).join(' ')

  return (
    <div className="peq">
      {!props.tableOnly && <svg
        ref={svgRef}
        className="peq-graph"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        role="img"
        aria-label="Parametric EQ response"
      >
        {GRID_HZ.map((f) => (
          <g key={f}>
            <line className="peq-grid" x1={xOf(f)} x2={xOf(f)} y1={PAD} y2={H - PAD} />
            <text className="peq-axis" x={xOf(f) + 2} y={H - PAD - 2}>{fmtHz(f)}</text>
          </g>
        ))}
        {[-12, -6, 0, 6, 12].map((d) => (
          <g key={d}>
            <line className={d ? 'peq-grid' : 'peq-zero'} x1={PAD} x2={W - PAD} y1={yOf(d)} y2={yOf(d)} />
            <text className="peq-axis" x={PAD + 2} y={yOf(d) - 2}>{d > 0 ? `+${d}` : d}</text>
          </g>
        ))}
        <path className="peq-curve" d={path} />
        {filters.map((f, i) => (
          <circle
            key={i}
            className={`peq-node ${sel === i ? 'on' : ''}`}
            cx={xOf(f.fc)}
            cy={yOf(f.gain)}
            r={sel === i ? 11 : 9}
            tabIndex={0}
            aria-label={`Filter ${i + 1}: ${KIND_LABEL[f.kind]} ${fmtHz(f.fc)} Hz, ${f.gain} dB, Q ${f.q}`}
            onPointerDown={(e) => {
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              dragging.current = i
              setSel(i)
            }}
            onWheel={(e) => set(i, { q: f.q * (e.deltaY < 0 ? 1.1 : 1 / 1.1) })}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.5
              if (e.key === 'ArrowUp') set(i, { gain: f.gain + step })
              else if (e.key === 'ArrowDown') set(i, { gain: f.gain - step })
              else if (e.key === 'ArrowRight') set(i, { fc: f.fc * 1.03 })
              else if (e.key === 'ArrowLeft') set(i, { fc: f.fc / 1.03 })
              else return
              e.preventDefault()
            }}
          />
        ))}
        {filters.map((f, i) => (
          <text key={`n${i}`} className="peq-node-num" x={xOf(f.fc)} y={yOf(f.gain) + 4}>
            {i + 1}
          </text>
        ))}
      </svg>}

      <div className="peq-head">
        <span className="peq-preamp">Preamp {preamp.toFixed(1)} dB</span>
        <button
          type="button"
          className="gallery-toggle small"
          disabled={filters.length >= max}
          onClick={() => {
            onChange([...filters, nextFilter(filters)])
            setSel(filters.length)
          }}
        >
          + Filter ({filters.length}/{max})
        </button>
        <button type="button" className="gallery-toggle small" disabled={!filters.length} onClick={() => (onChange([]), setSel(null))}>
          Clear
        </button>
      </div>

      {filters.some((f) => f.q > 8) && <p className="sim-fineprint">Some dongles (FiiO, Walkplay) ignore Q above 8.</p>}
      {filters.length > 10 && <p className="sim-fineprint">Most players take 10 filters; more than that needs Qudelix 5K or Equalizer APO.</p>}
      {filters.length > 0 && (
        <details className="peq-fold" open={tableOpen}>
        <summary>Filters ({filters.length})</summary>
        <div className="peq-table" role="table" aria-label="Filters">
          {/* §91 F: listed low to high; each keeps its number and colour, so it still matches its dot */}
          {filters.map((f, i) => [f, i] as const).sort((a, b) => a[0].fc - b[0].fc).map(([f, i]) => (
            <div key={i} role="row" className={`peq-row ${sel === i ? 'on' : ''}`} onFocus={() => setSel(i)} onClick={() => setSel(i)}>
              <span className="peq-num" style={props.tableOnly ? { background: props.tableOnly(i), color: '#111' } : undefined}>{i + 1}</span>
              <select value={f.kind} onChange={(e) => set(i, { kind: e.target.value as Biquad['kind'] })} aria-label={`Filter ${i + 1} type`}>
                {(Object.keys(KIND_LABEL) as Biquad['kind'][]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              <NumField label="Hz" value={f.fc} min={PEQ_LIMITS.fMin} max={PEQ_LIMITS.fMax} step={1} onChange={(v) => set(i, { fc: v })} />
              <NumField label="dB" value={f.gain} min={PEQ_LIMITS.gainMin} max={PEQ_LIMITS.gainMax} step={0.1} onChange={(v) => set(i, { gain: v })} />
              <NumField label="Q" value={f.q} min={PEQ_LIMITS.qMin} max={PEQ_LIMITS.qMax} step={0.05} onChange={(v) => set(i, { q: v })} />
              <button
                type="button"
                className="peq-del"
                aria-label={`Remove filter ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(filters.filter((_, k) => k !== i))
                  setSel(null)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        </details>
      )}
    </div>
  )
}

/** A number box that only commits a valid number (typing "1." or clearing it mid-edit doesn't jump). */
export function NumField(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="peq-field">
      <input
        type="number"
        inputMode="decimal"
        min={props.min}
        max={props.max}
        step={props.step}
        value={draft ?? String(props.value)}
        onChange={(e) => {
          setDraft(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v)) props.onChange(v)
        }}
        onBlur={() => setDraft(null)}
      />
      <span>{props.label}</span>
    </label>
  )
}

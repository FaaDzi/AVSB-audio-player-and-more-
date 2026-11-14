import { SpatialCrossfeedSection } from '../sound/SoundSection'
import { version } from '../../../package.json'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Chip, Dialog, Icon, IconButton, Menu } from '../ui'
import { useShell } from '../context'
import { Slider } from '../PlayerBar'
import { BANDS, carryOver, DEFAULT_PEQ_FILTERS, DEFAULT_POLAR, DEFAULT_SHAPER, EQ_DEFAULT, eqFilters, getPresets, presetFrom, readPreset, setEq, setPresets, useEq, withPreset, type EqState, type PolarParams, type ShaperParams } from '../eqState'
import { getGear } from '../sound/gear'
import {
  addProfileItem,
  clearSessionAutosave,
  getSessionAutosave,
  isHeadphoneDevice,
  isSpeakerDevice,
  removeProfileItem,
  targetListFor,
  setSessionAutosave,
  toggleProfileTarget,
  useGearProfile,
} from '../sound/gearProfiles'
import { loadDatabase, type Database } from '../database/catalog'
import { kindOfIem } from '../../data/catalog'
import { DevicePickerModal } from '../sound/AudioProfileSheet'
import { getSetting, setSetting, useSettings } from './store'
import { chainDb } from '../../eq/biquad'
import { PeqEditor } from '../../gallery/PeqEditor'
import { clearCrash, clearLogs, lastCrash, useLogs } from '../logs'
import { host, type AppProcessMetric } from '../host'
import { PROVIDERS } from '../metadata'
import { hearingNote, loadHearing, saveHearing, summarise } from '../../hearing/hearing'
import { AudioToolsPage, playDiagnosticTone } from '../sound/AudioTools'
import { BALANCE_BANDS, bandCurves, useChannels } from '../sound/channels'
import { resolveStyleScope, type ThemeStyleScope } from '../theme'

/** The top-right corner of the Settings title bar. A page puts its own icons there. */
export const HeaderSlot = createContext<HTMLElement | null>(null)
/** Swaps the open Settings page for a sibling (same back trail), so the title follows the Equalizer's view chips. */
export const SwapPage = createContext<((id: string) => void) | null>(null)

function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlot)
  return slot ? createPortal(children, slot) : null
}

export const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Speech: [-8, -6, -2, 1, 2, 3, 4, 3, 0, -3],
  Rock: [4, 3, 1, 0, -1, 0, 1, 3, 4, 4],
  Pop: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  Classical: [4, 3, 2, 1, 0, 0, 0, 2, 3, 4],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Acoustic: [4, 3, 2, 1, 1, 1, 2, 3, 3, 2],
}
const freq = (hz: number) => (hz >= 1000 ? (hz % 1000 === 0 && hz >= 10000 ? `${hz / 1000}k` : `${(hz / 1000).toFixed(1)}k`) : String(hz))

// the chart's frequency axis runs from 20 Hz to 20 kHz on a log scale
const hzToX = (hz: number) => (Math.log10(hz / 20) / 3) * 1000
const dbToY = (db: number) => 60 - db * 4

function EqShaperPads({
  params,
  onChange,
}: {
  params: ShaperParams
  onChange: (patch: Partial<ShaperParams>) => void
}) {
  const [activePad, setActivePad] = useState<'bass' | 'mid' | 'treble'>('mid')

  const handlePointer = (pad: 'bass' | 'mid' | 'treble', e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    const nx = clamp((e.clientX - rect.left) / rect.width)
    const ny = clamp((e.clientY - rect.top) / rect.height)
    const gain = +((1 - ny * 2) * 12).toFixed(1)

    if (pad === 'bass') {
      const freq = Math.round(40 * (200 / 40) ** nx)
      onChange({ bassGain: gain, bassFreq: freq })
    } else if (pad === 'mid') {
      const freq = Math.round(300 * (3500 / 300) ** nx)
      onChange({ midGain: gain, midFreq: freq })
    } else {
      const freq = Math.round(5000 * (14000 / 5000) ** nx)
      onChange({ trebleGain: gain, trebleFreq: freq })
    }
  }

  const bassX = Math.max(0, Math.min(1, Math.log(params.bassFreq / 40) / Math.log(200 / 40))) * 100
  const bassY = Math.max(0, Math.min(1, (12 - params.bassGain) / 24)) * 100

  const midX = Math.max(0, Math.min(1, Math.log(params.midFreq / 300) / Math.log(3500 / 300))) * 100
  const midY = Math.max(0, Math.min(1, (12 - params.midGain) / 24)) * 100

  const trebleX = Math.max(0, Math.min(1, Math.log(params.trebleFreq / 5000) / Math.log(14000 / 5000))) * 100
  const trebleY = Math.max(0, Math.min(1, (12 - params.trebleGain) / 24)) * 100

  const formatCoord = (gain: number, xPct: number) => {
    const normX = ((xPct / 50) - 1).toFixed(2)
    const normY = (gain / 12).toFixed(2)
    return `(${Number(normX) > 0 ? '+' : ''}${normX}, ${Number(normY) > 0 ? '+' : ''}${normY})`
  }

  const activeCoordStr =
    activePad === 'bass'
      ? formatCoord(params.bassGain, bassX)
      : activePad === 'mid'
        ? formatCoord(params.midGain, midX)
        : formatCoord(params.trebleGain, trebleX)

  return (
    <div className="ms-eq-shaper">
      <div className="ms-eq-pad-wrap">
        <span className="ms-eq-pad-title">Bass</span>
        <div
          className={`ms-eq-pad bass${activePad === 'bass' ? ' focused' : ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            setActivePad('bass')
            handlePointer('bass', e)
          }}
          onPointerMove={(e) => {
            // only while held: a plain hover used to drag the dot along (the dot "followed the cursor")
            if (activePad === 'bass' && (e.buttons & 1)) handlePointer('bass', e)
          }}
          onDoubleClick={() => onChange({ bassGain: 0, bassFreq: 80 })}
        >
          <div className="ms-eq-pad-grid" />
          <div className="ms-eq-puck" style={{ left: `${bassX}%`, top: `${bassY}%` }} />
        </div>
      </div>

      <div className="ms-eq-pad-wrap">
        <span className="ms-eq-pad-coord-badge">{activeCoordStr}</span>
        <div
          className={`ms-eq-pad mid${activePad === 'mid' ? ' focused' : ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            setActivePad('mid')
            handlePointer('mid', e)
          }}
          onPointerMove={(e) => {
            // only while held: a plain hover used to drag the dot along (the dot "followed the cursor")
            if (activePad === 'mid' && (e.buttons & 1)) handlePointer('mid', e)
          }}
          onDoubleClick={() => onChange({ midGain: 0, midFreq: 1000 })}
        >
          <div className="ms-eq-pad-grid" />
          <span className="ms-eq-pad-label y">Gain</span>
          <span className="ms-eq-pad-label x">Freq</span>
          <div className="ms-eq-puck" style={{ left: `${midX}%`, top: `${midY}%` }} />
        </div>
      </div>

      <div className="ms-eq-pad-wrap">
        <span className="ms-eq-pad-title">Treble</span>
        <div
          className={`ms-eq-pad treble${activePad === 'treble' ? ' focused' : ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            setActivePad('treble')
            handlePointer('treble', e)
          }}
          onPointerMove={(e) => {
            // only while held: a plain hover used to drag the dot along (the dot "followed the cursor")
            if (activePad === 'treble' && (e.buttons & 1)) handlePointer('treble', e)
          }}
          onDoubleClick={() => onChange({ trebleGain: 0, trebleFreq: 10000 })}
        >
          <div className="ms-eq-pad-grid" />
          <div className="ms-eq-puck" style={{ left: `${trebleX}%`, top: `${trebleY}%` }} />
        </div>
      </div>
    </div>
  )
}

function EqPolarRadar({
  params,
  onChange,
  onFinalize,
}: {
  params: PolarParams
  onChange: (patch: Partial<PolarParams>) => void
  onFinalize: () => void
}) {
  const dragging = useRef(false)

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const dx = e.clientX - rect.left - cx
    const dy = e.clientY - rect.top - cy
    const rMax = cx
    const dist = Math.hypot(dx, dy)
    const scale = dist > rMax ? rMax / dist : 1
    const x = +((dx * scale) / rMax).toFixed(2)
    const y = +(-(dy * scale) / rMax).toFixed(2)
    onChange({ x, y })
  }

  const puckX = (params.x * 0.5 + 0.5) * 100
  const puckY = (-params.y * 0.5 + 0.5) * 100

  const coordStr = `(${params.x > 0 ? '+' : ''}${params.x.toFixed(2)}, ${params.y > 0 ? '+' : ''}${params.y.toFixed(2)})`

  return (
    <div className="ms-eq-polar-wrap">
      {/* Top coordinate badge directly above polar stage, matching Image 2 */}
      <span className="ms-eq-polar-coord-badge">{coordStr}</span>

      <div
        className="ms-eq-polar-stage"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          dragging.current = true
          handlePointer(e)
        }}
        onPointerMove={(e) => {
          if (dragging.current) handlePointer(e)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onDoubleClick={() => onChange({ x: 0, y: 0 })}
      >
        <div className="ms-eq-polar-cross" />
        {!params.blind && (
          <>
            <span className="ms-eq-polar-axis n">Bright / Air</span>
            <span className="ms-eq-polar-axis s">Warm / Bass</span>
            <span className="ms-eq-polar-axis w">V-Shape</span>
            <span className="ms-eq-polar-axis e">Vocal</span>
          </>
        )}
        <div className="ms-eq-polar-puck" style={{ left: `${puckX}%`, top: `${puckY}%` }} />
      </div>

      <div className="ms-eq-polar-bottom-bar">
        <label className="ms-eq-polar-toggle" title="Toggle Blind Mode">
          <input
            type="checkbox"
            role="switch"
            className="ms-switch"
            checked={params.blind}
            onChange={(e) => onChange({ blind: e.target.checked })}
          />
        </label>
        <div className="ms-eq-polar-actions">
          <button
            type="button"
            className={`ms-btn small${params.blind ? ' primary' : ' tonal'}`}
            onClick={() => onChange({ blind: !params.blind })}
          >
            Blind Mode
          </button>
          <button
            type="button"
            className="ms-btn tonal small"
            onClick={() => {
              const angle = Math.random() * 2 * Math.PI
              const radius = 0.3 + Math.random() * 0.65
              onChange({ x: +(Math.cos(angle) * radius).toFixed(2), y: +(Math.sin(angle) * radius).toFixed(2) })
            }}
          >
            Randomize
          </button>
          <button
            type="button"
            className="ms-btn tonal small"
            onClick={() => onChange({ x: 0, y: 0 })}
          >
            Reset
          </button>
          <button
            type="button"
            className="ms-btn primary small"
            onClick={onFinalize}
          >
            Finalize
          </button>
        </div>
      </div>
    </div>
  )
}

const VIEW_PAGE = { eq: 'equalizer', spatial: 'spatial', tools: 'audio-tools', hearing: 'hearing-test', abx: 'blind-abx' } as const

/** One saved EQ behind three views: Basic (3-zone shaper / polar radar), Advanced (graphic bands), and Advanced+ (parametric biquad studio). */
export function Equalizer() {
  const { showToast, go } = useShell()
  const slot = useContext(HeaderSlot)
  const swapPage = useContext(SwapPage)
  const paneTitle = slot?.closest('.ms-settings-pane')?.querySelector('.ms-settings-bigtitle')?.textContent?.trim() ?? ''
  const routedTab =
    paneTitle === 'Spatial & Crossfeed'
      ? 'spatial'
      : paneTitle === 'Audio Tools & Diagnostics'
        ? 'tools'
        : paneTitle === 'Hearing Check'
          ? 'hearing'
          : paneTitle === 'Ear-Training & Blind ABX'
            ? 'abx'
            : 'eq'
  const [subView, setSubView] = useState<'eq' | 'spatial' | 'tools' | 'hearing' | 'abx'>(routedTab)
  useEffect(() => {
    setSubView(routedTab)
  }, [routedTab])
  const eq = useEq()
  useSettings()
  const activeGear = getGear().active
  const profile = useGearProfile(activeGear)
  const [db, setDb] = useState<Database | null>(null)
  const [addingDevice, setAddingDevice] = useState(false)
  useEffect(() => {
    let live = true
    void loadDatabase().then((loaded) => live && setDb(loaded), () => {})
    return () => { live = false }
  }, [])

  const isHeadphone = useMemo(() => {
    if (isHeadphoneDevice(activeGear)) return true
    if (!db || !activeGear) return false
    const d = db.catalog.byId.get(activeGear)
    return d ? kindOfIem(d) === 'headphones' : false
  }, [db, activeGear])

  const availableTargets = targetListFor(activeGear, isHeadphone)
  const activeGearName = useMemo(() => {
    if (!activeGear) return 'Default Device'
    return db?.catalog.byId.get(activeGear)?.name ?? activeGear
  }, [activeGear, db])

  const autosave = getSessionAutosave(activeGear)
  const saved = getPresets()
  const [naming, setNaming] = useState<{ was: string | null; name: string } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [presetMenu, setPresetMenu] = useState<{ x: number; y: number } | null>(null)
  const importer = useRef<HTMLInputElement>(null)
  const mine = saved.find((p) => p.name === eq.preset)
  const { on, mode, preset, count, gains, filters: peq } = eq
  const tone = { preamp: eq.preamp, bass: eq.bass, treble: eq.treble, balance: eq.balance }
  const dyn = { headroom: eq.headroom, limiter: eq.limiter, compressor: eq.compressor }

  const onEqTweaked = (patch: Partial<EqState>) => {
    const next = { ...eq, ...patch, preset: 'Custom EQ 1 (Autosaved)' }
    setEq({ ...patch, preset: 'Custom EQ 1 (Autosaved)' })
    setSessionAutosave(activeGear, presetFrom(next, 'Custom EQ 1 (Autosaved)'))
  }

  const finishNaming = () => {
    const name = naming?.name.trim()
    if (!naming || !name) return
    if (PRESETS[name]) { showToast('A built-in preset already has that name'); return }
    const others = naming.was ? saved.filter((p) => p.name !== naming.was) : saved
    setPresets(withPreset(others, presetFrom(eq, name)))
    setEq({ preset: name })
    clearSessionAutosave(activeGear)
    showToast('Preset saved to App')
    setNaming(null)
  }
  const exportPreset = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(presetFrom(eq, eq.preset), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${eq.preset}.eq.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const importPreset = (file: File) => {
    file.text().then((text) => {
      const preset = readPreset(text)
      if (PRESETS[preset.name]) throw new Error('A built-in preset already has that name')
      setPresets(withPreset(saved, preset))
      applySaved(preset)
      showToast(`Added ${preset.name}`)
    }).catch((e: Error) => showToast(e.message))
  }
  const applySaved = (p: (typeof saved)[number]) => setEq({ preset: p.name, mode: p.mode, count: p.count, gains: p.gains, filters: p.filters, preamp: p.preamp, bass: p.bass, treble: p.treble })
  const setTone = (t: typeof tone) => setEq(t)
  const setDyn = (d: typeof dyn) => setEq(d)
  const bands = BANDS[count]

  const applyPreset = (name: string) => {
    if (name === 'Flat' && autosave) {
      setResetting(true)
      return
    }
    setEq({ preset: name, count: 10, gains: PRESETS[name], mode: 'advanced' })
  }
  const setMode = (next: 'basic' | 'advanced' | 'advanced+') => {
    // the sound comes along in every direction (§81 E); a flat mode, or one that already matches, changes nothing
    const carried = carryOver(eq, next)
    setEq({ mode: next, ...carried })
    if (carried) showToast(`Your sound carried over to ${next === 'basic' ? 'Basic (simplified)' : next === 'advanced' ? 'Advanced' : 'Advanced +'}`)
  }
  const points = useMemo(() => {
    if (mode === 'advanced') return bands.map((hz, i) => ({ x: hzToX(hz), y: dbToY(gains[i] ?? 0) }))
    if (mode === 'advanced+') return peq.map((f) => ({ x: hzToX(f.fc), y: dbToY(f.gain) }))
    return []
  }, [mode, bands, gains, peq])
  const { line, peak } = useMemo(() => {
    const hz = Array.from({ length: 200 }, (_, i) => 20 * 1000 ** (i / 199))
    const db = chainDb(eqFilters(eq), hz, 48000)
    return { line: hz.map((f, i) => `${hzToX(f)},${dbToY(db[i])}`).join(' '), peak: Math.max(0, ...db) }
  }, [eq])
  // L/R view (§78 E5): with per-band balance on, each ear's curve is the EQ plus that ear's band corrections
  const channels = useChannels()
  const earLines = useMemo(() => {
    const curves = bandCurves(channels)
    if (!curves) return null
    const hz = Array.from({ length: 200 }, (_, i) => 20 * 1000 ** (i / 199))
    const base = chainDb(on ? eqFilters(eq) : [], hz, 48000)
    const ear = (gains: number[]) => {
      const db = chainDb(BALANCE_BANDS.map((fc, i) => ({ kind: 'peak' as const, fc, gain: gains[i], q: 1 })), hz, 48000)
      return hz.map((f, i) => `${hzToX(f)},${dbToY(base[i] + db[i])}`).join(' ')
    }
    return { left: ear(curves.left), right: ear(curves.right) }
  }, [channels, eq, on])

  const pick = (view: typeof subView) => (swapPage ? swapPage(VIEW_PAGE[view]) : setSubView(view))
  const navBar = (
    <div className="ms-chips" style={{ marginBottom: 14 }} role="tablist" aria-label="Audio & Diagnostics views">
      <Chip label="Equalizer & Sound" selected={subView === 'eq'} onClick={() => pick('eq')} />
      <Chip label="Spatial & Crossfeed" selected={subView === 'spatial'} onClick={() => pick('spatial')} />
      <Chip label="Audio Tools & Guides" selected={subView === 'tools'} onClick={() => pick('tools')} />
      <Chip label="Hearing Check" selected={subView === 'hearing'} onClick={() => pick('hearing')} />
      <Chip label="Ear-Training & ABX" selected={subView === 'abx'} onClick={() => pick('abx')} />
    </div>
  )

  if (subView === 'spatial') {
    return (
      <div className="ms-eq">
        {navBar}
        <SpatialCrossfeedSection />
      </div>
    )
  }
  if (subView === 'tools') {
    return (
      <div className="ms-eq">
        {navBar}
        <AudioToolsPage />
      </div>
    )
  }
  if (subView === 'hearing') {
    return (
      <div className="ms-eq">
        {navBar}
        <HearingTestPage />
      </div>
    )
  }
  if (subView === 'abx') {
    return (
      <div className="ms-eq">
        {navBar}
        <BlindAbxPage />
      </div>
    )
  }

  const basicSubMode = eq.subMode ?? 'shaper'

  return (
    <div className="ms-eq">
      {navBar}
      <div className={`ms-eq-hero${on ? ' on' : ''}`}>
        <div className="ms-eq-head">
          <div className="grow">
            <h3>{preset}</h3>
            <p>
              <em className="ms-set-badge">{mode === 'basic' ? (basicSubMode === 'shaper' ? '3-Zone' : 'Radar') : mode === 'advanced' ? `${count} bands` : `${peq.length} filters`}</em>
              {' '}· Preamp {tone.preamp.toFixed(1)} dB
            </p>
          </div>
          <input type="checkbox" role="switch" aria-label="Equalizer" className="ms-switch" checked={on} onChange={(e) => setEq({ on: e.target.checked })} />
        </div>
        <div className="ms-eq-curve" aria-hidden="true">
          <span className="db" style={{ top: '10%' }}>+12</span>
          <span className="db" style={{ top: '50%' }}>0</span>
          <span className="db" style={{ top: '90%' }}>-12</span>
          <div className="plot">
            <svg viewBox="0 0 1000 120" preserveAspectRatio="none">
              <defs>
                <linearGradient id="eq-spec-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
                  <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
                </linearGradient>
              </defs>
              {/* Vertical spectrum analyzer bars matching Image 1 */}
              {Array.from({ length: 48 }, (_, i) => {
                const bx = (i / 48) * 1000
                const bw = 12
                const factor = Math.sin((i / 48) * Math.PI) * 0.4 + 0.35 + Math.cos((i / 16) * Math.PI) * 0.15
                const bh = Math.max(12, Math.min(108, factor * 110))
                const by = 120 - bh
                return (
                  <rect
                    key={i}
                    x={bx + 2}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={2}
                    fill="url(#eq-spec-grad)"
                    opacity={on ? 0.75 : 0.25}
                  />
                )
              })}
              {[12, -12].map((db) => <line key={db} x1="0" x2="1000" y1={dbToY(db)} y2={dbToY(db)} stroke="rgba(255, 255, 255, 0.1)" />)}
              {[100, 1000, 10000].map((hz) => <line key={hz} x1={hzToX(hz)} x2={hzToX(hz)} y1="0" y2="120" stroke="rgba(255, 255, 255, 0.1)" />)}
              <polyline points={line} />
              {earLines && <polyline className="ear-l" points={earLines.left} />}
              {earLines && <polyline className="ear-r" points={earLines.right} />}
            </svg>
            {points.map((p, i) => <i key={i} style={{ left: `${p.x / 10}%`, top: `${(p.y / 120) * 100}%` }} />)}
            {[100, 1000, 10000].map((hz) => <span key={hz} className="hz" style={{ left: `${hzToX(hz) / 10}%` }}>{freq(hz)}</span>)}
          </div>
        </div>
        <small>EQ curve{earLines && <span className="ms-eq-ears"><b className="l">L</b><b className="r">R</b></span>}</small>
      </div>

      <div className="ms-segment-small big ms-eq-mode" role="radiogroup" aria-label="Equalizer mode">
        {(['basic', 'advanced', 'advanced+'] as const).map((m) => (
          <button
            type="button"
            key={m}
            role="radio"
            aria-checked={m === mode}
            className={m === mode ? 'on' : ''}
            onClick={() => setMode(m)}
          >
            {m === 'basic' ? 'Basic' : m === 'advanced' ? 'Advanced' : 'Advanced +'}
          </button>
        ))}
      </div>

      {mode === 'basic' && (
        <section className="ms-set-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ padding: 0 }}>Sound Shaper</h3>
            <div className="ms-segment-small" role="radiogroup" aria-label="Basic tuning mode">
              <button
                type="button"
                className={basicSubMode === 'shaper' ? 'on' : ''}
                onClick={() => setEq({ subMode: 'shaper' })}
              >
                3-Zone Shaper
              </button>
              <button
                type="button"
                className={basicSubMode === 'polar' ? 'on' : ''}
                onClick={() => setEq({ subMode: 'polar' })}
              >
                Blind Taste Radar
              </button>
            </div>
          </div>

          {basicSubMode === 'shaper' ? (
            <EqShaperPads
              params={eq.shaper ?? DEFAULT_SHAPER}
              onChange={(shaperPatch) =>
                onEqTweaked({
                  shaper: { ...(eq.shaper ?? DEFAULT_SHAPER), ...shaperPatch },
                })
              }
            />
          ) : (
            <EqPolarRadar
              params={eq.polar ?? DEFAULT_POLAR}
              onChange={(polarPatch) =>
                onEqTweaked({
                  polar: { ...(eq.polar ?? DEFAULT_POLAR), ...polarPatch },
                })
              }
              onFinalize={() => {
                showToast('Taste curve finalized & applied as active EQ profile!')
                onEqTweaked({ preset: 'Finalized Taste' })
              }}
            />
          )}
        </section>
      )}

      {mode === 'advanced' && (
        <section className="ms-set-section">
          <h3>Bands</h3>
          <div className="ms-eq-bands ms-set-group">
            <div className="ms-segment-small big" role="radiogroup" aria-label="Number of bands">
              {[5, 10, 15, 31].map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={n === count}
                  className={n === count ? 'on' : ''}
                  onClick={() => setEq({ count: n, gains: BANDS[n].map(() => 0), preset: 'Flat' })}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className={`ms-eq-row${count >= 31 ? ' dense' : ''}`}>
              {bands.map((hz, i) => (
                <label className="ms-eq-band" key={hz}>
                  <span>{(gains[i] ?? 0).toFixed(1)}</span>
                  <span className="ms-vslider" style={{ '--pct': `${(((gains[i] ?? 0) + 12) / 24) * 100}%` } as React.CSSProperties}>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={gains[i] ?? 0}
                      aria-label={`${freq(hz)} Hz`}
                      onChange={(e) => {
                        const next = [...gains]
                        next[i] = Number(e.target.value)
                        onEqTweaked({ gains: next })
                      }}
                    />
                  </span>
                  <span>{freq(hz)}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {mode === 'advanced+' && (
        <section className="ms-set-section ms-eq-advanced">
          <h3>Parametric Filters</h3>
          <PeqEditor
            filters={peq.length ? peq : DEFAULT_PEQ_FILTERS}
            sampleRate={48000}
            onChange={(filters) => onEqTweaked({ filters })}
          />
        </section>
      )}

      {/* Target Preferences & Devices to Test Selection */}
      <section className="ms-set-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ padding: 0 }}>Target Preferences &amp; Devices to Test</h3>
          <small style={{ color: 'var(--text-dim)' }}>Configured for: <b>{activeGearName}</b></small>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>
          Choose which reference targets and test devices appear in your circle quick-palette. Clicking a target toggles it on or off.
        </p>

        {/* Target selection chips */}
        <div style={{ marginBottom: 12 }}>
          <b style={{ fontSize: 13, color: 'var(--text-strong)', display: 'block', marginBottom: 6 }}>
            {isSpeakerDevice(activeGear) ? 'In-Room Reference Targets:' : isHeadphone ? 'Over-Ear Reference Targets:' : 'In-Ear Reference Targets:'}
          </b>
          <div className="ms-chips" style={{ flexWrap: 'wrap', gap: 8 }}>
            {availableTargets.map((t) => {
              const selected = profile.items.some((i) => i.id === t.id)
              return (
                <button
                  type="button"
                  key={t.id}
                  className={`ms-chip${selected ? ' on' : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px', borderRadius: 18 }}
                  onClick={() => {
                    toggleProfileTarget(t, activeGear)
                    showToast(selected ? `Removed ${t.name} from quick-palette` : `Added ${t.name} to quick-palette`)
                  }}
                >
                  <span className="ms-gear-circle-dot" style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: t.color, display: 'inline-block' }} />
                  <span>{t.name}</span>
                  {selected && <Icon name="check" size={16} />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Devices to Test section */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginTop: 14 }}>
          <b style={{ fontSize: 13, color: 'var(--text-strong)' }}>
            Devices to Test ({profile.items.filter((i) => i.kind === 'device').length})
          </b>
          <button
            type="button"
            className="ms-btn text small"
            onClick={() => setAddingDevice(true)}
          >
            <Icon name="add" size={16} /> Add Device to Test
          </button>
        </div>

        {profile.items.filter((i) => i.kind === 'device').length > 0 ? (
          <div className="ms-chips" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {profile.items.filter((i) => i.kind === 'device').map((d) => (
              <span
                key={d.id}
                className="ms-chip selected"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 8px 0 12px', borderRadius: 17 }}
              >
                <span className="ms-gear-circle-dot" style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: d.color, display: 'inline-block' }} />
                <span>{d.name} ({d.strength}%)</span>
                <IconButton
                  icon="close"
                  label="Remove"
                  small
                  onClick={() => {
                    removeProfileItem(d.id, activeGear)
                    showToast(`Removed ${d.name}`)
                  }}
                />
              </span>
            ))}
          </div>
        ) : (
          <small style={{ display: 'block', color: 'var(--text-dim)', marginBottom: 8 }}>
            No test devices added yet. Tap 'Add Device to Test' to audition headphones or IEMs.
          </small>
        )}

        {profile.items.length === 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Icon name="info" size={18} />
            <span>Raw audio with no changes (no targets or test devices selected).</span>
          </div>
        )}
      </section>

      <section className="ms-set-section">
        <h3>Presets</h3>
        <div className="ms-chips ms-eq-presets">
          {Object.keys(PRESETS).map((name) => <Chip key={name} label={name} selected={preset === name} onClick={() => applyPreset(name)} />)}
          {saved.map((p) => <Chip key={p.name} label={p.name} selected={preset === p.name} onClick={() => applySaved(p)} />)}
        </div>
        <div className="ms-eq-preset-actions">
          <button type="button" className="ms-btn" onClick={() => setNaming({ was: null, name: '' })}><Icon name="bookmark_add" size={20} /> Save preset</button>
          <button type="button" className="ms-btn tonal" onClick={() => go({ page: 'settings', section: 'saved-eq' })}><Icon name="tune" size={20} /> Manage Saved EQs</button>
          <span className="center">
            <IconButton icon="restart_alt" label="Reset" onClick={() => setResetting(true)} />
            <IconButton icon="more_vert" label="More preset options" onClick={(e) => setPresetMenu({ x: e.clientX, y: e.clientY })} />
          </span>
        </div>
      </section>

      <section className="ms-set-section">
        <h3>Tone &amp; stereo</h3>
        <div className="ms-set-group">
          <ToneRow icon="volume_up" label="Preamp" sub={`Input gain after headroom: ${(tone.preamp - (dyn.headroom ? peak : 0)).toFixed(1)} dB`} value={tone.preamp} unit=" dB" min={-24} max={12} onChange={(preamp) => setTone({ ...tone, preamp })} />
          <ToneRow icon="speaker" label="Bass" value={tone.bass} unit=" dB" min={-12} max={12} onChange={(bass) => setTone({ ...tone, bass })} />
          <ToneRow icon="music_note" label="Treble" value={tone.treble} unit=" dB" min={-12} max={12} onChange={(treble) => setTone({ ...tone, treble })} />
          <ToneRow icon="surround_sound" label="Balance" value={tone.balance} unit="%" min={-100} max={100} digits={0} onChange={(balance) => setTone({ ...tone, balance })} />
        </div>
      </section>

      <section className="ms-set-section">
        <h3>Dynamics</h3>
        <div className="ms-set-group">
          <DynRow icon="download" label="Automatic headroom" sub="Reduce input gain to make room for boosted frequencies." on={dyn.headroom} onChange={(headroom) => setDyn({ ...dyn, headroom })} />
          <DynRow icon="shield" label="Peak limiter" sub="Keep peaks below -0.5 dBFS to reduce clipping." on={dyn.limiter} onChange={(limiter) => setDyn({ ...dyn, limiter })} />
          <DynRow icon="compress" label="Compressor" sub="Reduce the difference between quiet and loud passages." on={dyn.compressor} onChange={(compressor) => setDyn({ ...dyn, compressor })} />
          {dyn.compressor && (
            <>
              <ToneRow icon="vertical_align_center" label="Threshold" value={eq.threshold} unit=" dB" min={-60} max={0} digits={0} onChange={(threshold) => setEq({ threshold })} />
              <ToneRow icon="compress" label="Ratio" value={eq.ratio} unit=":1" min={1} max={20} onChange={(ratio) => setEq({ ratio })} />
              <ToneRow icon="timer" label="Attack" value={eq.attack} unit=" ms" min={1} max={100} digits={0} onChange={(attack) => setEq({ attack })} />
              <ToneRow icon="history" label="Release" value={eq.release} unit=" ms" min={20} max={1000} digits={0} onChange={(release) => setEq({ release })} />
            </>
          )}
        </div>
      </section>

      <input
        ref={importer}
        type="file"
        hidden
        accept=".json"
        aria-label="Import preset"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) importPreset(file)
        }}
      />
      {presetMenu && <Menu x={presetMenu.x} y={presetMenu.y} onClose={() => setPresetMenu(null)} items={[
        { label: 'Import preset', icon: 'file_open', onSelect: () => importer.current?.click() },
        { label: 'Export preset', icon: 'ios_share', onSelect: exportPreset },
        ...(mine ? [
          { label: 'Rename preset', icon: 'edit', onSelect: () => setNaming({ was: mine.name, name: mine.name }) },
          { label: 'Delete preset', icon: 'delete', onSelect: () => { setPresets(saved.filter((p) => p !== mine)); setEq({ preset: 'Custom' }) } },
        ] : []),
      ]} />}
      {naming && (
        <Dialog
          title={naming.was ? 'Rename preset' : 'Save preset'}
          onClose={() => setNaming(null)}
          footer={(
            <>
              <button type="button" className="ms-btn text" onClick={() => setNaming(null)}>Cancel</button>
              <button type="button" className="ms-btn text" onClick={finishNaming}>Save</button>
            </>
          )}
        >
          <input className="ms-input" autoFocus placeholder="Preset name" aria-label="Preset name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') finishNaming() }} />
        </Dialog>
      )}
      {resetting && (
        <Dialog
          title={autosave ? "Save this EQ before it's gone forever?" : 'Reset equalizer?'}
          onClose={() => setResetting(false)}
          footer={(
            <>
              <button type="button" className="ms-btn text" onClick={() => setResetting(false)}>
                Cancel
              </button>
              {autosave && (
                <button
                  type="button"
                  className="ms-btn primary"
                  onClick={() => {
                    setResetting(false)
                    setNaming({ was: null, name: 'Custom EQ 1' })
                  }}
                >
                  Save to App Presets
                </button>
              )}
              <button
                type="button"
                className={`ms-btn text${autosave ? ' danger' : ''}`}
                onClick={() => {
                  clearSessionAutosave(activeGear)
                  setEq({ ...EQ_DEFAULT, on, mode })
                  setResetting(false)
                  showToast('EQ reset to default')
                }}
              >
                {autosave ? 'Discard & Reset' : 'Reset'}
              </button>
            </>
          )}
        >
          <p className="ms-confirm-text">
            {autosave
              ? 'You have unsaved EQ adjustments for this device. Resetting to default will discard them permanently unless saved.'
              : 'Restores a flat curve and the default tone and dynamics. Saved presets are kept.'}
          </p>
        </Dialog>
      )}

      {/* Add Device to Test Dialog */}
      {addingDevice && db && (
        <Dialog title="Add Device to Test" onClose={() => setAddingDevice(false)}>
          <DevicePickerModal
            db={db}
            onPick={(modelId, modelName) => {
              addProfileItem(
                { id: modelId, kind: 'device', name: modelName, strength: 100 },
                activeGear,
              )
              setAddingDevice(false)
              showToast(`Added ${modelName}`)
            }}
          />
        </Dialog>
      )}
    </div>
  )
}

function ToneRow({ icon, label, sub, value, unit, min, max, digits = 1, onChange }: { icon: string; label: string; sub?: string; value: number; unit: string; min: number; max: number; digits?: number; onChange: (v: number) => void }) {
  return (
    <div className="ms-set-row column tone">
      <div className="ms-set-line">
        <Icon name={icon} />
        <span className="grow ms-set-text">{label}{sub && <small>{sub}</small>}</span>
        <span className="ms-value">{value.toFixed(digits)}{unit}</span>
      </div>
      <Slider thick label={label} min={min} max={max} step={digits ? 0.5 : 1} value={value} onChange={onChange} />
    </div>
  )
}

function DynRow({ icon, label, sub, on, onChange }: { icon: string; label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ms-set-row toggle clickable">
      <Icon name={icon} />
      <span className="grow ms-set-text">{label}<small>{sub}</small></span>
      <input type="checkbox" role="switch" className="ms-switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const CACHES: [string, string, string, number, number][] = [
  ['App cache directory', 'HTTP responses, WebView data, and other temporary app data.', 'folder', 112.4, 318],
  ['Temporary directory', 'Temporary files from downloads and audio conversion.', 'timer', 0, 0],
  ['Cover image cache', 'Downloaded album and track cover art. Will re-download when viewed.', 'image', 96.1, 402],
  ['Library cover cache', 'Cover art extracted from local music files. Will re-extract on next scan.', 'library_music', 21, 390],
  ['Audio analysis cache', 'Saved spectrograms and analysis results. Will re-analyze on next open.', 'graphic_eq', 12.3, 16],
  ['Offline motion covers', 'Album videos saved with downloads. Removing them keeps your music files and static covers.', 'video_library', 0, 0],
  ['Explore feed cache', 'Explore tab content (new releases, trending). Will refresh on next visit.', 'explore', 3.2, 4],
  ['Track lookup cache', 'Track ID lookups. Clearing may slow next few searches.', 'memory', 0, 0],
]
const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`)

export function Storage() {
  const { showToast } = useShell()
  const [sizes, setSizes] = useState(CACHES.map((c) => c[3]))
  const total = sizes.reduce((a, b) => a + b, 0)
  const refresh = () => setSizes(CACHES.map((c) => c[3]))
  return (
    <>
      <HeaderActions><IconButton icon="refresh" label="Refresh stats" onClick={refresh} /></HeaderActions>
      <div className="ms-store-top">
        <h3>Cache overview</h3>
        <b>Estimated cache usage: {size(total)}</b>
        <p>Clearing cache will not remove downloaded music files.</p>
        <div className="ms-chips">
          <button type="button" className="ms-btn tonal" onClick={() => setSizes(sizes.map(() => 0))}><Icon name="delete_sweep" size={20} /> Clear all cache</button>
          <button type="button" className="ms-btn outline" onClick={refresh}><Icon name="refresh" size={20} /> Refresh stats</button>
        </div>
      </div>
      <section className="ms-set-section">
        <h3>Cached Data</h3>
        <div className="ms-set-group">
          {CACHES.map(([name, sub, icon, , files], i) => (
            <div className="ms-set-row" key={name}>
              <Icon name={icon} />
              <span className="grow ms-set-text">{name}<small>{sub}</small><small>{sizes[i] ? `${size(sizes[i])} in ${files} files` : 'No cached data'}</small></span>
              <button type="button" className="ms-btn text" onClick={() => setSizes(sizes.map((s, j) => (j === i ? 0 : s)))}>Clear</button>
            </div>
          ))}
        </div>
      </section>
      <section className="ms-set-section">
        <h3>Maintenance</h3>
        <div className="ms-set-group">
          <div className="ms-set-row">
            <Icon name="cleaning_services" />
            <span className="grow ms-set-text">Cleanup unused data<small>Remove orphaned download history and library entries for missing files.</small></span>
            <button type="button" className="ms-btn text" onClick={() => showToast('Nothing to clean up in the sample data')}>Clear</button>
          </div>
        </div>
      </section>
    </>
  )
}

const LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR']

export function Logs() {
  const { showToast } = useShell()
  const [level, setLevel] = useState('ALL')
  const [query, setQuery] = useState('')
  const [auto, setAuto] = useState(true)
  const logs = useLogs()
  const [crash, setCrash] = useState(lastCrash)
  const [levelMenu, setLevelMenu] = useState<{ x: number; y: number } | null>(null)
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null)
  const [metrics, setMetrics] = useState<AppProcessMetric[] | null>(null)
  const [metricsBusy, setMetricsBusy] = useState(false)
  const getMetrics = host()?.appMetrics

  const refreshMetrics = () => {
    if (!getMetrics) return
    setMetricsBusy(true)
    void getMetrics()
      .then((rows) => setMetrics(rows))
      .catch(() => {})
      .finally(() => setMetricsBusy(false))
  }

  useEffect(() => {
    refreshMetrics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMetrics])

  const all = logs
  const rows = all.filter((l) => (level === 'ALL' || l[1] === level) && l.join(' ').toLowerCase().includes(query.toLowerCase()))
  const errors = rows.filter((l) => l[1] === 'ERROR').length
  const totalPrivateMB = metrics ? metrics.reduce((sum, m) => sum + (m.privateMB ?? m.workingSetMB), 0) : 0
  const copy = () => { void navigator.clipboard?.writeText(rows.map((r) => r.join(' ')).join('\n')); showToast('Logs copied to clipboard') }
  const below = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left, y: r.bottom + 4 }
  }
  return (
    <>
      <HeaderActions>
        <IconButton icon="vertical_align_bottom" label={auto ? 'Auto-scroll ON' : 'Auto-scroll OFF'} active={!auto} onClick={() => setAuto(!auto)} />
        <IconButton icon="content_copy" label="Copy logs" onClick={copy} />
        <IconButton icon="more_vert" label="More" onClick={(e) => setMoreMenu(below(e))} />
      </HeaderActions>
      {getMetrics && (
        <section className="ms-set-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>
              PC Process &amp; Memory Breakdown
              {metrics ? ` · ${totalPrivateMB.toFixed(0)} MB Private` : ''}
            </h3>
            <button type="button" className="ms-btn text" disabled={metricsBusy} onClick={refreshMetrics}>
              <Icon name="refresh" size={16} /> {metricsBusy ? 'Updating…' : 'Refresh'}
            </button>
          </div>
          <div className="ms-set-group">
            {(metrics ?? []).map((m) => (
              <div className="ms-set-row" key={m.pid}>
                <Icon name={m.label.includes('Streaming') ? 'wifi_tethering' : m.label.includes('UI') ? 'web' : m.label.includes('Graphics') ? 'memory' : 'developer_board'} />
                <span className="grow ms-set-text">
                  <span className="ms-set-label">{m.label}</span>
                  <small>
                    PID {m.pid} · {m.privateMB != null ? `${m.privateMB} MB Private · ` : ''}{m.workingSetMB} MB Working Set · CPU {m.cpuPercent}%
                  </small>
                </span>
              </div>
            ))}
            <div className="ms-set-row">
              <Icon name="info" />
              <span className="grow ms-set-text">
                <small>
                  Windows Task Manager groups all AVSB subprocesses under &quot;AVSB&quot; due to Windows PE metadata rules. This table shows exact per-subsystem RAM and CPU usage.
                </small>
              </span>
            </div>
          </div>
        </section>
      )}
        {crash && <div className="ms-crash" role="status">
          <Icon name="error" />
          <div className="grow">
            <b>The app previously crashed</b>
            <p>A crash report was saved. Copy it and send it to the developer to help investigate.</p>
            <small>{crash}</small>
            <div className="ms-crash-actions">
              <button type="button" className="ms-btn" onClick={() => { void navigator.clipboard?.writeText(crash); showToast('Report copied to clipboard') }}><Icon name="content_copy" size={20} /> Copy report</button>
              <button type="button" className="ms-btn text" onClick={() => { clearCrash(); setCrash(null) }}>Dismiss</button>
            </div>
          </div>
        </div>}
      <section className="ms-set-section">
        <h3>Filter</h3>
        <div className="ms-log-filter">
          <div className="ms-log-level">
            <Icon name="filter_list" />
            <span className="grow ms-set-text">Level<small>Filter logs by severity</small></span>
            <button type="button" className="ms-log-dropdown" aria-haspopup="menu" onClick={(e) => setLevelMenu(below(e))}><Icon name="arrow_drop_down" size={20} />{level}</button>
          </div>
          <label className="ms-search small"><Icon name="search" /><input placeholder="Search logs..." aria-label="Search logs" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        </div>
      </section>
      <section className="ms-set-section">
        <h3>Entries ({rows.length})</h3>
        {errors > 0 && (
          <div className="ms-issue">
            <b><Icon name="warning" size={20} /> Issue Summary</b>
            <p>Total errors: {errors}</p>
          </div>
        )}
        <div className="ms-log">
          {rows.map((l, i) => (
            <div key={i} className={`ms-log-row ${l[1].toLowerCase()}`}>
              <div><span>{l[0]}</span><b>{l[1]}</b><i>{l[2]}</i></div>
              <p>{l[3]}</p>
            </div>
          ))}
          {!rows.length && <p className="ms-settings-none">No logs match.</p>}
        </div>
      </section>
      {levelMenu && <Menu x={levelMenu.x} y={levelMenu.y} onClose={() => setLevelMenu(null)} items={LEVELS.map((x) => ({ label: x, checked: x === level, onSelect: () => setLevel(x) }))} />}
      {moreMenu && <Menu x={moreMenu.x} y={moreMenu.y} onClose={() => setMoreMenu(null)} items={[
        { label: 'Share logs', icon: 'share', onSelect: () => showToast('Sharing does nothing in this layout build') },
        { label: 'Clear logs', icon: 'delete', onSelect: clearLogs },
      ]} />}
    </>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['Controls', [['Play/Pause', 'Space'], ['Next track', 'Ctrl+Right'], ['Previous track', 'Ctrl+Left'], ['Increase volume', 'Ctrl+Up'], ['Decrease volume', 'Ctrl+Down']]],
  ['Navigation', [['Home', 'Ctrl+1'], ['Library', 'Ctrl+2'], ['Tournament', 'Ctrl+3'], ['Database', 'Ctrl+4'], ['Settings', 'Ctrl+,  ·  Ctrl+5'], ['Search', 'Ctrl+F'], ['Back', 'Ctrl+['], ['Refresh', 'Ctrl+R'], ['Close dialog or page', 'Esc']]],
  ['View', [['Lyrics', 'Ctrl+Shift+L'], ['Up next', 'Ctrl+Shift+U'], ['Mini Player', 'Ctrl+Shift+M'], ['Full screen', 'F11'], ['Borderless', 'Ctrl+Shift+B']]],
]

export function Shortcuts() {
  return (
    <>
      {SHORTCUTS.map(([title, rows]) => (
        <section className="ms-set-section" key={title}>
          <h3>{title}</h3>
          <div className="ms-set-group">
            {rows.map(([label, keys]) => <div className="ms-set-row shortcut" key={label}><span className="grow ms-set-text">{label}</span><kbd>{keys}</kbd></div>)}
          </div>
        </section>
      ))}
    </>
  )
}

/** Whose work the app shows or builds on. One row each: what it is, then who to thank. */
const CREDITS: [icon: string, what: string, who: string][] = [
  ['reviews', 'Rankings and review notes', 'Jay Audio (@jayyaudio) ranking list and videos, Fernanda Gunsan, Crinacle, and the other reviewers named on each device page'],
  ['show_chart', 'Measurements', 'squig.link databases of the reviewers named beside each graph; speakers from spinorama.org'],
  ['tune', 'Target curves', 'Harman, IEF Neutral (Crinacle), JM-1 and the other targets by their authors'],
  ['photo_library', 'Product photos', 'The shops and makers named under each photo (Linsoul, HiFiGo, Audio46, Headphone Zone, Apos and others), with a link to the page it came from'],
  ['hearing', 'Ear-tip guide', 'Fernanda Gunsan and Jay Audio'],
  ['surround_sound', 'Virtual speakers', 'HUTUBS head-related transfer functions, TU Berlin (CC BY 4.0)'],
  ['lyrics', 'Lyrics and song details', 'LRCLIB, MusicBrainz, Cover Art Archive, Deezer and iTunes Search'],
  ['music_note', 'Sound effects and transition videos', 'Sounds by Pixabay creators (Pixabay Content License); videos from Vecteezy. Each one is listed in the source'],
  ['code', 'Built with', 'Electron, Capacitor, React, iroh, FFmpeg, MediaPipe, kuromoji'],
  ['design_services', 'Layout reference', 'Mornye, an open-source music player (LGPL-3.0)'],
  ['gavel', 'Fonts and icons', 'Google Sans Flex (OFL) and Material Symbols (Apache 2.0)'],
]

export function About() {
  return (
    <>
      <section className="ms-set-section">
        <div className="ms-set-group">
          <div className="ms-set-row"><Icon name="info" /><span className="grow ms-set-text">AVSB {version}<small>Free software under the GNU GPL 3.0</small></span></div>
        </div>
      </section>
      <section className="ms-set-section">
        <h3>Credits</h3>
        <div className="ms-set-group">
          {CREDITS.map(([icon, what, who]) => (
            <div className="ms-set-row" key={what}><Icon name={icon} /><span className="grow ms-set-text">{what}<small>{who}</small></span></div>
          ))}
        </div>
      </section>
    </>
  )
}

export { Phone, ConnectToPc, LinkPage } from './LinkPage'
export { DataNetworkSection } from './DataNetworkSection'

/** The Network storage empty state. Adding a connection does nothing in this build. */
export function NetworkEmpty() {
  const { showToast } = useShell()
  const add = () => showToast('Add connection does nothing in this layout build')
  return (
    <>
      <HeaderActions>
        <IconButton icon="add" label="Add connection" onClick={add} />
        <IconButton icon="refresh" label="Refresh" onClick={() => showToast('Nothing to refresh yet')} />
      </HeaderActions>
      <div className="ms-net-empty">
        <span className="tile"><Icon name="dns" size={34} /></span>
        <p>Connect to your NAS or music server and browse its folders. Your sign-in details are stored securely on this device.</p>
        <button type="button" className="ms-btn primary full" onClick={add}><Icon name="add" size={20} /> Add connection</button>
      </div>
    </>
  )
}

interface Provider {
  id: string
  name: string
  sub: string
  icon: string
}

const LYRIC_PROVIDERS: Provider[] = [
  { id: 'lrclib', name: 'LRCLIB', sub: 'Open community database. Asked only when a song has no lyrics of its own', icon: 'public' },
]
const META_PROVIDERS: Provider[] = PROVIDERS

const PRIORITY_TEXT = {
  lyrics: { description: 'Enable, disable and reorder lyrics sources. Providers are tried top-to-bottom until lyrics are found.', saved: 'Lyrics provider order saved' },
  metadata: { description: 'Enable, disable and reorder the sources Look up details asks. For each empty field, the first source with a value wins. Tags in the file always come first.', saved: 'Metadata provider order saved' },
}

/** Lyrics and Metadata Provider Priority. onlineLyrics.ts and metadata.ts read the saved order. */
export function PriorityPage({ kind }: { kind: 'lyrics' | 'metadata' }) {
  const { showToast } = useShell()
  const lyrics = kind === 'lyrics'
  const all = lyrics ? LYRIC_PROVIDERS : META_PROVIDERS
  const savedOrder = (): { enabled?: string[]; disabled?: string[] } => {
    try { return JSON.parse(String(getSetting(`${kind}providers`) ?? '{}')) } catch { return {} }
  }
  const byIds = (ids: string[] | undefined) => (ids ?? []).flatMap((id) => all.filter((p) => p.id === id))
  const [enabled, setEnabled] = useState<Provider[]>(() => {
    const s = savedOrder()
    const off = new Set(s.disabled)
    // providers added since the order was saved go at the end
    return [...byIds(s.enabled), ...all.filter((p) => !s.enabled?.includes(p.id) && !off.has(p.id))]
  })
  const [disabled, setDisabled] = useState<Provider[]>(() => byIds(savedOrder().disabled))
  const [dragging, setDragging] = useState<number | null>(null)
  const [changed, setChanged] = useState(false)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= enabled.length || from === to) return
    const next = [...enabled]
    next.splice(to, 0, next.splice(from, 1)[0])
    setEnabled(next)
    setChanged(true)
  }
  const turnOff = (p: Provider) => {
    if (!lyrics && enabled.filter((x) => x.id !== 'coverart').length === 1 && p.id !== 'coverart') { showToast('Keep MusicBrainz or Deezer on'); return }
    setEnabled(enabled.filter((x) => x !== p))
    setDisabled([p, ...disabled])
    setChanged(true)
  }
  const turnOn = (p: Provider) => {
    setDisabled(disabled.filter((x) => x !== p))
    setEnabled([...enabled, p])
    setChanged(true)
  }

  return (
    <>
      {changed && <HeaderActions><button type="button" className="ms-btn text" onClick={() => { setSetting(`${kind}providers`, JSON.stringify({ enabled: enabled.map((p) => p.id), disabled: disabled.map((p) => p.id) })); setChanged(false); showToast(PRIORITY_TEXT[kind].saved) }}>Save</button></HeaderActions>}
      <p className="ms-priority-text">{PRIORITY_TEXT[kind].description}</p>
      <section className="ms-set-section">
        <h3>Enabled ({enabled.length})</h3>
        <ol className="ms-priority">
          {enabled.map((p, i) => (
            <li
              key={p.id}
              className={`${i === 0 ? 'first' : ''}${dragging === i ? ' dragging' : ''}`}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragging !== null && dragging !== i) { move(dragging, i); setDragging(i) }
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span className="rank">{i + 1}</span>
              <Icon name={p.icon} />
              <span className="grow ms-set-text">{p.name}<small>{p.sub}</small></span>
              <input type="checkbox" role="switch" aria-label={p.name} className="ms-switch" checked onChange={() => turnOff(p)} />
              <button type="button" className="ms-priority-grip" aria-label={`Move ${p.name}. Use the up and down arrow keys.`} onKeyDown={(e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1) }
                if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1) }
              }}><Icon name="drag_handle" /></button>
            </li>
          ))}
        </ol>
      </section>
      {disabled.length > 0 && (
        <section className="ms-set-section">
          <h3>Disabled ({disabled.length})</h3>
          <ul className="ms-priority off">
            {disabled.map((p) => (
              <li key={p.id}>
                <span className="rank" />
                <Icon name={p.icon} />
                <span className="grow ms-set-text">{p.name}<small>{p.sub}</small></span>
                <input type="checkbox" role="switch" aria-label={p.name} className="ms-switch" checked={false} onChange={() => turnOn(p)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** §73.D4 — Theme Mode Scope selector supporting 'gameshow' and 'clean'. */
export function ThemePage() {
  useSettings()
  const scope = resolveStyleScope(getSetting('style'))
  const setScope = (next: ThemeStyleScope) => {
    const label = next === 'gameshow' ? 'Game show' : 'Material'
    setSetting('style', label)
  }
  const options: { id: ThemeStyleScope; title: string; sub: string; icon: string; badge?: string }[] = [
    {
      id: 'gameshow',
      title: 'Game Show / Party',
      sub: 'Full game show stage styling across Home, Library, Tournament, Sidebar, and Player Bar.',
      icon: 'music_note',
      badge: 'Party',
    },
    {
      id: 'clean',
      title: 'Material',
      sub: 'Modern minimalist theme across the entire app.',
      icon: 'palette',
    },
  ]
  return (
    <section className="ms-set-section">
      <h3>Theme Mode Scope</h3>
      <div className="ms-set-group" role="radiogroup" aria-label="Theme Mode Scope">
        {options.map((o) => {
          const on = scope === o.id
          return (
            <button
              type="button"
              key={o.id}
              role="radio"
              aria-checked={on}
              className="ms-set-row clickable"
              onClick={() => setScope(o.id)}
            >
              <Icon name={o.icon} />
              <span className="grow ms-set-text">
                <span className="ms-set-label">
                  {o.title}
                  {o.badge && <em className="ms-set-badge">{o.badge}</em>}
                </span>
                <small>{o.sub}</small>
              </span>
              <span className={`ms-pick-dot${on ? ' on' : ''}`} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function SpatialCrossfeedPage() {
  return <SpatialCrossfeedSection />
}

// ---------- §73.A3 Secondary Audio Diagnostics & Guides ----------

const AUDIOGRAM_FREQS = [125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000] as const
type AudiogramHz = (typeof AUDIOGRAM_FREQS)[number]

interface AudiogramProfile {
  left: Record<AudiogramHz, number>
  right: Record<AudiogramHz, number>
}

const AUDIOGRAM_KEY = 'personal-audiogram-v1'

function defaultAudiogram(): AudiogramProfile {
  const init = () =>
    Object.fromEntries(AUDIOGRAM_FREQS.map((f) => [f, 15])) as Record<AudiogramHz, number>
  return { left: init(), right: init() }
}

function loadAudiogram(): AudiogramProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIOGRAM_KEY) ?? 'null')
    if (raw && raw.left && raw.right) {
      const def = defaultAudiogram()
      for (const f of AUDIOGRAM_FREQS) {
        if (typeof raw.left[f] === 'number') def.left[f] = raw.left[f]
        if (typeof raw.right[f] === 'number') def.right[f] = raw.right[f]
      }
      return def
    }
  } catch {
    // ignore
  }
  return defaultAudiogram()
}

/**
 * §73.A3 — Interactive Multi-Frequency Hearing Check (125 Hz – 16 kHz)
 * generating a visual personal audiogram curve for Left and Right ears.
 */
export function HearingTestPage() {
  const [profile, setProfile] = useState<AudiogramProfile>(loadAudiogram)
  const [ear, setEar] = useState<'left' | 'right'>('left')
  const [activeHz, setActiveHz] = useState<AudiogramHz>(1000)
  const [levelDb, setLevelDb] = useState<number>(() => loadAudiogram().left[1000])
  const [hearingState, setHearingState] = useState(loadHearing)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  const selectFreq = (hz: AudiogramHz, nextEar = ear) => {
    setActiveHz(hz)
    setLevelDb(profile[nextEar][hz])
  }

  const updateThreshold = (hz: AudiogramHz, targetEar: 'left' | 'right', db: number) => {
    const clamped = Math.max(0, Math.min(70, Math.round(db)))
    setLevelDb(clamped)
    const next: AudiogramProfile = {
      left: { ...profile.left },
      right: { ...profile.right },
    }
    next[targetEar][hz] = clamped
    setProfile(next)
    try {
      localStorage.setItem(AUDIOGRAM_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
    // Sync 1k/4k/8k thresholds to legacy hearing state for tournament notes
    if (hz === 1000 || hz === 4000 || hz === 8000) {
      const updated = summarise(
        {
          L: { 1000: -56 + (next.left[1000] / 75) * 48, 4000: -56 + (next.left[4000] / 75) * 48, 8000: -56 + (next.left[8000] / 75) * 48 },
          R: { 1000: -56 + (next.right[1000] / 75) * 48, 4000: -56 + (next.right[4000] / 75) * 48, 8000: -56 + (next.right[8000] / 75) * 48 },
        },
        () => 0,
      )
      setHearingState(updated)
      saveHearing(updated)
    }
  }

  const playCurrent = (hz = activeHz, db = levelDb, targetEar = ear) => {
    stopRef.current?.()
    stopRef.current = playDiagnosticTone({ hz, dbHl: db, ear: targetEar })
  }

  const xOf = (i: number) => 55 + (i / (AUDIOGRAM_FREQS.length - 1)) * 610
  const yOf = (db: number) => 24 + (Math.max(0, Math.min(70, db)) / 70) * 155
  const leftPoints = AUDIOGRAM_FREQS.map((f, i) => `${xOf(i)},${yOf(profile.left[f])}`).join(' ')
  const rightPoints = AUDIOGRAM_FREQS.map((f, i) => `${xOf(i)},${yOf(profile.right[f])}`).join(' ')
  const summary = hearingNote(hearingState)

  return (
    <section className="ms-set-section">
      <div className="ms-cc-card">
        <div className="ms-cc-head">
          <Icon name="hearing" />
          <b className="grow">Hearing check</b>
          <button
            type="button"
            className="ms-btn text"
            onClick={() => {
              const fresh = defaultAudiogram()
              setProfile(fresh)
              setLevelDb(15)
              try { localStorage.removeItem(AUDIOGRAM_KEY) } catch { /* ignore */ }
            }}
          >
            Reset
          </button>
        </div>
        <p className="ms-tz-note tight">Comfortable volume first. Turn each tone down until you can only just hear it.</p>

        {/* Visual Personal Audiogram SVG */}
        <svg className="ms-audiogram-svg" viewBox="0 0 700 210" aria-label="Personal Audiogram Curve">
          {/* Threshold bands: Normal (0-20), Mild (20-40), Moderate (40-70) */}
          <rect x="45" y={yOf(0)} width="630" height={yOf(20) - yOf(0)} fill="rgba(16, 185, 129, 0.08)" />
          <rect x="45" y={yOf(20)} width="630" height={yOf(40) - yOf(20)} fill="rgba(245, 158, 11, 0.08)" />
          <rect x="45" y={yOf(40)} width="630" height={yOf(70) - yOf(40)} fill="rgba(239, 68, 68, 0.08)" />

          {[0, 10, 20, 30, 40, 50, 60, 70].map((db) => (
            <g key={db}>
              <line x1="45" x2="675" y1={yOf(db)} y2={yOf(db)} stroke="currentColor" strokeOpacity="0.12" />
              <text x="38" y={yOf(db) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.65">
                {db} dB
              </text>
            </g>
          ))}

          {AUDIOGRAM_FREQS.map((hz, i) => (
            <g key={hz}>
              <line x1={xOf(i)} x2={xOf(i)} y1="20" y2="182" stroke="currentColor" strokeOpacity={hz === activeHz ? 0.4 : 0.1} strokeDasharray={hz === activeHz ? '3 2' : undefined} />
              <text x={xOf(i)} y="198" textAnchor="middle" fontSize="10" fontWeight={hz === activeHz ? 700 : 400} fill="currentColor" opacity={hz === activeHz ? 1 : 0.7}>
                {hz >= 1000 ? `${hz / 1000}k` : hz}
              </text>
            </g>
          ))}

          {/* Left ear curve (Blue X) */}
          <polyline fill="none" stroke="#4fc3ff" strokeWidth="2.4" points={leftPoints} />
          {AUDIOGRAM_FREQS.map((hz, i) => {
            const cx = xOf(i)
            const cy = yOf(profile.left[hz])
            return (
              <g key={`L-${hz}`} style={{ cursor: 'pointer' }} onClick={() => { setEar('left'); selectFreq(hz, 'left') }}>
                <line x1={cx - 4.5} y1={cy - 4.5} x2={cx + 4.5} y2={cy + 4.5} stroke="#4fc3ff" strokeWidth="2.2" />
                <line x1={cx - 4.5} y1={cy + 4.5} x2={cx + 4.5} y2={cy - 4.5} stroke="#4fc3ff" strokeWidth="2.2" />
              </g>
            )
          })}

          {/* Right ear curve (Red/Coral O) */}
          <polyline fill="none" stroke="#ff5f6d" strokeWidth="2.4" points={rightPoints} />
          {AUDIOGRAM_FREQS.map((hz, i) => (
            <circle
              key={`R-${hz}`}
              cx={xOf(i)}
              cy={yOf(profile.right[hz])}
              r="4.5"
              fill="var(--page)"
              stroke="#ff5f6d"
              strokeWidth="2.2"
              style={{ cursor: 'pointer' }}
              onClick={() => { setEar('right'); selectFreq(hz, 'right') }}
            />
          ))}
        </svg>

        <div className="ms-hc-ears">
          <div className="ms-tz-seg ms-at-seg" role="radiogroup" aria-label="Ear">
            <button type="button" role="radio" aria-checked={ear === 'left'} className={ear === 'left' ? 'on' : ''} onClick={() => { setEar('left'); setLevelDb(profile.left[activeHz]) }}>✕ Left</button>
            <button type="button" role="radio" aria-checked={ear === 'right'} className={ear === 'right' ? 'on' : ''} onClick={() => { setEar('right'); setLevelDb(profile.right[activeHz]) }}>○ Right</button>
          </div>
        </div>

        <div className="ms-chips ms-hc-freqs">
          {AUDIOGRAM_FREQS.map((hz) => (
            <Chip key={hz} label={hz >= 1000 ? `${hz / 1000}k` : String(hz)} selected={activeHz === hz} onClick={() => selectFreq(hz)} />
          ))}
        </div>

        <div className="ms-hc-controls">
          <button type="button" className="ms-btn primary" onClick={() => playCurrent()}>
            <Icon name="volume_up" size={18} /> Play
          </button>
          <IconButton icon="remove" label="Quieter (−5 dB)" onClick={() => { const next = Math.max(0, levelDb - 5); updateThreshold(activeHz, ear, next); playCurrent(activeHz, next, ear) }} />
          <span className="ms-hc-level"><b>{levelDb}</b><small>dB HL</small></span>
          <IconButton icon="add" label="Louder (+5 dB)" onClick={() => { const next = Math.min(70, levelDb + 5); updateThreshold(activeHz, ear, next); playCurrent(activeHz, next, ear) }} />
          <button
            type="button"
            className="ms-btn tonal"
            onClick={() => {
              const idx = AUDIOGRAM_FREQS.indexOf(activeHz)
              if (idx < AUDIOGRAM_FREQS.length - 1) {
                const nextHz = AUDIOGRAM_FREQS[idx + 1]
                selectFreq(nextHz)
                playCurrent(nextHz, profile[ear][nextHz], ear)
              } else if (ear === 'left') {
                setEar('right')
                selectFreq(AUDIOGRAM_FREQS[0], 'right')
              }
            }}
          >
            Next <Icon name="arrow_forward" size={18} />
          </button>
        </div>

        {summary && <p className="ms-tz-note tight">{summary}</p>}
      </div>
    </section>
  )
}

const TRAINING_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000] as const

/**
 * §73.A3 — Ear-Training / ABX Challenges:
 * 1. Frequency Band Boost/Cut Recognition
 * 2. Codec / Filter Blind ABX Test
 */
export function BlindAbxPage() {
  const [tab, setTab] = useState<'band' | 'abx'>('band')
  // Mode 1: Band Boost/Cut state
  const [targetBand, setTargetBand] = useState<number>(() => TRAINING_BANDS[Math.floor(Math.random() * TRAINING_BANDS.length)])
  const [targetSign, setTargetSign] = useState<1 | -1>(() => (Math.random() < 0.5 ? 1 : -1))
  const [guessedBand, setGuessedBand] = useState<number>(1000)
  const [guessedSign, setGuessedSign] = useState<1 | -1>(1)
  const [bandScore, setBandScore] = useState<{ hits: number; total: number; last: string | null }>({ hits: 0, total: 0, last: null })

  // Mode 2: Blind ABX state
  const [secretX, setSecretX] = useState<'A' | 'B'>(() => (Math.random() < 0.5 ? 'A' : 'B'))
  const [abxStats, setAbxStats] = useState<{ correct: number; trials: number; last: string | null }>({ correct: 0, trials: 0, last: null })
  const stopAudioRef = useRef<(() => void) | null>(null)

  useEffect(() => () => { stopAudioRef.current?.() }, [])

  const playBandSample = (withEq: boolean) => {
    stopAudioRef.current?.()
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const sr = ctx.sampleRate
    const dur = 1.4
    const buf = ctx.createBuffer(2, Math.floor(sr * dur), sr)
    // Rich pink-ish harmonic chord + noise reference so every octave has energy
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < d.length; i++) {
        const t = i / sr
        const w = Math.random() * 2 - 1
        b0 = 0.997 * b0 + w * 0.03
        b1 = 0.98 * b1 + w * 0.06
        b2 = 0.92 * b2 + w * 0.1
        const chord =
          Math.sin(2 * Math.PI * 110 * t) * 0.08 +
          Math.sin(2 * Math.PI * 220 * t) * 0.07 +
          Math.sin(2 * Math.PI * 330 * t) * 0.05 +
          Math.sin(2 * Math.PI * 440 * t) * 0.05
        d[i] = (b0 + b1 + b2 + chord) * 0.28
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const eq = ctx.createBiquadFilter()
    eq.type = 'peaking'
    eq.frequency.value = targetBand
    eq.Q.value = 1.6
    eq.gain.value = withEq ? targetSign * 6 : 0
    src.connect(eq).connect(ctx.destination)
    src.start()
    const timer = window.setTimeout(() => void ctx.close().catch(() => {}), dur * 1000 + 80)
    stopAudioRef.current = () => {
      window.clearTimeout(timer)
      void ctx.close().catch(() => {})
    }
  }

  const submitBandGuess = () => {
    const exact = guessedBand === targetBand && guessedSign === targetSign
    const label = `${targetBand >= 1000 ? `${targetBand / 1000} kHz` : `${targetBand} Hz`} (${targetSign > 0 ? '+6 dB Boost' : '−6 dB Cut'})`
    setBandScore((s) => ({
      hits: s.hits + (exact ? 1 : 0),
      total: s.total + 1,
      last: exact ? `Correct! It was ${label}.` : `Actual was ${label}.`,
    }))
    setTargetBand(TRAINING_BANDS[Math.floor(Math.random() * TRAINING_BANDS.length)])
    setTargetSign(Math.random() < 0.5 ? 1 : -1)
  }

  const playAbxChoice = (which: 'A' | 'B' | 'X') => {
    stopAudioRef.current?.()
    const isDegraded = which === 'B' || (which === 'X' && secretX === 'B')
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const sr = ctx.sampleRate
    const dur = 1.5
    const buf = ctx.createBuffer(2, Math.floor(sr * dur), sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < d.length; i++) {
        const t = i / sr
        const hiHat = (Math.random() * 2 - 1) * Math.exp(-((t * 4) % 1) * 9) * 0.14
        const synth =
          Math.sin(2 * Math.PI * 220 * t) * 0.14 +
          Math.sin(2 * Math.PI * 440 * t) * 0.1 +
          Math.sin(2 * Math.PI * 6600 * t) * 0.04 +
          Math.sin(2 * Math.PI * 13500 * t) * 0.035
        let sample = hiHat + synth
        if (isDegraded) {
          // Simulate lossy quantization + brickwall lowpass
          sample = Math.round(sample * 128) / 128
        }
        d[i] = sample
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = isDegraded ? 11500 : 22000
    src.connect(lp).connect(ctx.destination)
    src.start()
    const timer = window.setTimeout(() => void ctx.close().catch(() => {}), dur * 1000 + 80)
    stopAudioRef.current = () => {
      window.clearTimeout(timer)
      void ctx.close().catch(() => {})
    }
  }

  const guessAbx = (choice: 'A' | 'B') => {
    const right = choice === secretX
    setAbxStats((s) => ({
      correct: s.correct + (right ? 1 : 0),
      trials: s.trials + 1,
      last: right ? `Correct! X was ${secretX}.` : `Missed — X was ${secretX}.`,
    }))
    setSecretX(Math.random() < 0.5 ? 'A' : 'B')
  }

  const bandName = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz))
  return (
    <section className="ms-set-section">
      <div className="ms-tz-seg ms-at-seg ms-et-modes" role="tablist" aria-label="Challenge">
        <button type="button" role="tab" aria-selected={tab === 'band'} className={tab === 'band' ? 'on' : ''} onClick={() => setTab('band')}>
          <Icon name="equalizer" size={18} /> Name the band
        </button>
        <button type="button" role="tab" aria-selected={tab === 'abx'} className={tab === 'abx' ? 'on' : ''} onClick={() => setTab('abx')}>
          <Icon name="quiz" size={18} /> Blind ABX
        </button>
      </div>

      {tab === 'band' ? (
        <div className="ms-cc-card">
          <div className="ms-cc-head">
            <Icon name="equalizer" />
            <b className="grow">Which band moved?</b>
            <ScoreRing hits={bandScore.hits} total={bandScore.total} />
          </div>
          <p className="ms-tz-note tight">One band is boosted or cut by 6 dB. Compare, then name it.</p>
          <div className="ms-et-play">
            <button type="button" onClick={() => playBandSample(false)}><Icon name="volume_up" /><b>Flat</b></button>
            <button type="button" className="mystery" onClick={() => playBandSample(true)}><Icon name="help" /><b>Mystery</b></button>
          </div>
          <div className="ms-chips ms-hc-freqs">
            {TRAINING_BANDS.map((hz) => (
              <Chip key={hz} label={bandName(hz)} selected={guessedBand === hz} onClick={() => setGuessedBand(hz)} />
            ))}
          </div>
          <div className="ms-cc-actions">
            <div className="ms-tz-seg" role="radiogroup" aria-label="Boost or cut">
              <button type="button" role="radio" aria-checked={guessedSign === 1} className={guessedSign === 1 ? 'on' : ''} onClick={() => setGuessedSign(1)}>Boost</button>
              <button type="button" role="radio" aria-checked={guessedSign === -1} className={guessedSign === -1 ? 'on' : ''} onClick={() => setGuessedSign(-1)}>Cut</button>
            </div>
            <span className="grow" />
            <button type="button" className="ms-btn primary" onClick={submitBandGuess}>Answer</button>
          </div>
          {bandScore.last && <p className="ms-tz-note tight">{bandScore.last}</p>}
        </div>
      ) : (
        <div className="ms-cc-card">
          <div className="ms-cc-head">
            <Icon name="quiz" />
            <b className="grow">Is X the lossless one?</b>
            <ScoreRing hits={abxStats.correct} total={abxStats.trials} />
          </div>
          <p className="ms-tz-note tight">A is lossless, B is filtered and coarser, X is one of them.</p>
          <div className="ms-cc-ears ms-at-ears ms-et-abx">
            <button type="button" onClick={() => playAbxChoice('A')}>A</button>
            <button type="button" className="on" onClick={() => playAbxChoice('X')}>X</button>
            <button type="button" onClick={() => playAbxChoice('B')}>B</button>
          </div>
          <div className="ms-at-row">
            <button type="button" className="ms-btn tonal" onClick={() => guessAbx('A')}>X is A</button>
            <button type="button" className="ms-btn tonal" onClick={() => guessAbx('B')}>X is B</button>
          </div>
          {abxStats.last && <p className="ms-tz-note tight">{abxStats.last}</p>}
        </div>
      )}
    </section>
  )
}

/** A score as a ring that fills with the share right, the count inside. */
function ScoreRing({ hits, total }: { hits: number; total: number }) {
  const share = total ? hits / total : 0
  const c = 2 * Math.PI * 18
  return (
    <span className="ms-et-ring" aria-label={`${hits} of ${total} right`}>
      <svg viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="18" />
        {hits > 0 && <circle cx="22" cy="22" r="18" className="fill" strokeDasharray={`${share * c} ${c}`} />}
      </svg>
      <b>{hits}/{total}</b>
    </span>
  )
}

// Settings → Equalizer → Sound (§68) & Spatial / Crossfeed (§73.A1):
// What you listen on, what to make it sound like (target or another device), plus
// Crossfeed (CanOpener-style) and Virtual Speakers & HRTF (room/speaker stage, SOFA HRTF profiles,
// Head Size ITD scaling, Ear Canal Resonance compensation, and Head Tracking).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../ui'
import { Slider } from '../PlayerBar'
import { useDatabase } from '../database/DatabasePage'
import { listModels, type Database } from '../database/catalog'
import { imgUrl } from '../../reviews/reviews'
import { airMode } from '../../audio/filter'
import { loadFit } from '../../fit/fit'
import { kindOfIem, type CatalogKind } from '../../data/catalog'
import { DEFAULT_TARGET } from '../../gallery/gallery'
import { useRefs } from '../tournament/engine'
import { engineForTests, engineSampleRate } from '../engine'
import { kindDetail } from '../tournament/kinds'
import { familyOf, linearLatencyMs, soundCurve, targetsFor, type SoundResult } from './soundCurve'
import { setSound, useSound } from './soundState'
import { setActive } from './gear'
import { useShell } from '../context'
import {
  DEFAULT_SPATIAL,
  loadSpatial,
  onSpatialChange,
  updateSpatial,
  XF_AMOUNT_RANGE,
  XF_ANGLE_RANGE,
} from '../../spatial/settings'
import { crossfeedParams } from '../../spatial/stage'
import { forgetHrirSet, loadHrirIndex, type HrirIndexEntry } from '../../spatial/hrir'
import { deleteStoredHrir, IMPORTED_ID, loadStoredHrir, saveStoredHrir } from '../../spatial/hrirStore'
import { importSofa } from '../../spatial/sofa'
import { AVERAGE_HEAD_CM, HEAD_CM_MAX, HEAD_CM_MIN } from '../../spatial/headSize'
import { loadEarCorrection } from '../../spatial/earCorrection'
import { HrtfPicker } from '../../spatial/hrtfPicker'
import { calibrateEarbuds, followHeadTracking, recenterHeadTracking, useHeadTracking } from '../../headtrack/driver'
import { isAndroid } from '../../platform'
import type { HeadTracking, SpatialMode, SpatialSettings } from '../../spatial/types'
import type { Biquad } from '../../eq/biquad'

const KINDS = new Set(['iems', 'tws', 'headphones'] as const)
// what you listen on can also be speakers or a soundbar (§78 B); they sound like each other only (§80 E)
const LISTEN_KINDS = new Set(['iems', 'tws', 'headphones', 'speakers', 'soundbar'] as const)
const ROOM_KINDS = new Set(['speakers', 'soundbar'] as const)

const SPATIAL_MODE_OPTS: readonly { mode: SpatialMode; label: string; hint: string }[] = [
  { mode: 'off', label: 'Off', hint: 'Standard headphone stereo' },
  { mode: 'crossfeed', label: 'Crossfeed', hint: 'CanOpener natural stereo blend' },
  { mode: 'speakers', label: 'Speakers', hint: 'Nearfield ±30° studio monitors' },
  { mode: 'room', label: 'Room Stage', hint: 'Speakers in an acoustic listening room' },
]

const XF_PRESETS: readonly { label: string; amount: number; angle: number; cutHz: number }[] = [
  { label: 'Default', amount: 100, angle: 30, cutHz: 700 },
  { label: 'Mix engineer', amount: 80, angle: 30, cutHz: 650 },
  { label: 'Lifelike', amount: 125, angle: 45, cutHz: 750 },
  { label: 'Old stereo', amount: 140, angle: 60, cutHz: 900 },
]

const STAGE_PRESETS: readonly { id: string; label: string; mode: SpatialMode; angleDeg: number; distanceM: number; note: string }[] = [
  { id: 'nearfield', label: 'Nearfield Studio (±30°, 1.2 m)', mode: 'speakers', angleDeg: 30, distanceM: 1.2, note: 'Dry studio monitors in an equilateral triangle' },
  { id: 'living', label: 'Living Room (±30°, 2.4 m)', mode: 'room', angleDeg: 30, distanceM: 2.4, note: 'Warm early reflections and natural 0.3 s room tail' },
  { id: 'wide', label: 'Wide Reference Stage (±45°, 3.0 m)', mode: 'room', angleDeg: 45, distanceM: 3.0, note: 'Wider speaker separation with deeper front stage' },
]

const EAR_RESONANCE_KEY = 'spatial-ear-resonance-pct-v1'
const XF_CUT_KEY = 'spatial-xf-cut-hz-v1'
const STAGE_PRESET_KEY = 'spatial-stage-preset-v1'

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = Number(localStorage.getItem(key))
    return Number.isFinite(raw) && raw > 0 ? raw : fallback
  } catch {
    return fallback
  }
}

function DevicePicker({ db, label, onPick, kinds = KINDS }: { db: Database; label: string; onPick: (id: string) => void; kinds?: ReadonlySet<CatalogKind> }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => (query ? listModels(db.models, { query, kinds: new Set(kinds), reviewedOnly: false, sort: 'name' }).slice(0, 8) : []), [db, query, kinds])
  return (
    <>
      <label className="ms-search">
        <Icon name="search" />
        <input placeholder={!kinds.has('iems') ? 'Search speakers or soundbars' : kinds.has('speakers') ? 'Search IEMs, headphones or speakers' : 'Search IEMs, TWS or headphones'} aria-label={label} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {matches.length > 0 && (
        <div className="ms-tz-list">
          {matches.map((m) => {
            const img = m.photoId ? db.catalog.images[m.photoId] : null
            return (
              <button type="button" key={m.id} className="ms-tz-row" onClick={() => { onPick(m.id); setQuery('') }}>
                <span className="ms-tz-photo">{img ? <img src={imgUrl(img.src)} alt="" /> : <Icon name="headphones" />}</span>
                <span className="grow">{m.name}</span>
                <small>{kindDetail(m.kind, m.members[0].back)}</small>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Device, aim and result on one small graph (dB, levelled at 300 Hz–3 kHz). */
function SoundGraph({ grid, r }: { grid: ArrayLike<number>; r: SoundResult }) {
  const x = (hz: number) => (Math.log(hz / 20) / Math.log(1000)) * 1000
  const lines = useMemo(() => {
    const mid = Array.from(grid).flatMap((f, i) => (f >= 300 && f <= 3000 ? [i] : []))
    const level = (c: ArrayLike<number>) => mid.reduce((s, i) => s + c[i], 0) / mid.length
    const path = (c: ArrayLike<number>) => {
      const l = level(c)
      return Array.from(grid).map((f, i) => `${x(f).toFixed(1)},${(60 - (c[i] - l) * 3).toFixed(1)}`).join(' ')
    }
    const heard = r.curve ? r.reference.map((v, i) => v + r.curve![i]) : r.reference
    return { device: path(r.reference), aim: r.aim ? path(r.aim) : null, heard: path(heard) }
  }, [grid, r])
  return (
    <div className="ms-snd-graph">
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
        {[100, 1000, 10000].map((hz) => <line key={hz} x1={x(hz)} x2={x(hz)} y1="0" y2="120" />)}
        <line x1="0" x2="1000" y1="60" y2="60" />
        <polyline className="device" points={lines.device} />
        {lines.aim && <polyline className="aim" points={lines.aim} />}
        <polyline className="heard" points={lines.heard} />
      </svg>
      <div className="ms-snd-legend"><span className="device">Your device</span>{lines.aim && <span className="aim">Aim</span>}<span className="heard">What you'll hear</span></div>
    </div>
  )
}

/**
 * §73.A1 — Dedicated Spatial & Crossfeed section with CanOpener-style Crossfeed,
 * Virtual Speaker Stage & Room reflections, SOFA HRTF selector + custom .sofa upload,
 * Head Size (cm / ITD scale), Ear Canal Resonance compensation, and Camera Head Tracking.
 */
export function SpatialCrossfeedSection() {
  const [spatial, setSpatialState] = useState<SpatialSettings>(() => loadSpatial())
  const [hrirList, setHrirList] = useState<HrirIndexEntry[]>([])
  const [importedName, setImportedName] = useState<string | null>(null)
  const [sofaBusy, setSofaBusy] = useState(false)
  const [sofaError, setSofaError] = useState<string | null>(null)
  const [pickingHrtf, setPickingHrtf] = useState(false)
  const [xfCutHz, setXfCutHz] = useState<number>(() => readStoredNumber(XF_CUT_KEY, 700))
  const [earResonancePct, setEarResonancePct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(EAR_RESONANCE_KEY)
      return raw !== null ? Number(raw) : 100
    } catch {
      return 100
    }
  })
  const [stagePreset, setStagePreset] = useState<string>(() => {
    try {
      return localStorage.getItem(STAGE_PRESET_KEY) ?? 'nearfield'
    } catch {
      return 'nearfield'
    }
  })
  const baseEarFiltersRef = useRef<Biquad[] | null>(null)
  const sofaInputRef = useRef<HTMLInputElement | null>(null)
  const trackState = useHeadTracking()
  const [nodMsg, setNodMsg] = useState<string | null>(null)
  const camKind: HeadTracking = isAndroid() ? 'phone-camera' : 'webcam'

  useEffect(() => onSpatialChange(setSpatialState), [])

  useEffect(() => {
    let alive = true
    loadHrirIndex()
      .then((list) => {
        if (alive) setHrirList(list)
      })
      .catch(() => {})
    loadStoredHrir(IMPORTED_ID)
      .then((s) => {
        if (alive) setImportedName(s?.name ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Wire head tracking yaw into the live shell player's SpatialStage
  useEffect(() => {
    return followHeadTracking(() => {
      const st = engineForTests().player?.spatial
      return st ? [st] : []
    })
  }, [])

  // Wire Ear Canal Resonance compensation scaling into the live SpatialStage
  useEffect(() => {
    let alive = true
    void loadEarCorrection().then((filters) => {
      if (!alive || !filters) return
      baseEarFiltersRef.current = filters
      const scale = earResonancePct / 100
      const scaled = filters.map((f) => ({ ...f, gain: f.gain * scale }))
      engineForTests().player?.spatial?.setEarCorrection(scaled)
    })
    return () => {
      alive = false
    }
  }, [earResonancePct])

  const crossfeedOn = spatial.mode === 'crossfeed'
  const speakersOn = spatial.mode === 'speakers' || spatial.mode === 'room'
  const xfAmount = spatial.xfAmount ?? DEFAULT_SPATIAL.xfAmount
  const xfAngle = spatial.xfAngle ?? DEFAULT_SPATIAL.xfAngle
  const xfParams = crossfeedParams(xfAmount, xfAngle)
  const delayUs = xfParams ? Math.round((xfParams.delayS + 1 / (2 * Math.PI * xfCutHz)) * 1e6) : 0
  const headCm = spatial.headCm ?? AVERAGE_HEAD_CM
  const itdPct = Math.round((headCm / AVERAGE_HEAD_CM) * 100)

  const handleSofaUpload = async (file: File) => {
    setSofaBusy(true)
    setSofaError(null)
    try {
      const set = await importSofa(file)
      await saveStoredHrir(set)
      forgetHrirSet(IMPORTED_ID)
      setImportedName(set.name)
      updateSpatial({ hrirId: IMPORTED_ID, mode: spatial.mode === 'off' ? 'speakers' : spatial.mode })
    } catch (e) {
      setSofaError(e instanceof Error ? e.message : String(e))
    } finally {
      setSofaBusy(false)
    }
  }

  const handleRemoveSofa = async () => {
    await deleteStoredHrir(IMPORTED_ID).catch(() => {})
    forgetHrirSet(IMPORTED_ID)
    setImportedName(null)
    if (spatial.hrirId === IMPORTED_ID) {
      updateSpatial({ hrirId: DEFAULT_SPATIAL.hrirId })
    }
  }

  return (
    <section className={`ms-snd spatial${spatial.mode !== 'off' ? ' on' : ''}`}>
      <div className="ms-snd-head">
        <Icon name="surround_sound" />
        <div className="grow">
          <h3>Spatial &amp; Crossfeed</h3>
          <p>Out-of-head stereo crossfeed, virtual speaker room stage, SOFA HRTF profiles, and head tracking.</p>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="ms-snd-row">
        <small>Spatial stage mode</small>
        <div className="ms-tz-seg" role="radiogroup" aria-label="Spatial stage mode">
          {SPATIAL_MODE_OPTS.map((m) => (
            <button
              type="button"
              key={m.mode}
              role="radio"
              aria-checked={spatial.mode === m.mode}
              className={spatial.mode === m.mode ? 'on' : ''}
              onClick={() => updateSpatial({ mode: m.mode })}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Crossfeed (CanOpener-style) */}
      <div className="ms-snd-row ms-snd-part">
        <div className="ms-snd-switchline">
          <div>
            <b>Crossfeed (CanOpener-style)</b>
            <p className="ms-tz-note tight">
              Blends a delayed, low-passed signal into the opposite ear so hard-panned stereo sounds natural on headphones.
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable Crossfeed"
            className="ms-switch"
            checked={crossfeedOn}
            onChange={(e) => updateSpatial({ mode: e.target.checked ? 'crossfeed' : 'off' })}
          />
        </div>

        <div className="ms-tz-seg" role="group" aria-label="Crossfeed presets">
          {XF_PRESETS.map((p) => {
            const active = crossfeedOn && xfAmount === p.amount && xfAngle === p.angle
            return (
              <button
                type="button"
                key={p.label}
                className={active ? 'on' : ''}
                onClick={() => {
                  setXfCutHz(p.cutHz)
                  try { localStorage.setItem(XF_CUT_KEY, String(p.cutHz)) } catch { /* ignore */ }
                  updateSpatial({ mode: 'crossfeed', xfAmount: p.amount, xfAngle: p.angle })
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="ms-snd-grid">
          <div className="ms-snd-row">
            <small>
              Crossfeed strength / feed level{' '}
              <b>{xfAmount}%{xfParams ? ` (−${xfParams.feedDb.toFixed(1)} dB feed)` : ' (Off)'}</b>
            </small>
            <Slider thick
              min={XF_AMOUNT_RANGE[0]}
              max={XF_AMOUNT_RANGE[1]}
              step={5}
              value={xfAmount}
              label="Crossfeed strength"
              onChange={(v) => updateSpatial({ mode: 'crossfeed', xfAmount: v })}
            />
          </div>
          <div className="ms-snd-row">
            <small>
              Speaker angle &amp; ITD delay <b>±{xfAngle}° ({delayUs} µs ITD)</b>
            </small>
            <Slider thick
              min={XF_ANGLE_RANGE[0]}
              max={XF_ANGLE_RANGE[1]}
              step={5}
              value={xfAngle}
              label="Crossfeed speaker angle"
              onChange={(v) => updateSpatial({ mode: 'crossfeed', xfAngle: v })}
            />
          </div>
        </div>

        <div className="ms-snd-row">
          <small>
            Low-pass cutoff frequency <b>{xfCutHz} Hz</b> (head-shadow shelf transition)
          </small>
          <Slider thick
            min={400}
            max={1400}
            step={25}
            value={xfCutHz}
            label="Crossfeed cutoff frequency"
            onChange={(v) => {
              const hz = v
              setXfCutHz(hz)
              try { localStorage.setItem(XF_CUT_KEY, String(hz)) } catch { /* ignore */ }
              if (!crossfeedOn) updateSpatial({ mode: 'crossfeed' })
            }}
          />
        </div>
      </div>

      {/* 2. Virtual Speakers & HRTF */}
      <div className="ms-snd-row ms-snd-part">
        <div className="ms-snd-switchline">
          <div>
            <b>Virtual Speaker Stage &amp; HRTF</b>
            <p className="ms-tz-note tight">
              Binaural HRIR convolution placing virtual studio monitors in front of you with optional room acoustics.
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable Virtual Speaker Stage"
            className="ms-switch"
            checked={speakersOn}
            onChange={(e) => updateSpatial({ mode: e.target.checked ? 'speakers' : 'off' })}
          />
        </div>

        {/* Room / Speaker angle & distance presets */}
        <div className="ms-snd-row">
          <small>Room / speaker angle &amp; distance preset</small>
          <div className="ms-snd-targets" role="radiogroup" aria-label="Speaker stage presets">
            {STAGE_PRESETS.map((p) => {
              const active = speakersOn && stagePreset === p.id && spatial.mode === p.mode
              return (
                <button
                  type="button"
                  key={p.id}
                  role="radio"
                  aria-checked={active}
                  className={`ms-snd-target${active ? ' on' : ''}`}
                  onClick={() => {
                    setStagePreset(p.id)
                    try { localStorage.setItem(STAGE_PRESET_KEY, p.id) } catch { /* ignore */ }
                    updateSpatial({ mode: p.mode, xfAngle: p.angleDeg })
                  }}
                >
                  <b>{p.label}</b>
                  <small>{p.note}</small>
                </button>
              )
            })}
          </div>
        </div>

        {/* SOFA HRTF Profile Selector */}
        <div className="ms-snd-row">
          <small>SOFA HRTF profile (built-in KEMAR / SADIE II / IRCAM / custom .sofa)</small>
          <div className="ms-snd-hrtf">
            <select
              aria-label="HRTF Profile"
              value={spatial.hrirId}
              onChange={(e) => updateSpatial({ hrirId: e.target.value, mode: speakersOn ? spatial.mode : 'speakers' })}
              className="ms-snd-select"
            >
              <option value="kemar">MIT KEMAR (Diffuse-Field / Standard Pinna)</option>
              {hrirList
                .filter((e) => e.id !== 'kemar')
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.source})
                  </option>
                ))}
              {importedName && <option value={IMPORTED_ID}>Custom SOFA: {importedName}</option>}
            </select>

            <input
              ref={sofaInputRef}
              type="file"
              accept=".sofa"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void handleSofaUpload(f)
              }}
            />
            <button
              type="button"
              className="ms-btn tonal"
              disabled={sofaBusy}
              onClick={() => sofaInputRef.current?.click()}
            >
              <Icon name="upload_file" size={18} /> {sofaBusy ? 'Importing…' : 'Upload .sofa'}
            </button>
            {importedName && (
              <button type="button" className="ms-btn text" onClick={() => void handleRemoveSofa()}>
                Remove {importedName}
              </button>
            )}
            <button
              type="button"
              className="ms-btn text"
              onClick={() => setPickingHrtf((v) => !v)}
            >
              {pickingHrtf ? 'Close ear matcher' : 'Pick HRTF by ear…'}
            </button>
          </div>
          {sofaError && <p className="ms-tz-note danger">{sofaError}</p>}
          {pickingHrtf && (() => {
            const p = engineForTests().player
            if (!p) return null
            return (
              <HrtfPicker
                player={p}
                library={[]}
                manifest={{ categories: {} as never, songs: [] }}
                hrirId={spatial.hrirId}
                onPick={(id) => {
                  updateSpatial({ hrirId: id })
                  setPickingHrtf(false)
                }}
              />
            )
          })()}
        </div>

        {/* Head Size (cm / ITD scale) & Ear Canal Resonance compensation */}
        <div className="ms-snd-grid">
          <div className="ms-snd-row">
            <small>
              Head size (ITD scale) <b>{headCm.toFixed(1)} cm ({itdPct}% ITD)</b>
              {Math.abs(headCm - AVERAGE_HEAD_CM) >= 0.05 && (
                <button
                  type="button"
                  className="ms-btn text ms-snd-reset"
                  onClick={() => updateSpatial({ headCm: AVERAGE_HEAD_CM })}
                >
                  Reset (15.2 cm)
                </button>
              )}
            </small>
            <Slider thick
              min={HEAD_CM_MIN}
              max={HEAD_CM_MAX}
              step={0.1}
              value={headCm}
              label="Head width in cm"
              onChange={(v) => updateSpatial({ headCm: v })}
            />
            <p className="ms-tz-note">Scales inter-aural time delay (Woodworth spherical head model) to match your ear-to-ear width.</p>
          </div>

          <div className="ms-snd-row">
            <small>
              Ear canal resonance compensation <b>{earResonancePct}%</b>
            </small>
            <Slider thick
              min={0}
              max={150}
              step={5}
              value={earResonancePct}
              label="Ear canal resonance compensation"
              onChange={(v) => {
                setEarResonancePct(v)
                try { localStorage.setItem(EAR_RESONANCE_KEY, String(v)) } catch { /* ignore */ }
              }}
            />
            <p className="ms-tz-note">Removes double pinna/ear-canal gain (~3 kHz shout) when convolving Harman-tuned earphones with HRIRs.</p>
          </div>
        </div>

        {/* Head Tracking (camera / sensor toggle) */}
        <div className="ms-snd-row">
          <div className="ms-snd-switchline">
            <div>
              <b>Head Tracking ({spatial.headTracking === 'earbuds' ? 'Galaxy Buds sensor' : isAndroid() ? 'Front camera sensor' : 'Webcam pose sensor'})</b>
              <p className="ms-tz-note tight">
                Keeps the virtual speakers anchored in the room when you turn your head (±60° smooth convolver crossfade).
              </p>
            </div>
            <input
              type="checkbox"
              role="switch"
              aria-label="Enable Head Tracking"
              className="ms-switch"
              checked={spatial.headTracking !== 'off'}
              onChange={(e) =>
                updateSpatial({
                  headTracking: e.target.checked ? camKind : 'off',
                  mode: e.target.checked && !speakersOn ? 'speakers' : spatial.mode,
                })
              }
            />
          </div>
          {spatial.headTracking !== 'off' && isAndroid() && (
            <div className="ms-tz-seg" role="radiogroup" aria-label="Head tracking source">
              {([['earbuds', 'Earbuds'], [camKind, 'Front camera']] as const).map(([k, label]) => (
                <button type="button" key={k} role="radio" aria-checked={spatial.headTracking === k} className={spatial.headTracking === k ? 'on' : ''} onClick={() => updateSpatial({ headTracking: k })}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {spatial.headTracking !== 'off' && (
            <div className="ms-snd-track">
              <span className="ms-set-badge">
                {trackState.status === 'starting'
                  ? (spatial.headTracking === 'earbuds' ? 'Connecting to the earbuds…' : 'Starting camera…')
                  : trackState.status === 'on'
                    ? trackState.face
                      ? `Yaw ${trackState.yaw >= 0 ? `+${Math.round(trackState.yaw)}` : Math.round(trackState.yaw)}°`
                      : spatial.headTracking === 'earbuds' ? 'Earbuds not in the ears' : 'No face in view — centering'
                    : 'Standby'}
              </span>
              {trackState.status === 'on' && (
                <button type="button" className="ms-btn tonal" onClick={recenterHeadTracking}>
                  Recentre straight ahead
                </button>
              )}
              {trackState.status === 'on' && spatial.headTracking === 'earbuds' && (
                <button type="button" className="ms-btn text" onClick={() => {
                  setNodMsg('Look straight ahead, then nod down and up within 3 seconds…')
                  void calibrateEarbuds().then((r) => setNodMsg(r === 'saved' ? 'Saved: these earbuds are calibrated.' : 'The nod was too small. Try a bigger nod.'))
                }}>
                  Look ahead, then nod
                </button>
              )}
              {nodMsg && <p className="ms-tz-note">{nodMsg}</p>}
            </div>
          )}
          {trackState.error && <p className="ms-tz-note danger">{trackState.error}</p>}
        </div>
      </div>
    </section>
  )
}

export function SoundSection() {
  const { db } = useDatabase()
  const refs = useRefs()
  const sound = useSound()
  const { go } = useShell()
  const result = useMemo(
    () => (db && refs ? soundCurve({ catalog: db.catalog, refs, fit: loadFit(), airMode: airMode() }, sound) : null),
    [db, refs, sound],
  )
  const device = sound.deviceId && db ? db.catalog.byId.get(sound.deviceId) : undefined
  const targets = db ? targetsFor(db.catalog, sound.deviceId) : []
  const family = db ? familyOf(db.catalog, sound.deviceId) : 'iem'
  const aimDevice = sound.aim.kind === 'device' && db ? db.catalog.byId.get(sound.aim.id) : undefined
  const aimIsOpen = aimDevice && kindOfIem(aimDevice) === 'headphones' && (aimDevice.back === 'open' || aimDevice.back === 'semi-open')
  const ms = linearLatencyMs(engineSampleRate())
  const setAim = (kind: 'off' | 'target' | 'device') =>
    setSound({ aim: kind === 'off' ? { kind } : kind === 'target' ? { kind, name: (targets.find((t) => t.name === DEFAULT_TARGET[family]) ?? targets[0])?.name ?? '' } : sound.aim.kind === 'device' ? sound.aim : { kind: 'off' }, bypass: false })

  return (
    <>
      {db && (
        <section className={`ms-snd${sound.aim.kind !== 'off' ? ' on' : ''}`}>
          <div className="ms-snd-head">
            <Icon name="graphic_eq" />
            <div className="grow">
              <h3>Sound</h3>
              <p>Make what you listen on sound like a target or another device. Your EQ below adds on top.</p>
            </div>
          </div>

          <div className="ms-snd-row">
            <small>What you listen on</small>
            {device ? (
              <div className="ms-tz-device">
                <b className="grow">{device.name}</b>
                <span className="ms-snd-kind">{kindDetail(kindOfIem(device), device.back)}</span>
                <button type="button" className="ms-btn text" onClick={() => go({ page: 'settings', section: 'gear' })}>Change in My gear</button>
              </div>
            ) : (
              <DevicePicker db={db} kinds={LISTEN_KINDS} label="Search what you listen on" onPick={(id) => { if (sound.aim.kind === 'target') setSound({ aim: { kind: 'off' } }); setActive(id) }} />
            )}
          </div>

          <div className="ms-snd-row">
            <small>Make it sound like</small>
            <div className="ms-tz-seg" role="radiogroup" aria-label="Aim">
              {(['off', 'target', 'device'] as const).map((k) => (
                <button type="button" key={k} role="radio" aria-checked={sound.aim.kind === k} className={sound.aim.kind === k ? 'on' : ''} onClick={() => setAim(k)}>
                  {k === 'off' ? 'Off' : k === 'target' ? family === 'headphone' ? 'A headphone target' : family === 'room' ? 'A room target' : 'An in-ear target' : 'Another device'}
                </button>
              ))}
            </div>
          </div>

          {sound.aim.kind === 'target' && (
            <div className="ms-snd-targets" role="radiogroup" aria-label="Target">
              {targets.map((t) => {
                const on = sound.aim.kind === 'target' && sound.aim.name === t.name
                return (
                  <button type="button" key={t.name} role="radio" aria-checked={on} className={`ms-snd-target${on ? ' on' : ''}`} onClick={() => setSound({ aim: { kind: 'target', name: t.name } })}>
                    <b>{t.name}</b>
                    <small>{t.note}</small>
                  </button>
                )
              })}
            </div>
          )}

          {sound.aim.kind === 'device' && (
            <div className="ms-snd-row">
              {aimDevice ? (
                <div className="ms-tz-device">
                  <b className="grow">{aimDevice.name}</b>
                  <span className="ms-snd-kind">{kindDetail(kindOfIem(aimDevice), aimDevice.back)}</span>
                  <button type="button" className="ms-btn text" onClick={() => setSound({ aim: { kind: 'device', id: '' } })}>Change</button>
                </div>
              ) : (
                <DevicePicker db={db} kinds={family === 'room' ? ROOM_KINDS : KINDS} label="Search the device to sound like" onPick={(id) => setSound({ aim: { kind: 'device', id }, bypass: false })} />
              )}
            </div>
          )}

          {sound.aim.kind !== 'off' && result && (
            <>
              <SoundGraph grid={db.catalog.data.grid} r={result} />
              <div className="ms-snd-row">
                <small>Strength <b>{sound.strength} %</b></small>
                <Slider thick min={0} max={100} step={5} value={sound.strength} label="Strength" onChange={(v) => setSound({ strength: v })} />
              </div>
              <div className="ms-snd-grid">
                <div className="ms-snd-row">
                  <small>How far to correct</small>
                  <div className="ms-tz-seg" role="radiogroup" aria-label="How far to correct">
                    <button type="button" className={sound.fit === 'full' ? 'on' : ''} onClick={() => setSound({ fit: 'full' })}>Full correction</button>
                    <button type="button" className={sound.fit === 'best' ? 'on' : ''} onClick={() => setSound({ fit: 'best' })}>Best fit</button>
                  </div>
                  <p className="ms-tz-note">
                    {sound.fit === 'best' && result.best
                      ? `${result.best.beforeDb.toFixed(1)} → ${result.best.afterDb.toFixed(1)} dB from the aim, ${result.best.eq.filters.length} wide filters: only what the measurements agree on.`
                      : 'Follows the measurements as closely as the filter allows.'}
                  </p>
                </div>
                <div className="ms-snd-row">
                  <small>Phase</small>
                  <div className="ms-tz-seg" role="radiogroup" aria-label="Phase">
                    <button type="button" className={sound.phase === 'minimum' ? 'on' : ''} onClick={() => setSound({ phase: 'minimum' })}>Minimum</button>
                    <button type="button" className={sound.phase === 'linear' ? 'on' : ''} onClick={() => setSound({ phase: 'linear' })}>Linear</button>
                  </div>
                  <p className="ms-tz-note">{sound.phase === 'linear' ? `No phase shift; adds ${ms.toFixed(0)} ms of delay (fine for music, noticeable in games or video).` : 'No added delay; a little phase shift where the EQ moves quickly.'}</p>
                </div>
              </div>
              <p className="ms-tz-note">
                {result.treble === 'full'
                  ? 'Full treble detail: both are the same kind and their measurements agree up top.'
                  : 'Treble smoothed above 6 kHz: the two are different kinds, or their measurements disagree up there, so finer detail would be guesswork.'}
                {!sound.deviceId && ' No device set: your listening gear is assumed to match the target.'}
              </p>
              {aimIsOpen && family !== 'headphone' && (
                <label className="ms-tz-toggle">
                  <input type="checkbox" className="ms-switch" checked={sound.space} onChange={(e) => setSound({ space: e.target.checked })} />
                  <span>Open-back space (a little sound reaching the other ear, as an open headphone does)</span>
                </label>
              )}
            </>
          )}
        </section>
      )}
      <SpatialCrossfeedSection />
    </>
  )
}

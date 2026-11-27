// Scrollable Audio Profile Sheet (max-height: 70vh):
// Lists Raw Sound, Reference Targets with color dots, and Imitating Audio Gear.
// Supports right-click (PC) / long-press (Android) percentage adjustment and 'Copy this EQ'.
import { useState, useRef, useMemo, useEffect, useDeferredValue } from 'react'
import { Dialog, Icon, Menu } from '../ui'
import { useShell } from '../context'
import {
  addProfileItem,
  aimKindsFor,
  applyProfileItem,
  isHeadphoneDevice,
  isSpeakerDevice,
  targetFits,
  targetListFor,
  removeProfileItem,
  setProfileItemStrength,
  useGearProfile,
  type GearProfileItem,
} from './gearProfiles'
import { useGear } from './gear'
import { copyCurrentAimToEq } from './copyEq'
import { applyMyEq, useMyEq } from './myEq'
import { getEq, getPresets, setEq, setPresets, withPreset, type SavedPreset } from '../eqState'
import { gearName } from './phoneSpeaker'
import { loadDatabase, listModels, type Database } from '../database/catalog'
import { soundCurve, type SoundEnv } from './soundCurve'
import { kindOfIem } from '../../data/catalog'
import { loadRefs, type RefData } from '../../audio/reference'
import { loadFit } from '../../fit/fit'
import { imgUrl } from '../../reviews/reviews'
import { kindDetail } from '../tournament/kinds'


export function AudioProfileSheet({ onClose }: { onClose: () => void }) {
  const { showToast, go, setNowPlaying } = useShell()
  const gear = useGear()
  const profile = useGearProfile(gear.active)

  const [db, setDb] = useState<Database | null>(null)
  const [refs, setRefs] = useState<RefData | null>(null)
  useEffect(() => {
    let live = true
    void loadDatabase().then((loaded) => live && setDb(loaded), () => {})
    void loadRefs().then((loadedRefs) => live && setRefs(loadedRefs), () => {})
    return () => {
      live = false
    }
  }, [])

  // Modals inside the sheet
  const [addingTarget, setAddingTarget] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  const [sliderItem, setSliderItem] = useState<GearProfileItem | null>(null)
  const [tempStrength, setTempStrength] = useState(100)
  const [contextItem, setContextItem] = useState<{ item: GearProfileItem; x: number; y: number } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  // §107 E: loads the EQs you saved for this gear (saving stays on the Equalizer page); long-press renames
  const my = useMyEq(gear.active)
  const [myMenu, setMyMenu] = useState<{ p: SavedPreset; x: number; y: number } | null>(null)
  const [naming, setNaming] = useState<{ old: string; name: string } | null>(null)
  const saveName = () => {
    const name = naming?.name.trim()
    if (!naming || !name) return
    const old = naming.old
    setPresets(withPreset(getPresets().filter((x) => x.name !== old), { ...getPresets().find((x) => x.name === old)!, name }))
    if (getEq().preset === old) setEq({ preset: name })
    setNaming(null)
  }

  const activeDeviceName = useMemo(() => {
    if (!gear.active) return 'Default Device'
    return gearName(gear.active, db?.catalog.byId.get(gear.active)?.name)
  }, [gear.active, db])

  const isHeadphone = useMemo(() => {
    if (isHeadphoneDevice(gear.active)) return true
    if (db && gear.active) {
      const d = db.catalog.byId.get(gear.active)
      return d ? kindOfIem(d) === 'headphones' : false
    }
    return false
  }, [gear.active, db])

  const targetItems = useMemo(() => {
    return profile.items.filter((i) => i.kind === 'target' && targetFits(gear.active, i.id, isHeadphone))
  }, [profile.items, isHeadphone, gear.active])
  const deviceItems = profile.items.filter((i) => i.kind === 'device')

  const availableTargets = useMemo(() => {
    const list = targetListFor(gear.active, isHeadphone)
    return list.filter((t) => !targetItems.some((ti) => ti.id === t.id))
  }, [isHeadphone, targetItems, gear.active])

  const handleCopyEq = async (item: GearProfileItem) => {
    // Ensure item is selected so soundCurve has the right aim and strength
    applyProfileItem(item.id, gear.active)
    const res = await copyCurrentAimToEq()
    if (res.success) {
      showToast(`Copied ${item.name} (${item.strength}%) to ${res.presetName}`)
      onClose()
      setNowPlaying(false)
      go({ page: 'settings', section: 'equalizer' })
    } else {
      showToast(res.error || 'Failed to copy EQ')
    }
  }

  const handlePointerDown = (item: GearProfileItem, e: React.PointerEvent) => {
    // holding a row opens the same options as a right-click (the % pill is the way to the strength slider)
    if (e.pointerType === 'touch') {
      const { clientX: x, clientY: y } = e
      longPressTimer.current = window.setTimeout(() => setContextItem({ item, x, y }), 500)
    }
  }

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  return (
    <Dialog title="Audio Profiles &amp; References" onClose={onClose}>
      <div className="ms-profile-sheet-wrap">
        <div className="ms-profile-sheet-device-bar">
          <Icon name="headphones" size={18} />
          <span className="grow ms-ellipsis">
            Listening on: <b>{activeDeviceName}</b>
          </span>
          <button
            type="button"
            className="ms-btn text small"
            onClick={() => {
              onClose()
              go({ page: 'settings', section: 'gear' })
            }}
          >
            Switch Gear
          </button>
        </div>

        <div className="ms-profile-sheet-content">
          {/* Section 1: Raw Gear */}
          <div className="ms-profile-group">
            <span className="ms-profile-group-title">Direct Sound</span>
            <div
              className={`ms-profile-item raw${profile.activeItemId === null && !my.active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => { applyProfileItem(null, gear.active); setEq({ on: false }) }}
            >
              <span className="ms-gear-circle-dot raw" />
              <div className="grow">
                <b>Raw Audio Gear (Pure sound)</b>
                <small>Bypass all targets and simulations (no filter, no EQ)</small>
              </div>
              {profile.activeItemId === null && !my.active && <span style={{ color: 'var(--accent)' }}><Icon name="check" size={20} /></span>}
            </div>
          </div>

          {/* Section 2: Reference Targets */}
          <div className="ms-profile-group">
            <div className="ms-profile-group-header">
              <span className="ms-profile-group-title">Reference Targets ({targetItems.length})</span>
              <button type="button" className="ms-btn text small" onClick={() => setAddingTarget(true)}>
                <Icon name="add" size={16} /> Add Target
              </button>
            </div>
            {targetItems.length === 0 ? (
              <small className="ms-profile-empty">No reference targets added yet.</small>
            ) : (
              targetItems.map((item) => {
                const isActive = profile.activeItemId === item.id
                return (
                  <div
                    key={item.id}
                    className={`ms-profile-item${isActive ? ' active' : ''}`}
                    onClick={() => applyProfileItem(item.id, gear.active)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextItem({ item, x: e.clientX, y: e.clientY })
                    }}
                    onPointerDown={(e) => handlePointerDown(item, e)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    <span className="ms-gear-circle-dot" style={{ backgroundColor: item.color }} />
                    <div className="grow ms-ellipsis">
                      <b>{item.name}</b>
                    </div>
                    <button
                      type="button"
                      className="ms-profile-pct-pill"
                      title="Adjust the strength %"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSliderItem(item)
                        setTempStrength(item.strength)
                      }}
                    >
                      {item.strength}%
                    </button>
                    {isActive && <span style={{ color: 'var(--accent)' }}><Icon name="check" size={20} /></span>}
                  </div>
                )
              })
            )}
          </div>

          {/* §107 E: User made EQ, the presets you saved for this gear (other gear's stay with it) */}
          <div className="ms-profile-group">
            <div className="ms-profile-group-header">
              <span className="ms-profile-group-title">User made EQ ({my.mine.length})</span>
            </div>
            {my.mine.length === 0 ? (
              <small className="ms-profile-empty">EQs you save for this device on the Equalizer page show here.</small>
            ) : (
              my.mine.map((p) => {
                const isActive = my.active?.name === p.name
                return (
                  <div
                    key={p.name}
                    className={`ms-profile-item${isActive ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { applyMyEq(p, gear.active); showToast(`${p.name} on ${activeDeviceName}`) }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMyMenu({ p, x: e.clientX, y: e.clientY })
                    }}
                    onPointerDown={(e) => {
                      if (e.pointerType !== 'touch') return
                      const { clientX: x, clientY: y } = e
                      longPressTimer.current = window.setTimeout(() => setMyMenu({ p, x, y }), 500)
                    }}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    <span className="ms-gear-circle-dot eq"><Icon name="equalizer" size={14} /></span>
                    <div className="grow ms-ellipsis">
                      <b>{p.name}</b>
                    </div>
                    {isActive && <span style={{ color: 'var(--accent)' }}><Icon name="check" size={20} /></span>}
                  </div>
                )
              })
            )}
          </div>

          {/* Section 3: Device to Test */}
          <div className="ms-profile-group">
            <div className="ms-profile-group-header">
              <span className="ms-profile-group-title">Device to Test ({deviceItems.length})</span>
              <button type="button" className="ms-btn text small" onClick={() => setAddingDevice(true)}>
                <Icon name="add" size={16} /> Add Device to Test
              </button>
            </div>
            {deviceItems.length === 0 ? (
              <small className="ms-profile-empty">No test devices added yet. Add headphones or IEMs to audition on this gear.</small>
            ) : (
              deviceItems.map((item) => {
                const isActive = profile.activeItemId === item.id
                return (
                  <div
                    key={item.id}
                    className={`ms-profile-item${isActive ? ' active' : ''}`}
                    onClick={() => applyProfileItem(item.id, gear.active)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextItem({ item, x: e.clientX, y: e.clientY })
                    }}
                    onPointerDown={(e) => handlePointerDown(item, e)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    <span className="ms-gear-circle-dot" style={{ backgroundColor: item.color }} />
                    <div className="grow ms-ellipsis">
                      <b>{item.name}</b>
                    </div>
                    <button
                      type="button"
                      className="ms-profile-pct-pill"
                      title="Adjust the strength %"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSliderItem(item)
                        setTempStrength(item.strength)
                      }}
                    >
                      {item.strength}%
                    </button>
                    {isActive && <span style={{ color: 'var(--accent)' }}><Icon name="check" size={20} /></span>}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Percentage Tuning Dialog with Live Morphing EQ Curve */}
      {sliderItem && (
        <Dialog title={`Strength: ${sliderItem.name}`} onClose={() => setSliderItem(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-dim)' }}>
                {sliderItem.kind === 'target' ? 'Target Reference Blend:' : 'Device Imitation Blend:'}
              </span>
              <b style={{ fontSize: 20, color: sliderItem.color }}>{tempStrength}%</b>
            </div>

            {/* Live transforming EQ curve preview */}
            <StrengthCurvePreview
              item={sliderItem}
              strength={tempStrength}
              deviceId={gear.active}
              db={db}
              refs={refs}
            />

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={tempStrength}
              aria-label="Strength"
              className="ms-slider"
              onChange={(e) => setTempStrength(Number(e.target.value))}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button type="button" className="ms-btn tonal" onClick={() => setSliderItem(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ms-btn primary"
                onClick={() => {
                  setProfileItemStrength(sliderItem.id, tempStrength, gear.active)
                  setSliderItem(null)
                  showToast(`Set ${sliderItem.name} to ${tempStrength}%`)
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Context Menu on Item */}
      {contextItem && (
        <Menu
          x={contextItem.x}
          y={contextItem.y}
          onClose={() => setContextItem(null)}
          items={[
            {
              label: 'Copy this EQ',
              icon: 'content_copy',
              onSelect: () => handleCopyEq(contextItem.item),
            },
            {
              label: `Adjust Strength (${contextItem.item.strength}%)`,
              icon: 'tune',
              onSelect: () => {
                setSliderItem(contextItem.item)
                setTempStrength(contextItem.item.strength)
              },
            },
            {
              label: 'Remove from profile',
              icon: 'delete',
              danger: true,
              onSelect: () => {
                removeProfileItem(contextItem.item.id, gear.active)
                showToast(`Removed ${contextItem.item.name}`)
              },
            },
          ]}
        />
      )}

      {myMenu && (
        <Menu
          x={myMenu.x}
          y={myMenu.y}
          onClose={() => setMyMenu(null)}
          items={[
            { label: 'Rename', icon: 'edit', onSelect: () => setNaming({ old: myMenu.p.name, name: myMenu.p.name }) },
            {
              label: 'Delete',
              icon: 'delete',
              danger: true,
              onSelect: () => {
                setPresets(getPresets().filter((x) => x.name !== myMenu.p.name))
                showToast(`Deleted ${myMenu.p.name}`)
              },
            },
          ]}
        />
      )}

      {naming && (
        <Dialog title="Rename EQ" onClose={() => setNaming(null)}>
          <form onSubmit={(e) => { e.preventDefault(); saveName() }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="ms-input filled" autoFocus aria-label="Name" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="ms-btn tonal" onClick={() => setNaming(null)}>Cancel</button>
              <button type="submit" className="ms-btn primary" disabled={!naming.name.trim()}>Save</button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Add Reference Target Dialog */}
      {addingTarget && (
        <Dialog title="Add Reference Target" onClose={() => setAddingTarget(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
            {availableTargets.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', margin: '8px 0' }}>All standard reference targets for this device family are already added.</p>
            ) : (
              availableTargets.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className="ms-profile-item"
                  onClick={() => {
                    addProfileItem(
                      { id: t.id, kind: 'target', name: t.name, color: t.color, strength: 100 },
                      gear.active,
                    )
                    setAddingTarget(false)
                    showToast(`Added ${t.name}`)
                  }}
                >
                  <span className="ms-gear-circle-dot" style={{ backgroundColor: t.color }} />
                  <div className="grow" style={{ textAlign: 'left' }}>
                    <b>{t.name}</b>
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{isSpeakerDevice(gear.active) ? 'In-Room Target' : isHeadphone ? 'Over-Ear Target' : 'In-Ear Target'}</small>
                  </div>
                  <Icon name="add" size={20} />
                </button>
              ))
            )}
          </div>
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
                gear.active,
              )
              setAddingDevice(false)
              showToast(`Added ${modelName}`)
            }}
          />
        </Dialog>
      )}
    </Dialog>
  )
}

function StrengthCurvePreview({
  item,
  strength,
  deviceId,
  db,
  refs,
}: {
  item: GearProfileItem
  strength: number
  deviceId: string | null
  db: Database | null
  refs: RefData | null
}) {
  const width = 1000
  const height = 110

  const points = useMemo(() => {
    if (!db || !refs) {
      return [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }]
    }
    const env: SoundEnv = {
      catalog: db.catalog,
      refs,
      fit: loadFit(),
      airMode: 'auto',
    }
    const aim = item.kind === 'target' ? { kind: 'target' as const, name: item.id } : { kind: 'device' as const, id: item.id }
    const res = soundCurve(env, {
      deviceId,
      aim,
      strength,
      fit: 'full',
      phase: 'minimum',
      space: true,
    })
    const grid = db.catalog.data.grid
    if (!res.curve || !grid) {
      return [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }]
    }
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i < grid.length; i += 2) {
      const hz = grid[i]
      if (hz < 20 || hz > 20000) continue
      const x = Math.max(0, Math.min(width, (Math.log10(hz / 20) / 3) * width))
      const dbVal = Math.max(-12, Math.min(12, res.curve[i] ?? 0))
      const y = (height / 2) - (dbVal / 12) * ((height / 2) - 10)
      pts.push({ x: +x.toFixed(1), y: +y.toFixed(1) })
    }
    return pts
  }, [item, strength, deviceId, db, refs])

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ')
  const polygonStr = `0,${height} ${polylineStr} ${width},${height}`
  const gradId = `morph-grad-${item.id.replace(/[^a-zA-Z0-9]/g, '_')}`

  return (
    <div
      className="ms-strength-curve-card"
      style={{
        position: 'relative',
        width: '100%',
        height: 120,
        borderRadius: 14,
        background: 'var(--field)',
        border: '1px solid var(--outline)',
        overflow: 'hidden',
        padding: '4px 6px',
      }}
    >
      <span style={{ position: 'absolute', top: 4, left: 8, fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>+12 dB</span>
      <span style={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>0 dB</span>
      <span style={{ position: 'absolute', bottom: 4, left: 8, fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>-12 dB</span>

      <span style={{ position: 'absolute', bottom: 4, left: '25%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>100 Hz</span>
      <span style={{ position: 'absolute', bottom: 4, left: '55%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>1 kHz</span>
      <span style={{ position: 'absolute', bottom: 4, right: 12, fontSize: 10, color: 'var(--text-dim)', zIndex: 1 }}>10 kHz</span>

      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={item.color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={item.color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} style={{ stroke: 'rgb(var(--ink) / 0.18)' }} strokeDasharray="4 4" />
        <line x1="0" x2={width} y1={10} y2={10} style={{ stroke: 'rgb(var(--ink) / 0.08)' }} />
        <line x1="0" x2={width} y1={height - 10} y2={height - 10} style={{ stroke: 'rgb(var(--ink) / 0.08)' }} />
        <line x1={width * 0.233} x2={width * 0.233} y1="0" y2={height} style={{ stroke: 'rgb(var(--ink) / 0.08)' }} />
        <line x1={width * 0.566} x2={width * 0.566} y1="0" y2={height} style={{ stroke: 'rgb(var(--ink) / 0.08)' }} />
        <line x1={width * 0.9} x2={width * 0.9} y1="0" y2={height} style={{ stroke: 'rgb(var(--ink) / 0.08)' }} />

        {/* Morphing Area and Polyline */}
        <polygon points={polygonStr} fill={`url(#${gradId})`} />
        <polyline points={polylineStr} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const ALL_KINDS = ['iems', 'tws', 'headphones', 'speakers', 'soundbar'] as const

/** `allKinds`: any device (an imported EQ can be for anything, §114 A); otherwise the active gear's family only. */
export function DevicePickerModal({ db, onPick, allKinds }: { db: Database; onPick: (id: string, name: string) => void; allKinds?: boolean }) {
  const [query, setQuery] = useState('')
  const active = useGear().active
  const deferred = useDeferredValue(query)
  const matches = useMemo(
    () => (deferred ? listModels(db.models, { query: deferred, kinds: new Set(allKinds ? ALL_KINDS : aimKindsFor(active)), reviewedOnly: false, sort: 'name' }).slice(0, 10) : []),
    [db, deferred, active, allKinds],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="ms-search">
        <Icon name="search" />
        <input
          autoFocus
          placeholder={allKinds ? 'Search any device...' : 'Search headphones or IEMs...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div style={{ maxHeight: '45vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {matches.map((m) => {
          const img = m.photoId ? db.catalog.images[m.photoId] : null
          return (
            <button
              type="button"
              key={m.id}
              className="ms-profile-item"
              onClick={() => onPick(m.id, m.name)}
            >
              <span className="ms-tz-photo" style={{ width: 36, height: 36, borderRadius: 8, overflow: 'hidden' }}>
                {img ? <img src={imgUrl(img.src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="headphones" />}
              </span>
              <div className="grow" style={{ textAlign: 'left' }}>
                <b>{m.name}</b>
                <small style={{ display: 'block', color: 'var(--text-dim)' }}>{kindDetail(m.kind, m.members[0].back)}</small>
              </div>
              <Icon name="add" size={20} />
            </button>
          )
        })}
        {query && matches.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '16px 0' }}>No matching gear found.</p>
        )}
      </div>
    </div>
  )
}

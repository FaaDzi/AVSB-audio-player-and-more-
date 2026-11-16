// Dedicated Saved EQ Management Page (§73):
// View, apply, manage, rename, and export user-made and autosaved equalizers.
// Supports direct export to Equalizer APO (config.txt) and JSON / PEQ format for hardware DACs and DSP players.
import { useState, useRef, useMemo, useEffect } from 'react'
import { loadDatabase, type Database } from '../database/catalog'
import { ImportDeviceDialog } from './EqStudio'
import '../eqStudio.css'
import { Icon, IconButton, Dialog, Menu } from '../ui'
import { useShell } from '../context'
import {
  BANDS,
  eqFilters,
  getPresets,
  presetFields,
  presetFrom,
  presetFilters,
  readPreset,
  setEq,
  setPresets,
  useEq,
  withPreset,
  type SavedPreset,
} from '../eqState'
import { getGear } from '../sound/gear'
import {
  clearSessionAutosave,
  getSessionAutosave,
  subscribeGearProfiles,
} from '../sound/gearProfiles'
import { chainDb } from '../../eq/biquad'
import { useSyncExternalStore } from 'react'

export function generateEqualizerApoConfig(preset: SavedPreset): string {
  const lines: string[] = [
    `# Equalizer APO configuration - ${preset.name}`,
    `Preamp: ${preset.preamp > 0 ? '+' : ''}${preset.preamp.toFixed(1)} dB`,
  ]
  // Basic mode has no bands of its own: what its pads or radar play goes out as filters (§85 A; it used to export nothing)
  const filters = preset.mode === 'basic' ? presetFilters(preset).filter((f) => f.gain !== 0) : preset.mode === 'advanced+' ? preset.filters ?? [] : []
  if (filters.length > 0) {
    filters.forEach((f, i) => {
      let typeStr = 'PK'
      if (f.kind === 'lowshelf') typeStr = 'LSC'
      else if (f.kind === 'highshelf') typeStr = 'HSC'
      lines.push(
        `Filter ${i + 1}: ON ${typeStr} Fc ${Math.round(f.fc)} Hz Gain ${f.gain > 0 ? '+' : ''}${f.gain.toFixed(1)} dB Q ${f.q.toFixed(2)}`,
      )
    })
  } else if (preset.gains && preset.gains.length > 0) {
    const freqs = BANDS[preset.count] ?? BANDS[10]
    let filterIdx = 1
    freqs.forEach((fc, i) => {
      const g = preset.gains[i] ?? 0
      if (g !== 0) {
        lines.push(
          `Filter ${filterIdx++}: ON PK Fc ${fc} Hz Gain ${g > 0 ? '+' : ''}${g.toFixed(1)} dB Q 1.41`,
        )
      }
    })
  }
  return lines.join('\r\n')
}

function MiniEqCurve({ preset }: { preset: SavedPreset }) {
  const line = useMemo(() => {
    // Generate mini SVG path preview
    const dummyState = {
      on: true,
      mode: preset.mode,
      count: preset.count,
      gains: preset.gains ?? [],
      filters: preset.filters ?? [],
      preamp: preset.preamp,
      bass: preset.bass,
      treble: preset.treble,
      balance: 0,
      headroom: true,
      limiter: true,
      compressor: false,
      threshold: -18,
      ratio: 3,
      attack: 10,
      release: 150,
      preset: preset.name,
    }
    const biquads = eqFilters(dummyState)
    const freqs = Array.from({ length: 60 }, (_, i) => 20 * 1000 ** (i / 59))
    const dbs = chainDb(biquads, freqs, 48000)
    return freqs
      .map((f, i) => {
        const x = (Math.log10(f / 20) / 3) * 160
        const y = Math.max(2, Math.min(48, 25 - (dbs[i] ?? 0) * 1.5))
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [preset])

  return (
    <svg viewBox="0 0 160 50" className="ms-saved-eq-svg" aria-hidden="true">
      <line x1="0" x2="160" y1="25" y2="25" stroke="var(--outline)" strokeWidth="0.8" strokeDasharray="3 3" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
    </svg>
  )
}

export function SavedEqPage() {
  const { showToast, go } = useShell()
  const eq = useEq()
  const activeGear = getGear().active
  const presets = getPresets()
  useSyncExternalStore(subscribeGearProfiles, () => getSessionAutosave(activeGear))
  const autosave = getSessionAutosave(activeGear)

  const [namingTarget, setNamingTarget] = useState<SavedPreset | null>(null)
  /** The name of the saved EQ being renamed; null while saving a new one. (The list is read afresh on every render, so its objects can't be compared.) */
  const [renameFrom, setRenameFrom] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<SavedPreset | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; preset: SavedPreset } | null>(null)
  const [db, setDb] = useState<Database | null>(null)
  useEffect(() => {
    let live = true
    void loadDatabase().then((d) => live && setDb(d), () => {})
    return () => { live = false }
  }, [])

  const applyPreset = (p: SavedPreset) => {
    setEq({ ...presetFields(p), on: true })
    showToast(`Loaded ${p.name}`)
  }

  const exportApo = (p: SavedPreset) => {
    const content = generateEqualizerApoConfig(p)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${p.name.replace(/[^\w.-]/g, '_')}_APO.txt`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${p.name} for Equalizer APO`)
  }

  const exportJson = (p: SavedPreset) => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${p.name.replace(/[^\w.-]/g, '_')}.eq.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${p.name} as JSON`)
  }

  const handleImport = (file: File) => {
    file.text().then((text) => {
      try {
        const p = readPreset(text, file.name)
        // a file from squig.link or Hangout doesn't say what it's for: ask, so the EQ stays tied to its device (§85 B)
        if (p.device || !db) finishImport(p)
        else setImporting(p)
      } catch (err: unknown) {
        showToast((err as Error).message || 'Invalid preset file')
      }
    })
  }

  const finishImport = (p: SavedPreset) => {
    setPresets(withPreset(getPresets(), p))
    applyPreset(p)
    showToast(`Imported ${p.name}`)
  }

  const savePermanent = () => {
    const trimmed = newName.trim()
    if (!trimmed || !namingTarget) return
    const updated = withPreset(presets.filter((x) => x.name !== renameFrom), { ...namingTarget, name: trimmed })
    setPresets(updated)
    if (renameFrom === null) {
      clearSessionAutosave(activeGear)
    }
    applyPreset({ ...namingTarget, name: trimmed })
    showToast(`Saved as ${trimmed}`)
    setNamingTarget(null)
    setNewName('')
  }

  const confirmDelete = () => {
    if (!deletingName) return
    setPresets(presets.filter((p) => p.name !== deletingName))
    showToast(`Deleted ${deletingName}`)
    setDeletingName(null)
  }

  const current = presetFrom(eq, eq.preset, activeGear)
  const deviceName = (id?: string) => (id ? db?.catalog.byId.get(id)?.name ?? null : null)
  const exportMenu = (e: React.MouseEvent, p: SavedPreset) => setMenu({ x: e.clientX, y: e.clientY, preset: p })

  // §86 C: what you do with the EQ you're hearing sits in one row on top; each saved EQ has one icon per action
  return (
    <div className="ms-saved-eq-page">
      <div className="ms-saved-eq-top">
        <input type="file" ref={fileInputRef} hidden accept=".json,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleImport(f) }} />
        <button type="button" className="ms-btn primary" onClick={() => { setRenameFrom(null); setNamingTarget(current); setNewName(autosave || !presets.some((x) => x.name === eq.preset) ? '' : eq.preset) }}>
          <Icon name="bookmark_add" size={20} /> Save current EQ
        </button>
        <button type="button" className="ms-btn tonal" onClick={() => fileInputRef.current?.click()}>
          <Icon name="file_open" size={20} /> Import
        </button>
        <button type="button" className="ms-btn tonal" onClick={(e) => exportMenu(e, current)}>
          <Icon name="ios_share" size={20} /> Export
        </button>
        <span className="grow" />
        <button type="button" className="ms-btn text" onClick={() => go({ page: 'settings', section: 'equalizer' })}>
          <Icon name="equalizer" size={20} /> Equalizer
        </button>
      </div>

      {autosave && (
        <div className="ms-saved-eq-card autosave">
          <div className="ms-saved-eq-card-left">
            <div className="ms-saved-eq-title-row">
              <b className="ms-saved-eq-name">Not saved yet</b>
              {deviceName(activeGear ?? undefined) && <span className="ms-set-badge">{deviceName(activeGear ?? undefined)}</span>}
            </div>
            <MiniEqCurve preset={autosave} />
          </div>
          <div className="ms-saved-eq-actions">
            <IconButton icon="bookmark_add" label="Save it" onClick={() => { setRenameFrom(null); setNamingTarget(autosave); setNewName('') }} />
            <IconButton icon="delete" label="Discard it" onClick={() => { clearSessionAutosave(activeGear); showToast('Discarded') }} />
          </div>
        </div>
      )}

      {presets.length === 0 ? (
        <div className="ms-empty small"><Icon name="bookmarks" /><p>No saved EQs yet.</p></div>
      ) : (
        <div className="ms-saved-eq-list">
          {presets.map((p) => {
            const isActive = eq.preset === p.name
            return (
              <div key={p.name} className={`ms-saved-eq-card${isActive ? ' on' : ''}`}>
                <div className="ms-saved-eq-card-left">
                  <div className="ms-saved-eq-title-row">
                    <b className="ms-saved-eq-name">{p.name}</b>
                    {deviceName(p.device) && <span className="ms-set-badge">{deviceName(p.device)}</span>}
                  </div>
                  <MiniEqCurve preset={p} />
                </div>
                <div className="ms-saved-eq-actions">
                  <button type="button" className={`ms-btn small${isActive ? ' primary' : ' tonal'}`} onClick={() => applyPreset(p)}>
                    <Icon name={isActive ? 'check' : 'play_arrow'} size={18} /> {isActive ? 'In use' : 'Use'}
                  </button>
                  <IconButton icon="edit" label="Rename" onClick={() => { setRenameFrom(p.name); setNamingTarget(p); setNewName(p.name) }} />
                  <IconButton icon="ios_share" label="Export" onClick={(e) => exportMenu(e, p)} />
                  <IconButton icon="delete" label="Delete" onClick={() => setDeletingName(p.name)} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'Equalizer APO text (.txt)', icon: 'description', onSelect: () => exportApo(menu.preset) },
          { label: 'AVSB preset (.json)', icon: 'data_object', onSelect: () => exportJson(menu.preset) },
        ]} />
      )}

      {/* Rename / Save Dialog */}
      {importing && db && (
        <ImportDeviceDialog
          db={db}
          presetName={importing.name}
          activeId={activeGear}
          onDone={(device) => { finishImport(device ? { ...importing, device } : importing); setImporting(null) }}
        />
      )}
      {namingTarget && (
        <Dialog title={renameFrom !== null ? 'Rename' : 'Save this EQ'} onClose={() => setNamingTarget(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
            <input
              type="text"
              autoFocus
              className="ms-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Custom EQ 1, Harman Warm, Gaming..."
              onKeyDown={(e) => e.key === 'Enter' && savePermanent()}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="ms-btn tonal" onClick={() => setNamingTarget(null)}>
                Cancel
              </button>
              <button type="button" className="ms-btn primary" onClick={savePermanent} disabled={!newName.trim()}>
                Save Preset
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingName && (
        <Dialog title="Delete Preset" onClose={() => setDeletingName(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 14 }}>
              Are you sure you want to permanently delete <b>{deletingName}</b>?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="ms-btn tonal" onClick={() => setDeletingName(null)}>
                Cancel
              </button>
              <button type="button" className="ms-btn tonal danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

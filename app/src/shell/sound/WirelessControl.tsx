// §117: Settings → Wireless control. One page for every pair: the same cards, filled from what the pair can do
// (wireless/capabilities.ts). Options it lacks are left out; capabilities it lacks are greyed with the reason.
// Every change is shown once the pair itself confirms it (the native drivers wait for its answer).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { loadSpatial, onSpatialChange } from '../../spatial/settings'
import { AudioRoute, type BluetoothCodec } from '../../audio/speakerGuard'
import { askBuds, findWireless, GAIA_QUESTIONS, probeBuds, readWireless, setWireless, type WirelessPair } from '../../headtrack/buds'
import { isAndroid } from '../../platform'
import { capsFor, nearestStop, noiseLabel, noiseStops, placeholderPositions, stopIndex, stopPositions, type Noise, type WirelessState, type Why } from '../../wireless/capabilities'
import { useShell } from '../context'
import { logLine } from '../logs'
import { Icon } from '../ui'
import { ListeningList } from './ListeningList'
import { NoiseScene } from './NoiseScene'
import { SpatialCrossfeedSection } from './SoundSection'

// loadSpatial reads storage each call: keep one object per change so React's store check stays stable
let spatialSnap = loadSpatial()
const onSpatialChangeStore = (cb: () => void) => onSpatialChange((s) => { spatialSnap = s; cb() })
const WHY: Record<Why, string> = {
  'open-ear': 'Open-ear: there is nothing to seal out noise',
  buttons: 'Set on the earbuds themselves',
  none: 'Not on these headphones',
  unknown: 'Not known for these earbuds yet',
  auto: 'Turns on by itself while a game runs (Samsung phones)',
}
const CONNECTION: [number, string][] = [[0, 'Standard'], [1, 'LDAC'], [2, 'Two devices']]

function Segment({ label, icon, options, value, onPick, disabled, why }: { label: string; icon: string; options: [number, string][]; value: number | undefined; onPick: (v: number) => void; disabled?: boolean; why?: string }) {
  return (
    <div className={`ms-set-row column segment has-icon${disabled ? ' dim' : ''}`}>
      <div className="ms-set-line"><Icon name={icon} /><span className="grow ms-set-head">{label}{why && <small className="ms-wl-why">{why}</small>}</span></div>
      <div className="ms-segment-small big" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button type="button" key={v} role="radio" disabled={disabled} aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  )
}

/** An on/off setting as a switch, so its state reads at a glance; greyed with the reason when the pair lacks it. */
function Switch({ label, icon, on, onChange, disabled, why }: { label: string; icon: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; why?: string }) {
  return (
    <label className={`ms-set-row toggle${disabled ? ' dim' : ' clickable'}`} style={disabled ? { pointerEvents: 'none' } : undefined}>
      <Icon name={icon} />
      <span className="grow ms-set-text"><span>{label}</span>{why && <small>{why}</small>}</span>
      <input type="checkbox" role="switch" className="ms-switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** §119: the 360 screen (Settings → Wireless control → 360 audio). */
export function Spatial360Page() {
  const { go } = useShell()
  return <SpatialCrossfeedSection part="tracking" onOther={() => go({ page: 'settings', section: 'spatial' })} />
}

function Spatial360Row() {
  const { go } = useShell()
  const spatial = useSyncExternalStore(onSpatialChangeStore, () => spatialSnap)
  const on = spatial.mode === '360'
  const source = { off: 'no head tracking', earbuds: 'earbud sensors', 'phone-camera': 'camera', webcam: 'camera', rough: 'rough estimation' }[spatial.headTracking]
  return (
    <button type="button" className={`ms-wl-preset${on ? ' on' : ''}`} onClick={() => go({ page: 'settings', section: 'spatial-360' })}>
      <Icon name="360" size={22} />
      <span className="ms-wl-preset-text"><b>360 audio</b><small>{on ? `On · ${source}` : 'Off'}</small></span>
      <Icon name="chevron_right" size={22} />
    </button>
  )
}

export function WirelessControl() {
  const { showToast } = useShell()
  const [pairs, setPairs] = useState<WirelessPair[] | null>(null)
  const [codec, setCodec] = useState<BluetoothCodec | null>(null)
  const [state, setState] = useState<WirelessState>({})
  const [busy, setBusy] = useState(false)
  const [stop, setStop] = useState<number | null>(null)

  useEffect(() => {
    if (!isAndroid()) return
    let live = true
    const look = () => {
      void Promise.all([findWireless(), AudioRoute.output().then((o) => (o.type === 'bluetooth' ? o.name ?? '' : ''), () => '')]).then(([found, playing]) => {
        if (live) setPairs([...found].sort((a, b) => Number(b.name === playing) - Number(a.name === playing)))
      }, () => live && setPairs([]))
      void AudioRoute.codec().then((c) => live && setCodec(c), () => {})
    }
    look()
    const sub = AudioRoute.addListener('devices', look)
    return () => { live = false; void sub.then((s) => s.remove()) }
  }, [])

  const pair = pairs?.[0] ?? null
  const caps = useMemo(() => (pair ? capsFor(pair.driver, pair.name) : null), [pair])
  const stops = useMemo(() => (caps?.noise ? noiseStops(caps.noise) : []), [caps])

  useEffect(() => {
    if (!pair) return
    let live = true
    setState(pair.battery !== null ? { battery: { single: pair.battery } } : {})
    setBusy(true)
    void readWireless(pair.address, pair.name).then((s) => live && setState((old) => ({ ...old, ...s })), (e: unknown) => logLine('INFO', 'Wireless', `${pair.name}: ${String(e)}`)).finally(() => live && setBusy(false))
    // §120: just after connecting, earbuds can still report their start-up state (the Buds2 said Off while in
    // Ambient): read once more when they've settled; nothing changes unless the second answer differs
    const again = window.setTimeout(() => {
      // only the noise mode is taken from it: a reused connection doesn't bring the full status (battery would
      // fall back to the phone's single figure and hide L / R / case)
      if (live && !draining.current) void readWireless(pair.address, pair.name).then((s) => live && !draining.current && s.noise && setState((old) => ({ ...old, noise: s.noise })), () => {})
    }, 2500)
    return () => { live = false; window.clearTimeout(again) }
  }, [pair])

  const fail = useCallback((e: unknown) => showToast(`${pair?.name ?? 'Earbuds'}: ${e instanceof Error ? e.message : String(e)}`), [pair, showToast])
  const merge = (s: WirelessState) => setState((old) => ({ ...old, ...s, noise: s.noise ? { ...old.noise, ...s.noise } : old.noise }))
  const stateRef = useRef(state)
  stateRef.current = state

  // Galaxy Buds take the mode and the ambient level as two settings; Sony takes them (and voice focus) as one
  const applyNoise = async (n: Noise) => {
    if (!pair) return
    if (pair.driver === 'samsung') {
      merge(await setWireless(pair.address, 'noise', n.mode))
      if (n.mode === 2 && n.level !== undefined) merge(await setWireless(pair.address, 'ambient', n.level))
    } else {
      const now = stateRef.current.noise
      merge(await setWireless(pair.address, 'noise', n.mode, { level: n.level ?? now?.level ?? 10, voice: n.voice ?? now?.voice ?? false }))
    }
  }

  // §118: everything sent to the earbuds goes through one queue, one at a time (they take one connection). A newer
  // change of the same kind replaces a waiting one, so a fast swipe sends only where it stopped and nothing is dropped.
  const waiting = useRef(new Map<string, () => Promise<void>>())
  const draining = useRef(false)
  const [writing, setWriting] = useState(false)
  const drain = async () => {
    draining.current = true
    setWriting(true)
    while (waiting.current.size) {
      const [key, task] = waiting.current.entries().next().value as [string, () => Promise<void>]
      waiting.current.delete(key)
      try { await task() } catch (e) { if (!waiting.current.has(key)) fail(e) }
    }
    draining.current = false
    setWriting(false)
    setStop(null)
  }
  const enqueue = (key: string, task: () => Promise<void>) => {
    waiting.current.delete(key)
    waiting.current.set(key, task)
    if (!draining.current) void drain()
  }

  // presets leave noise control where the owner put it, except Street; leaving Street gives back what was there
  const noiseBefore = useRef<Noise | null | undefined>(undefined)
  const pickStop = (i: number) => {
    setStop(i)
    noiseBefore.current = undefined // the owner set it: nothing to give back after Street
    enqueue('noise', () => applyNoise(stops[i]))
  }
  const presetEarbuds = (plan: { noise?: Noise; game?: number }) => {
    if (!pair) return Promise.resolve()
    if (plan.noise) {
      if (noiseBefore.current === undefined) noiseBefore.current = stateRef.current.noise ?? null
      const n = plan.noise
      enqueue('noise', () => applyNoise(n))
    } else if (noiseBefore.current !== undefined) {
      const back = noiseBefore.current
      noiseBefore.current = undefined
      if (back) enqueue('noise', () => applyNoise(back))
    }
    if (plan.game !== undefined) { const g = plan.game; enqueue('game', async () => merge(await setWireless(pair.address, 'game', g))) }
    return Promise.resolve()
  }

  // §119: 360 belongs to the gear on your head: a row here opens its own screen (PC and phone)
  const stage = <Spatial360Row />
  // earbud controls need the phone's Bluetooth; the PC shows the 360 part only
  if (!isAndroid()) return <div className="ms-wl">{stage}</div>
  if (!pair || !caps) {
    // nothing connected: nothing to control, so no presets either (owner)
    return (
      <div className="ms-wl">
        {/* §120: wired gear and unknown pairs keep 360; the earbud-only parts wait for wireless earbuds */}
        <div className="ms-set-row toggle dim" style={{ pointerEvents: 'none' }}>
          <Icon name="earbuds" />
          <span className="grow ms-set-text"><span>{pairs === null ? 'Looking for your earbuds…' : 'Noise control and presets'}</span>{pairs !== null && <small>Need wireless earbuds we can talk to</small>}</span>
        </div>
        {stage}
      </div>
    )
  }

  const codecText = codec?.known ? [codec.name ?? codec.codec, codec.sampleRate ? `${codec.sampleRate / 1000} kHz` : null, codec.bits ? `${codec.bits}-bit` : null, codec.ldacKbps ? `${codec.ldacKbps} kbps` : null].filter(Boolean).join(' · ') : null
  const b = state.battery
  const battery: [string, number | undefined, string][] = b ? (b.left !== undefined || b.right !== undefined ? [['L', b.left, 'battery_full'], ['R', b.right, 'battery_full'], ...(b.case !== undefined ? [['Case', b.case, 'inventory_2'] as [string, number, string]] : [])] : b.single !== undefined ? [['Battery', b.single, 'battery_full']] : []) : []
  const here = stop ?? stopIndex(stops, state.noise)
  // §120: evenly spaced nodes around the three reference ones; Off is wherever its node falls
  const positions = stopPositions(stops)
  const offPos = positions[stops.findIndex((s) => s.mode === 0)] ?? 0.5
  const at = positions[here] ?? offPos
  // a pair without noise control shows the whole scene, greyed
  const ancSide = Boolean(caps.noise?.anc)
  const ambientSide = Boolean(caps.noise?.ambient)
  const info = state.info

  return (
    <div className="ms-wl" style={busy || writing ? { cursor: 'progress' } : undefined}>
      <section className="ms-set-section">
        <div className="ms-gear-head">
          <h3><Icon name="earbuds" size={20} /> {pair.name}</h3>
          {codecText && <span className="ms-set-badge">{codecText}</span>}
          {!pair.tested && <span className="ms-set-badge">untested</span>}
          {/* Sleep A30: its Local mode plays its own sleep sounds; we work with Bluetooth mode */}
          {state.listening === 1 && <small className="ms-wl-why">In Local mode: switch the earbuds to Bluetooth mode</small>}
        </div>
        {battery.length > 0 && (
          <div className="ms-set-tile-grid tall ms-wl-battery" style={{ gridTemplateColumns: `repeat(${battery.length}, minmax(0, 1fr))`, maxWidth: battery.length * 140 }}>
            {battery.map(([k, v, icon]) => <div key={k} className="ms-wl-tile"><Icon name={icon} fill size={26} /><span>{k} {v ?? '?'}%</span></div>)}
          </div>
        )}
      </section>

      <section className={`ms-set-section ms-wl-noise${caps.noise ? '' : ' dim'}`}>
        <div className="ms-gear-head">
          <h3><Icon name="noise_aware" size={20} /> {caps.noise && stops[here] ? noiseLabel(stops[here], caps.noise.ambient?.min ?? 0) : 'Noise control'}</h3>
          {!caps.noise && caps.noiseWhy && <small className="ms-wl-why">{WHY[caps.noiseWhy]}</small>}
          {caps.noise && state.worn === false && <small className="ms-wl-why">Put them in your ears to change this</small>}
        </div>
        <NoiseScene t={caps.noise ? at : 1} off={caps.noise ? offPos : 0} dim={!caps.noise} />
        {caps.noise && stops.length > 1 && (
          <>
            <div className="ms-wl-track">
              {/* a side the pair doesn't have is grey; the fill runs from Off to the ball, deeper per tier */}
              <i className={`half left${ancSide ? '' : ' none'}`} style={{ width: `${offPos * 100}%` }} />
              <i className={`half right${ambientSide ? '' : ' none'}`} style={{ left: `${offPos * 100}%`, width: `${(1 - offPos) * 100}%` }} />
              <i className={`fill ${at < offPos ? 'anc' : 'amb'}`} style={{ left: `${Math.min(at, offPos) * 100}%`, width: `${Math.abs(at - offPos) * 100}%` }} />
              <input type="range" className="ms-slider ms-wl-slider" min={0} max={1000} step={1} value={Math.round(at * 1000)} aria-label="Noise control"
                aria-valuetext={stops[here] ? noiseLabel(stops[here], caps.noise.ambient?.min ?? 0) : undefined} disabled={busy || state.worn === false}
                onChange={(e) => setStop(nearestStop(positions, Number(e.target.value) / 1000))}
                onPointerUp={(e) => pickStop(nearestStop(positions, Number(e.currentTarget.value) / 1000))}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
                  if (!d) return
                  e.preventDefault()
                  pickStop(Math.min(stops.length - 1, Math.max(0, here + d)))
                }} />
            </div>
            {/* a node for every setting; Noise cancelling, Off and Ambient 1 are the bigger reference nodes */}
            <div className="ms-wl-nodes" aria-hidden="true">
              {stops.map((s, i) => <i key={i} className={`${i === 0 || stops[i - 1].mode !== s.mode ? 'major' : ''}${i === here ? ' on' : ''}`} style={{ left: `${positions[i] * 100}%` }} />)}
              {placeholderPositions(stops).map((p) => <i key={p} className="major none" style={{ left: `${p * 100}%` }} />)}
            </div>
            <div className="ms-wl-ends">
              <span className={ancSide ? undefined : 'none'}>Noise cancelling</span>
              {/* Off is named under its node only where it has room beside the end labels */}
              {offPos > 0.25 && offPos < 0.75 && <span className="off" style={{ left: `${offPos * 100}%` }}>Off</span>}
              <span className={ambientSide ? undefined : 'none'}>Ambient</span>
            </div>
          </>
        )}
        {caps.noise?.voice && state.noise?.mode === 2 && (
          <Switch label="Focus on voice" icon="record_voice_over" on={Boolean(state.noise?.voice)}
            onChange={(on) => enqueue('noise', () => applyNoise({ mode: 2, level: stateRef.current.noise?.level, voice: on }))} />
        )}
      </section>

      <ListeningList caps={caps} onEarbuds={presetEarbuds} />

      <Switch label="Game mode (lower delay)" icon="sports_esports" on={caps.game && state.game === 1} disabled={!caps.game}
        why={!caps.game && caps.gameWhy ? WHY[caps.gameWhy] : undefined}
        onChange={(on) => {
          // flips at once so quick taps alternate; the earbuds' answer (or the old value, if they refuse) follows
          const before = stateRef.current.game
          merge({ game: on ? 1 : 0 })
          enqueue('game', async () => { try { merge(await setWireless(pair.address, 'game', on ? 1 : 0)) } catch (e) { merge({ game: before }); throw e } })
        }} />

      {/* §119: Sony's own "Prioritize sound quality" is what lets the phone use LDAC */}
      {state.quality !== undefined && (
        <Segment label="Sound quality (LDAC)" icon="high_quality" options={[[0, 'Sound quality'], [1, 'Stable connection']]} value={state.quality}
          onPick={(v) => enqueue('quality', async () => { merge(await setWireless(pair.address, 'quality', v)); void AudioRoute.codec().then(setCodec, () => {}) })} />
      )}
      {/* this phone won't tell apps the codec (Android keeps it for its own settings): the way there instead */}
      {codec && !codec.known && (
        <button type="button" className="ms-wl-preset" onClick={() => void AudioRoute.openDeveloperOptions().catch((e: unknown) => showToast(String(e)))}>
          <Icon name="graphic_eq" size={22} />
          <span className="ms-wl-preset-text"><b>Bluetooth codec</b><small>This phone keeps it in Developer options · Bluetooth audio codec</small></span>
          <Icon name="open_in_new" size={20} />
        </button>
      )}
      {/* §119: the phone's own codec choice (Android keeps it for system apps on many phones: then Developer options) */}
      {codec?.known && (codec.selectable?.length ?? 0) > 1 && (
        <Segment label="Bluetooth codec" icon="graphic_eq" options={codec.selectable!.map((c, i) => [i, c] as [number, string])}
          value={codec.selectable!.indexOf(codec.codec ?? '')}
          onPick={(i) => enqueue('codec', async () => {
            const want = codec.selectable![i]
            const r = await AudioRoute.setCodec({ codec: want })
            setCodec(r)
            if (!r.applied) showToast({ message: `This phone keeps the codec for its own settings`, action: { label: 'Developer options', onClick: () => void AudioRoute.openDeveloperOptions().catch((e: unknown) => showToast(String(e))) } })
          })} />
      )}
      {codec?.known && codec.codec === 'LDAC' && (
        <Segment label="LDAC quality" icon="high_quality" options={[[990, '990'], [660, '660'], [330, '330'], [0, 'Auto']]} value={codec.ldacKbps}
          onPick={(k) => enqueue('codec', async () => {
            const r = await AudioRoute.setCodec({ codec: 'LDAC', ldacKbps: k })
            setCodec(r)
            if (!r.applied) showToast({ message: `This phone keeps LDAC quality for its own settings`, action: { label: 'Developer options', onClick: () => void AudioRoute.openDeveloperOptions().catch((e: unknown) => showToast(String(e))) } })
          })} />
      )}

      {caps.connection && (
        <Segment label="Connection" icon="bluetooth" options={CONNECTION} value={state.connection} disabled={busy}
          onPick={(v) => enqueue('connection', async () => merge(await setWireless(pair.address, 'connection', v)))} />
      )}

      {caps.gestures && (
        <section className="ms-set-section">
          <div className="ms-gear-head"><h3><Icon name="touch_app" size={20} /> On the earbuds</h3></div>
          <div className="ms-wl-gestures">
            {caps.gestures.map((g) => (
              <div key={`${g.ear}${g.taps}`} className="ms-wl-gesture">
                <span className="ms-wl-ear">{g.ear === 'Any' ? 'L / R' : g.ear}</span>
                <b>{g.taps}</b>
                <span>{g.does}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {stage}

      <div className="ms-wl-foot">
        {info && <small>{[info.model, info.firmware && `firmware ${info.firmware}`, info.chip].filter(Boolean).join(' · ')}</small>}
        {(pair.driver === 'none' || pair.driver === 'gaia') && (
          <button type="button" className="ms-btn text" onClick={() => {
            void probeBuds().then(async (list) => {
              for (const d of list) {
                logLine('INFO', 'Buds', `${d.name}: ${d.uuids.join(', ') || 'no services listed'}`)
                // a Qualcomm chip (its d102 service family): ask it, read-only, whether it speaks GAIA
                const qualcomm = d.uuids.filter((u) => u.endsWith('-d102-11e1-9b23-00025b00a5a5'))
                if (!qualcomm.length) continue
                const spp = d.uuids.filter((u) => u.startsWith('00001101-'))
                for (const a of await askBuds(d.address, [...spp, ...qualcomm], GAIA_QUESTIONS)) logLine('INFO', 'Buds', `${d.name} ${a.uuid}${a.heard}`)
              }
              showToast(list.length ? 'Earbud details saved to Logs' : 'No connected earbuds found')
            }, (e: unknown) => showToast(String(e)))
          }}><Icon name="manage_search" size={18} /> Look up these earbuds</button>
        )}
      </div>
    </div>
  )
}

// My gear → Your source (§69): the DAC or dongle the music goes through (found automatically from the output device,
// or picked by hand), what its output impedance means for your IEM, and any DSP cable or plug, whose stored EQ can be
// switched off so it plays like a plain cable. Logic from the old app: fit/detect.ts, fit/source.ts, dsp/ktmicro.ts.
import { useEffect, useMemo, useState } from 'react'
import { Dialog, Icon, IconButton } from '../ui'
import { imgUrl } from '../../reviews/reviews'
import { classifyOutput, describe, loadDeviceTable, type DacEntry, type DeviceTable, type Detected } from '../../fit/detect'
import { defaultOutput, onDeviceChange, type OutputDevice } from '../../fit/system'
import { checkSource, loadSource, saveSource, sourceFor, type SourceSettings } from '../../fit/source'
import { canUseDsp, connectDsp, type DspTransport } from '../../dsp/transport'
import { AudioRoute, type BluetoothCodec } from '../../audio/speakerGuard'
import { isAndroid } from '../../platform'
import { decodeBand, displayHz, KT_MICRO_MODELS, KtMicroDsp, type DspBackup, type RawBand } from '../../dsp/ktmicro'

const BACKUP_KEY = 'dsp-backup-v1'
const loadBackup = (): DspBackup | null => {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_KEY) ?? 'null')
  } catch {
    return null
  }
}
const storeBackup = (b: DspBackup | null) => {
  try {
    if (b) localStorage.setItem(BACKUP_KEY, JSON.stringify(b))
    else localStorage.removeItem(BACKUP_KEY)
  } catch {
    // storage unavailable: the restore then only works until the app closes
  }
}

function useOutput(table: DeviceTable | null): { out: OutputDevice | null; found: Detected | null } {
  const [out, setOut] = useState<OutputDevice | null>(null)
  useEffect(() => {
    let live = true
    const read = () => void defaultOutput().then((o) => live && setOut(o), () => {})
    read()
    const off = onDeviceChange(read)
    return () => {
      live = false
      off()
    }
  }, [])
  return { out, found: out && table ? classifyOutput(out, table) : null }
}

function DspNeutral() {
  const [link, setLink] = useState<{ t: DspTransport; dsp: KtMicroDsp; bands: RawBand[] } | null>(null)
  const [backup, setBackup] = useState<DspBackup | null>(loadBackup)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (what: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await what()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const flat = link?.bands.every((b) => decodeBand(b).gainDb === 0)
  const summary = (product: string, bands: RawBand[]) => {
    const on = bands.map(decodeBand).filter((b) => b.gainDb !== 0)
    return on.length ? on.map((b) => `${b.gainDb > 0 ? '+' : ''}${b.gainDb.toFixed(1)} dB at ${displayHz(product, b.rawFreq)} Hz`).join(' · ') : 'neutral: every band at 0 dB'
  }
  if (!canUseDsp()) return <p className="ms-tz-note">DSP cables can be reset in the app (Windows) or on Android; this window can't reach USB devices.</p>
  return (
    <div className="ms-gear-dsp">
      <p className="ms-tz-note">
        A DSP cable or USB-C plug keeps its own EQ (set in Moondrop Link, the TANCHJIM app…). It plays after this app, so a forgotten EQ in it would skew every simulation. Make it neutral and it works like a normal cable. Supported now: {[...new Set(Object.values(KT_MICRO_MODELS))].join(', ')}.
      </p>
      {backup && !link && <p className="ms-tz-note">Your {KT_MICRO_MODELS[backup.product] ?? backup.product} EQ from {new Date(backup.savedAt).toLocaleString()} is saved here, ready to put back.</p>}
      {!link ? (
        <button type="button" className="ms-btn tonal" disabled={busy} onClick={() => run(async () => {
          const t = await connectDsp()
          if (!t) return setMsg('No supported DSP cable or plug found. Plug it in and try again.')
          const dsp = new KtMicroDsp(t)
          setLink({ t, dsp, bands: await dsp.readBands() })
        })}><Icon name="usb" size={20} /> {busy ? 'Looking…' : 'Connect DSP cable'}</button>
      ) : (
        <>
          <p><b>{link.dsp.name}</b>: {summary(link.t.productName, link.bands)}</p>
          <div className="ms-gear-dsp-actions">
            <button type="button" className="ms-btn primary" disabled={busy || flat} onClick={() => run(async () => {
              const b = await link.dsp.backup()
              // keep the oldest backup: a second reset must not overwrite your real EQ with the flat one
              const keep = backup && backup.product === b.product ? backup : b
              storeBackup(keep)
              setBackup(keep)
              await link.dsp.flatten(b)
              const bands = await link.dsp.readBands()
              setLink({ ...link, bands })
              setMsg(bands.map(decodeBand).every((x) => x.gainDb === 0) ? 'Done: the cable now plays neutral, like a normal cable.' : "The cable didn't take the change. Unplug it, plug it back in and try again.")
            })}>Make it neutral</button>
            <button type="button" className="ms-btn text" disabled={busy || !backup || backup.product !== link.t.productName} onClick={() => run(async () => {
              await link.dsp.restore(backup!)
              setLink({ ...link, bands: await link.dsp.readBands() })
              storeBackup(null)
              setBackup(null)
              setMsg('Your EQ is back on the cable.')
            })}>Put my EQ back</button>
          </div>
        </>
      )}
      {msg && <p className="ms-tz-note">{msg}</p>}
    </div>
  )
}

/**
 * Android (plan §70 C1): the Bluetooth codec the phone is using, and what it means for what reaches the ears. Hi-res
 * files are never refused: a codec that carries less just gets them converted down by the phone.
 */
function BluetoothLine({ out }: { out: OutputDevice | null }) {
  const [codec, setCodec] = useState<BluetoothCodec | null>(null)
  useEffect(() => {
    if (!isAndroid()) return
    let live = true
    // only over Bluetooth: wired and USB outputs have no codec to report
    void AudioRoute.output().then((o) => (o.type === 'bluetooth' ? AudioRoute.codec() : null)).then((c) => live && setCodec(c), () => live && setCodec(null))
    return () => { live = false }
  }, [out?.id, out?.label])
  if (!codec || !isAndroid()) return null
  if (!codec.known) {
    return <p className="ms-tz-note">{codec.denied ? 'Allow Nearby devices for this app to see which Bluetooth codec is in use.' : "The phone doesn't say which Bluetooth codec is in use."}</p>
  }
  const rate = codec.sampleRate ? `${+(codec.sampleRate / 1000).toFixed(1)} kHz` : ''
  const parts = [codec.name ?? codec.codec, rate, codec.bits ? `${codec.bits}-bit` : '', codec.ldacKbps ? `${codec.ldacKbps} kbps` : codec.name === 'LDAC' ? 'adaptive bitrate' : ''].filter(Boolean)
  const lossy = codec.name !== 'LDAC' || (codec.ldacKbps ?? 0) < 990
  return (
    <p className="ms-tz-note">
      <b>Bluetooth: {parts.join(', ')}.</b>{' '}
      {lossy
        ? 'Bluetooth compresses the sound on the way, so hi-res files are converted down by the phone. They still play; nothing to change.'
        : 'LDAC at its top rate: about as much as Bluetooth carries. Hi-res files are converted down to this by the phone.'}
    </p>
  )
}

const ohms = (d: DacEntry) => (d.outputOhm !== null ? `${d.outputOhm} Ω output` : 'Output not published')

function DacRow({ d, chosen, sub, onClick, trail }: { d: DacEntry | null; chosen?: boolean; sub: string; onClick: () => void; trail: string }) {
  return (
    <button type="button" className={`ms-db-row ms-dac-row${chosen ? ' on' : ''}`} onClick={onClick} aria-pressed={chosen}>
      <span className="ms-db-photo">{d?.photo ? <img src={imgUrl(d.photo)} alt="" loading="lazy" decoding="async" /> : <Icon name={d ? 'usb' : 'block'} />}</span>
      <span className="ms-db-text">
        <b className="ms-ellipsis">{d?.name ?? 'Not listed'}</b>
        <small className="ms-ellipsis">{sub}</small>
      </span>
      <Icon name={trail} />
    </button>
  )
}

/** "Pick it by hand" (§79 F): the chosen DAC as a Database row; tapping opens a searchable list in the same look. */
function DacPicker({ dacs, value, onPick }: { dacs: DacEntry[]; value: string; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = dacs.find((d) => d.name === value) ?? null
  const q = query.trim().toLowerCase()
  const shown = q ? dacs.filter((d) => d.name.toLowerCase().includes(q)) : dacs
  const choose = (name: string) => {
    onPick(name)
    setOpen(false)
    setQuery('')
  }
  return (
    <>
      <DacRow d={current} sub={current ? `Picked by hand · ${ohms(current)}` : `Pick it by hand · ${dacs.length} DACs and dongles`} onClick={() => setOpen(true)} trail="chevron_right" />
      {open && (
        <Dialog title="Your DAC or dongle" onClose={() => setOpen(false)}>
          <label className="ms-search">
            <Icon name="search" />
            <input autoFocus placeholder="Search DACs and dongles" aria-label="Search DACs and dongles" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <IconButton icon="close" label="Clear search" small onClick={() => setQuery('')} />}
          </label>
          <div className="ms-dac-list">
            {!q && <DacRow d={null} chosen={!current} sub="Use what's found on its own" onClick={() => choose('')} trail={!current ? 'check' : ''} />}
            {shown.map((d) => <DacRow key={d.name} d={d} chosen={d.name === value} sub={ohms(d)} onClick={() => choose(d.name)} trail={d.name === value ? 'check' : ''} />)}
            {!shown.length && <div className="ms-empty small"><Icon name="search_off" /><p>Nothing matches.</p></div>}
          </div>
        </Dialog>
      )}
    </>
  )
}

export function SourceSection({ activeId }: { activeId: string | null }) {
  const [table, setTable] = useState<DeviceTable | null>(null)
  const [saved, setSourceState] = useState<SourceSettings>(loadSource)
  useEffect(() => {
    void loadDeviceTable().then(setTable, () => {})
  }, [])
  const { out, found } = useOutput(table)
  // a DAC saved for another output (the dongle, while on speakers) is set aside, not deleted, so it comes back with it
  const source = sourceFor(saved, out)
  // a detected DAC fills its output impedance (as the old app did); a hand pick stays until a new device shows up
  useEffect(() => {
    if (found?.kind !== 'dac' && found?.kind !== 'bt-adapter') return
    if (saved.auto === found.name && saved.forOutput === out?.label) return
    const next = { ...saved, outputOhm: found.outputOhm, auto: found.name, dacName: found.name, forOutput: out?.label }
    saveSource(next)
    setSourceState(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found])
  const dacs = useMemo(() => table?.dacs ?? [], [table])
  const pick = (name: string) => {
    const d = dacs.find((x) => x.name === name)
    const next = { ...saved, outputOhm: d?.outputOhm ?? null, dacName: d?.name, auto: undefined, forOutput: out?.label }
    saveSource(next)
    setSourceState(next)
  }
  const check = checkSource(source)
  const said = found ? describe(found) : null

  return (
    <section className="ms-set-section">
      <h3>Your source</h3>
      <div className={`ms-gear-source ${check.level}`}>
        <Icon name={check.level === 'ok' ? 'check_circle' : check.level === 'warn' ? 'warning' : 'info'} />
        <div className="grow">
          <b>{source.dacName ?? out?.label ?? 'Not detected'}</b>
          {said && <p className="ms-tz-note">{said.text}</p>}
          <BluetoothLine out={out} />
          <p className="ms-tz-note">{check.text}</p>
          <p className="ms-tz-note">
            Why it matters: measurements are made from a near-0 Ω source. A higher output impedance changes how multi-driver IEMs sound, so the
            simulation would be off by that much. It isn't about noise.{activeId ? '' : ' Set what you listen on above for a check against your IEM.'}
          </p>
        </div>
      </div>
      <DacPicker dacs={dacs} value={source.dacName ?? ''} onPick={pick} />
      <h3>DSP cable or plug</h3>
      {found?.kind === 'dsp' && <p className="ms-tz-note">Detected: <b>{found.entry.name}</b>.</p>}
      <DspNeutral />
    </section>
  )
}

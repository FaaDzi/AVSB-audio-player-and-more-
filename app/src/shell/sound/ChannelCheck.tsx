// Channel check (plan §78 E): swap L/R and balance steps that measure a per-band L/R offset.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui'
import { Slider } from '../PlayerBar'
import { loadHearing, LOUDEST_DB } from '../../hearing/hearing'
import { BALANCE_BANDS, combineRuns, runSpread, setChannels, useChannels } from './channels'

const newCtx = () => new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
const bandLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz))
const signed = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : '±'}${Math.abs(db).toFixed(1)}`

/** Left and right as gain nodes into a merger, swapped when the device says so (the test hears what music hears). */
export function stereoOut(ctx: AudioContext, swap: boolean) {
  const merger = ctx.createChannelMerger(2)
  const sides = [ctx.createGain(), ctx.createGain()] as const
  sides.forEach((g, ch) => g.connect(merger, 0, swap ? 1 - ch : ch))
  merger.connect(ctx.destination)
  return sides
}

/** The switch for the self-test: a reversed 2-pin/MMCX cable or mislabelled earpieces. */
export function SwapRow() {
  const ch = useChannels()
  return (
    <label className="ms-set-row toggle clickable">
      <Icon name="swap_horiz" />
      <span className="grow ms-set-text">Swap left and right<small>For this device, music and tests alike</small></span>
      <input type="checkbox" role="switch" className="ms-switch" checked={ch.swap} onChange={(e) => setChannels({ swap: e.target.checked })} />
    </label>
  )
}

export type Side = 0 | 1

/** Two ears that light up with the side now playing. */
export function Ears({ side, hz }: { side: Side | 'both' | null; hz?: string }) {
  return (
    <div className="ms-cc-ears" aria-live="polite">
      <span className={side === 0 || side === 'both' ? 'on' : ''}>L</span>
      <b>{hz ?? ''}</b>
      <span className={side === 1 || side === 'both' ? 'on' : ''}>R</span>
    </div>
  )
}

/** The ear part of an offset, from the hearing check: right threshold minus left (+ = the right ear needs more). */
function earDiff(hz: number): number | null {
  const h = loadHearing()
  if (!h) return null
  const f = hz as 1000 | 4000 | 8000
  if (!(f in h.thresholds.L)) return null
  const l = h.thresholds.L[f] ?? LOUDEST_DB + 10
  const r = h.thresholds.R[f] ?? LOUDEST_DB + 10
  return r - l
}

/** E2 balance steps: narrow-band noise alternates L/R per band; nudge until both sides sound equal. Two runs. */
export function BalanceSteps({ swap, headphones }: { swap: boolean; headphones: boolean }) {
  const ch = useChannels()
  const [run, setRun] = useState<0 | 1 | 2>(0) // 2 = results
  const [band, setBand] = useState(-1) // -1 = not started
  const [runs, setRuns] = useState<number[][]>([[], []])
  const [value, setValue] = useState(0)
  const [side, setSide] = useState<Side | null>(null)
  const valueRef = useRef(0)
  const audio = useRef<{ ctx: AudioContext; sides: readonly [GainNode, GainNode]; filter: BiquadFilterNode; base: number; iv: number } | null>(null)

  const close = () => {
    const a = audio.current
    if (!a) return
    window.clearInterval(a.iv)
    void a.ctx.close().catch(() => {})
    audio.current = null
    setSide(null)
  }
  useEffect(() => () => close(), [])

  // the right side gets +value/2, the left −value/2, so the pair keeps its loudness
  const levels = (base: number, db: number): [number, number] => [base * 10 ** (-db / 40), base * 10 ** (db / 40)]

  const play = (i: number, db: number) => {
    close()
    const ctx = newCtx()
    const sr = ctx.sampleRate
    const noise = ctx.createBuffer(1, sr * 2, sr)
    const d = noise.getChannelData(0)
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = BALANCE_BANDS[i]
    filter.Q.value = 4.32 // one third of an octave
    // the same loudness in every band: white noise's level in a band grows with the band's width
    const rms = 0.577 * Math.sqrt((BALANCE_BANDS[i] * 0.2316) / (sr / 2))
    const base = 0.03 / rms
    const sides = stereoOut(ctx, swap)
    src.connect(filter)
    sides.forEach((g) => { g.gain.value = 0; filter.connect(g) })
    src.start()
    valueRef.current = db
    let on: Side = 0
    const flip = () => {
      const [l, r] = levels(base, valueRef.current)
      const t = ctx.currentTime
      sides[0].gain.setTargetAtTime(on === 0 ? l : 0, t, 0.01)
      sides[1].gain.setTargetAtTime(on === 1 ? r : 0, t, 0.01)
      setSide(on)
      on = on === 0 ? 1 : 0
    }
    flip()
    const iv = window.setInterval(flip, 600)
    audio.current = { ctx, sides, filter, base, iv }
  }
  const nudge = (db: number) => {
    setValue(db)
    valueRef.current = db
  }

  const begin = (r: 0 | 1) => {
    setRun(r)
    setBand(0)
    nudge(0)
    play(0, 0)
  }
  const next = () => {
    const done = runs.map((x, i) => (i === run ? [...x.slice(0, band), value] : x))
    setRuns(done)
    if (band + 1 < BALANCE_BANDS.length) {
      setBand(band + 1)
      nudge(0)
      play(band + 1, 0)
      return
    }
    close()
    setBand(-1)
    setRun(run === 0 ? 1 : 2)
  }

  const result = run === 2 ? combineRuns(runs[0], runs[1]) : null
  const spread = run === 2 ? runSpread(runs[0], runs[1]) : 0
  const bars = result?.bands ?? ch.bands
  const max = Math.max(3, ...bars.map(Math.abs))

  return (
    <div className="ms-cc-card">
      <div className="ms-cc-head">
        <Icon name="balance" />
        <b className="grow">Channel balance{band >= 0 ? ` · run ${run + 1} of 2` : ''}</b>
        {band < 0 && run !== 1 && (
          <button type="button" className="ms-btn tonal" onClick={() => { setRuns([[], []]); begin(0) }}>
            <Icon name="play_arrow" size={18} /> {ch.bands.length ? 'Measure again' : 'Start'}
          </button>
        )}
      </div>

      <div className="ms-cc-bands">
        {BALANCE_BANDS.map((hz, i) => {
          const v = band >= 0 ? (i < band ? runs[run][i] : i === band ? value : null) : bars[i] ?? null
          return (
            <div key={hz} className={`ms-cc-band${i === band ? ' now' : ''}`}>
              <div className="ms-cc-bar">
                {v !== null && v !== undefined && <i style={{ '--h': `${(Math.abs(v) / max) * 50}%`, '--up': v >= 0 ? 1 : 0 } as React.CSSProperties} />}
              </div>
              <small>{bandLabel(hz)}</small>
              <b>{v !== null && v !== undefined ? signed(v) : '·'}</b>
            </div>
          )
        })}
      </div>

      {band >= 0 && (
        <>
          <Ears side={side} hz={`${bandLabel(BALANCE_BANDS[band])}Hz`} />
          <Slider thick label="Right side compared with left" min={-12} max={12} step={0.5} value={value} onChange={nudge} />
          <div className="ms-cc-actions">
            <span className="grow ms-value">{value === 0 ? 'Even' : `Right ${signed(value)} dB`}</span>
            <button type="button" className="ms-btn text" onClick={() => { close(); setBand(-1); setRun(0) }}>Cancel</button>
            <button type="button" className="ms-btn primary" onClick={next}>
              {band + 1 < BALANCE_BANDS.length ? 'Sounds equal' : 'Done'}
            </button>
          </div>
        </>
      )}

      {band < 0 && run === 1 && (
        <div className="ms-cc-actions">
          <Icon name="hearing" />
          <span className="grow">Take {headphones ? 'the headphones off and put them back on' : 'both earpieces out and seat them again'}</span>
          <button type="button" className="ms-btn primary" onClick={() => begin(1)}>Run 2</button>
        </div>
      )}

      {result && (
        <>
          <div className="ms-cc-sum">
            <div><small>Overall</small><b>{signed(result.balanceDb)} dB</b></div>
            <div className={spread > 3 ? 'warn' : ''}><small>Runs differ</small><b>{spread.toFixed(1)} dB</b></div>
            {[1000, 4000, 8000].some((f) => earDiff(f) !== null) && (
              <div><small>Your ears</small><b>{signed(earDiff(1000) ?? 0)} dB</b></div>
            )}
          </div>
          {spread > 3 && <p className="ms-tz-note danger">The two runs differ a lot: the fit moved. Re-seat and measure again.</p>}
          {headphones && <p className="ms-tz-note">Turn them round and measure again: an offset that flips with the cups is the headphones.</p>}
          <div className="ms-cc-actions">
            <span className="grow" />
            <button type="button" className="ms-btn text" onClick={() => setRun(0)}>Discard</button>
            <button type="button" className="ms-btn primary" onClick={() => { setChannels({ balanceDb: result.balanceDb, bands: result.bands }); setRun(0) }}>
              Use it
            </button>
          </div>
        </>
      )}

      {band < 0 && run === 0 && (ch.balanceDb !== 0 || ch.bands.length > 0) && (
        <>
          <label className="ms-set-row toggle clickable">
            <Icon name="tune" />
            <span className="grow ms-set-text">Correct each band<small>Separate left and right curves instead of one level</small></span>
            <input type="checkbox" role="switch" className="ms-switch" checked={ch.perBand} disabled={ch.bands.length !== BALANCE_BANDS.length} onChange={(e) => setChannels({ perBand: e.target.checked })} />
          </label>
          <div className="ms-cc-actions">
            <span className="grow ms-value">In use: right {signed(ch.balanceDb)} dB</span>
            <button type="button" className="ms-btn text" onClick={() => setChannels({ balanceDb: 0, bands: [], perBand: false })}>Reset</button>
          </div>
        </>
      )}
    </div>
  )
}

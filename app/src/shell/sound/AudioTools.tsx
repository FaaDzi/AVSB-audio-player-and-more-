// Audio Tools (plan §79 A): one card per job, nothing twice. Fit & seal (sweep, L⇄R sweep, 25/50 Hz seal, ear tips),
// Left, right & phase (L / centre / R, out of phase, polarity, swap) and Channel balance (§78 E balance steps).
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui'
import { useShell } from '../context'
import { useGear } from './gear'
import { isHeadphoneDevice, isSoundbarDevice } from './gearProfiles'
import { BalanceSteps, Ears, stereoOut, SwapRow, type Side } from './ChannelCheck'
import { getChannels, useChannels } from './channels'

const newCtx = () => new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
const hzLabel = (hz: number) => `${hz < 1000 ? hz : (hz / 1000).toFixed(hz < 10000 ? 1 : 0) + 'k'} Hz`

/** A short sine at a hearing level (0–75 dB HL → −56…−8 dBFS), to one ear, both, or both with the right inverted. */
export function playDiagnosticTone(opts: { hz: number; dbHl: number; ear: 'left' | 'right' | 'both' | 'out-of-phase'; durationSec?: number }): () => void {
  const ctx = newCtx()
  const dur = opts.durationSec ?? 0.85
  const dbfs = -56 + (Math.max(0, Math.min(75, opts.dbHl)) / 75) * 48
  const peak = 10 ** (dbfs / 20)
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = opts.hz
  const env = ctx.createGain()
  const now = ctx.currentTime
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(peak, now + 0.035)
  env.gain.setValueAtTime(peak, now + dur - 0.045)
  env.gain.linearRampToValueAtTime(0, now + dur)
  const merger = ctx.createChannelMerger(2)
  const gL = ctx.createGain()
  const gR = ctx.createGain()
  gL.gain.value = opts.ear === 'right' ? 0 : 1
  gR.gain.value = opts.ear === 'left' ? 0 : opts.ear === 'out-of-phase' ? -1 : 1
  osc.connect(env)
  env.connect(gL)
  env.connect(gR)
  gL.connect(merger, 0, 0)
  gR.connect(merger, 0, 1)
  merger.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + dur + 0.02)
  const timer = window.setTimeout(() => void ctx.close().catch(() => {}), (dur + 0.1) * 1000)
  return () => {
    window.clearTimeout(timer)
    void ctx.close().catch(() => {})
  }
}

type FitMode = 'sweep' | 'alt' | 'seal'
const FIT_MODES: [FitMode, string][] = [['sweep', 'Sweep'], ['alt', 'Sweep L ⇄ R'], ['seal', '25 ⇄ 50 Hz']]
const FIT_HINT: Record<FitMode, string> = {
  sweep: 'Even all the way up; a sharp peak around 6–9 kHz is your ear canal, not the device.',
  alt: 'Both sides alike at every pitch. A weak or missing side shows at once.',
  seal: 'With a good seal 25 Hz feels as full as 50 Hz. If 25 Hz vanishes, the tips leak.',
}

const TIP_MATERIAL = { Silicone: [0, 'Clear treble'], Foam: [1.5, 'Softer peaks'], Liquid: [1, 'Firm sub-bass'] } as const
const TIP_DEPTH = { Shallow: 6.4, Standard: 7.5, Deep: 8.8 } as const
const TIP_SEAL = { Sealed: 0, 'Small leak': -6, 'No seal': -15 } as const

function Seg<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ms-tz-seg ms-at-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  )
}

function FitSealCard() {
  const { go } = useShell()
  const [mode, setMode] = useState<FitMode>('sweep')
  const [hz, setHz] = useState<number | null>(null)
  const [side, setSide] = useState<Side | null>(null)
  const [material, setMaterial] = useState<keyof typeof TIP_MATERIAL>('Silicone')
  const [depth, setDepth] = useState<keyof typeof TIP_DEPTH>('Standard')
  const [seal, setSeal] = useState<keyof typeof TIP_SEAL>('Sealed')
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setHz(null)
    setSide(null)
  }
  const start = () => {
    stop()
    const ctx = newCtx()
    const osc = ctx.createOscillator()
    const sides = stereoOut(ctx, getChannels().swap)
    const now = ctx.currentTime + 0.05
    sides.forEach((g) => osc.connect(g))
    let iv: number
    if (mode === 'seal') {
      osc.frequency.value = 25
      sides.forEach((g) => (g.gain.value = 0.22))
      let low = true
      setHz(25)
      iv = window.setInterval(() => {
        low = !low
        osc.frequency.setTargetAtTime(low ? 25 : 50, ctx.currentTime, 0.015)
        setHz(low ? 25 : 50)
      }, 850)
      osc.start()
    } else {
      const dur = mode === 'alt' ? 24 : 12
      const half = 0.5
      osc.frequency.setValueAtTime(20, now)
      osc.frequency.exponentialRampToValueAtTime(20000, now + dur)
      sides.forEach((g, ch) => {
        g.gain.setValueAtTime(0, ctx.currentTime)
        if (mode === 'alt') for (let t = 0, i = 0; t < dur; t += half, i++) g.gain.setTargetAtTime(i % 2 === ch ? 0.06 : 0, now + t, 0.008)
        else g.gain.setTargetAtTime(0.06, now, 0.01)
        g.gain.setTargetAtTime(0, now + dur, 0.008)
      })
      osc.start(now)
      osc.stop(now + dur + 0.1)
      const t0 = performance.now()
      iv = window.setInterval(() => {
        const s = (performance.now() - t0) / 1000
        if (s >= dur) { stop(); return }
        if (mode === 'alt') setSide((Math.floor(s / half) % 2) as Side)
        setHz(Math.round(20 * 1000 ** (s / dur)))
      }, 50)
    }
    stopRef.current = () => {
      window.clearInterval(iv)
      void ctx.close().catch(() => {})
    }
  }

  const running = hz !== null
  const [boost, sound] = TIP_MATERIAL[material]
  const leak = TIP_SEAL[seal]
  return (
    <div className="ms-cc-card">
      <div className="ms-cc-head">
        <Icon name="graphic_eq" />
        <b className="grow">Fit &amp; seal</b>
        <button type="button" className={`ms-btn ${running ? 'primary' : 'tonal'}`} onClick={running ? stop : start}>
          <Icon name={running ? 'stop' : 'play_arrow'} size={18} /> {running ? 'Stop' : 'Play'}
        </button>
      </div>
      <Seg label="Test" options={FIT_MODES.map(([, l]) => l)} value={FIT_MODES.find(([m]) => m === mode)![1]} onChange={(l) => { stop(); setMode(FIT_MODES.find(([, x]) => x === l)![0]) }} />
      <Ears side={running ? (mode === 'alt' ? side : 'both') : null} hz={hz !== null ? hzLabel(hz) : mode === 'seal' ? '25 ⇄ 50 Hz' : '20 Hz – 20 kHz'} />
      <p className="ms-tz-note tight">{FIT_HINT[mode]}</p>
      <div className="ms-at-tips">
        <div className="ms-at-tips-head">
          <Icon name="earbuds" size={18} />
          <b className="grow">Ear tips</b>
          <button type="button" className="ms-btn text" onClick={() => go({ page: 'database', kind: 'tips' })}>
            Browse ear tips <Icon name="chevron_right" size={18} />
          </button>
        </div>
        <Seg label="Tip material" options={Object.keys(TIP_MATERIAL) as (keyof typeof TIP_MATERIAL)[]} value={material} onChange={setMaterial} />
        <Seg label="Insertion depth" options={Object.keys(TIP_DEPTH) as (keyof typeof TIP_DEPTH)[]} value={depth} onChange={setDepth} />
        <Seg label="Seal" options={Object.keys(TIP_SEAL) as (keyof typeof TIP_SEAL)[]} value={seal} onChange={setSeal} />
        <div className="ms-cc-sum">
          <div><small>Canal peak</small><b>{TIP_DEPTH[depth]} kHz</b></div>
          <div><small>Bass</small><b>{leak + boost > 0 ? '+' : leak + boost < 0 ? '−' : '±'}{Math.abs(leak + boost)} dB</b></div>
          <div><small>Sound</small><b className="ms-at-word">{sound}</b></div>
        </div>
      </div>
    </div>
  )
}

type Test = 'left' | 'center' | 'right' | 'oop' | 'polarity'
const TEST_HINT: Record<Test, string> = {
  left: 'Only the left ear. Heard on the right? The cable or earpieces are swapped.',
  right: 'Only the right ear. Heard on the left? The cable or earpieces are swapped.',
  center: 'Dead centre, between your eyes.',
  oop: 'Wide and hollow, pulled to the sides. If it sounds centred, one 2-pin plug is in backwards.',
  polarity: 'Clicks that push into the ear. Compare two devices: the same click should feel the same.',
}

function polarityPulses(): () => void {
  const ctx = newCtx()
  const sr = ctx.sampleRate
  const buf = ctx.createBuffer(2, sr, sr)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let p = 0; p < 8; p++) {
      const start = Math.floor(p * 0.12 * sr)
      for (let i = 0; i < 120 && start + i < data.length; i++) {
        const t = i / 120
        data[start + i] = Math.exp(-t * 6) * Math.cos(2 * Math.PI * 2 * t) * 0.35
      }
    }
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  const timer = window.setTimeout(() => void ctx.close().catch(() => {}), 1050)
  return () => {
    window.clearTimeout(timer)
    void ctx.close().catch(() => {})
  }
}

function ChannelsCard() {
  const [active, setActive] = useState<Test | null>(null)
  const [hint, setHint] = useState<Test>('left')
  const stopRef = useRef<(() => void) | null>(null)
  const timer = useRef(0)
  useChannels() // re-render when swap changes
  useEffect(() => () => { stopRef.current?.(); window.clearTimeout(timer.current) }, [])

  const run = (t: Test) => {
    stopRef.current?.()
    window.clearTimeout(timer.current)
    if (active === t) { setActive(null); return }
    setActive(t)
    setHint(t)
    if (t === 'polarity') {
      stopRef.current = polarityPulses()
    } else {
      const ear = t === 'center' ? 'both' : t === 'oop' ? 'out-of-phase' : t
      // with L/R swapped for this device, the test hears what the music hears
      const heard = getChannels().swap && (ear === 'left' || ear === 'right') ? (ear === 'left' ? 'right' : 'left') : ear
      stopRef.current = playDiagnosticTone({ hz: t === 'left' || t === 'right' ? 440 : 220, dbHl: 50, ear: heard, durationSec: 1.4 })
    }
    timer.current = window.setTimeout(() => setActive(null), t === 'polarity' ? 1050 : 1400)
  }

  const ear = (t: 'left' | 'center' | 'right', label: string) => (
    <button type="button" className={active === t ? 'on' : ''} aria-pressed={active === t} onClick={() => run(t)}>{label}</button>
  )
  return (
    <div className="ms-cc-card">
      <div className="ms-cc-head">
        <Icon name="headphones" />
        <b className="grow">Left, right &amp; phase</b>
      </div>
      <div className="ms-cc-ears ms-at-ears">
        {ear('left', 'L')}
        {ear('center', 'C')}
        {ear('right', 'R')}
      </div>
      <div className="ms-at-row">
        <button type="button" className={`ms-btn ${active === 'oop' ? 'primary' : 'tonal'}`} onClick={() => run('oop')}>
          <Icon name="swap_horiz" size={18} /> Out of phase
        </button>
        <button type="button" className={`ms-btn ${active === 'polarity' ? 'primary' : 'tonal'}`} onClick={() => run('polarity')}>
          <Icon name="bolt" size={18} /> Polarity
        </button>
      </div>
      <p className="ms-tz-note tight">{TEST_HINT[hint]}</p>
      {!isSoundbarDevice(useGear().active) && <SwapRow />}
    </div>
  )
}

export function AudioToolsPage() {
  const active = useGear().active
  const headphones = isHeadphoneDevice(active)
  const { swap } = useChannels()
  return (
    <section className="ms-set-section">
      <div className="ms-cc ms-at">
        <FitSealCard />
        <ChannelsCard />
        {!isSoundbarDevice(active) && <BalanceSteps swap={swap} headphones={headphones} />}
      </div>
    </section>
  )
}

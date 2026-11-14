// Temporary page for checking audio changes by ear, with a meter beside them. Dev server only: /shell-listen.html
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GalleryPlayer } from '../../audio/galleryPlayer'
import { measureLoudness, setSmartVolumeOn } from '../../audio/smartVolume'
import { audioUrl, levelForTarget } from '../engine'
import { albumLevel } from '../level'
import { mixEffectFrom, mixSeconds } from '../mix'
import type { LibraryData, Track } from '../library'

const LEAD_IN_S = 8
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity)

interface Measured { peakDb: number; overs: number; quietestDb: number }

/** For checks by script: level and high-frequency content over time, and when the second song took over. */
const trace: { t: number; rms: number; high: number; peak: number }[] = []
Object.assign(window, { listenTrace: trace })

let ctx: AudioContext | null = null
let player: GalleryPlayer | null = null
const decoded = new Map<string, AudioBuffer>()

function getPlayer() {
  ctx ??= new AudioContext({ latencyHint: 'playback' })
  player ??= new GalleryPlayer(ctx)
  Object.assign(window, { listenPlayer: player, listenCtx: ctx })
  return player
}

async function bufferOf(t: Track) {
  const found = decoded.get(t.id)
  if (found) return found
  getPlayer()
  const bytes = await (await fetch(audioUrl(t))).arrayBuffer()
  const buffer = await (ctx as AudioContext).decodeAudioData(bytes)
  decoded.set(t.id, buffer)
  return buffer
}

/** The first part of a song, so it's still loud when the blend starts. Many songs fade out, which hides the effect. */
function cutHalfway(b: AudioBuffer) {
  const length = Math.floor(b.length * 0.6)
  const cut = new AudioBuffer({ length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate })
  for (let i = 0; i < b.numberOfChannels; i++) cut.copyToChannel(b.getChannelData(i).subarray(0, length), i)
  return cut
}

const channels = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))

function Listen() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [seconds, setSeconds] = useState(6)
  const [pitch, setPitch] = useState(2)
  const [speed, setSpeed] = useState(1)
  const [echo, setEcho] = useState(true)
  const [lowPass, setLowPass] = useState(true)
  const [cut, setCut] = useState(true)
  const [balance, setBalance] = useState(0)
  const [boost, setBoost] = useState(12)
  const [preamp, setPreamp] = useState(0)
  const [limiter, setLimiter] = useState(true)
  const [headroom, setHeadroom] = useState(true)
  const [squeeze, setSqueeze] = useState(false)
  const [threshold, setThreshold] = useState(-18)
  const [ratio, setRatio] = useState(3)
  const [status, setStatus] = useState('Pick two songs, then press a button.')
  const [meter, setMeter] = useState<Measured>({ peakDb: -Infinity, overs: 0, quietestDb: Infinity })
  const measuring = useRef<Measured>({ peakDb: -Infinity, overs: 0, quietestDb: Infinity })

  useEffect(() => {
    void fetch('/shell-host/library').then((r) => r.json() as Promise<LibraryData>).then((d) => {
      const list = [...d.tracks].sort((x, y) => x.title.localeCompare(y.title))
      setTracks(list)
      setA(list[0].id)
      setB(list[1].id)
    })
    const id = window.setInterval(() => {
      if (!player?.playing) return
      const samples = new Float32Array(player.analyser.fftSize)
      player.analyser.getFloatTimeDomainData(samples)
      let peak = 0
      let sum = 0
      for (const s of samples) {
        peak = Math.max(peak, Math.abs(s))
        sum += s * s
      }
      const m = measuring.current
      measuring.current = { peakDb: Math.max(m.peakDb, db(peak)), overs: m.overs + (peak >= 1 ? 1 : 0), quietestDb: Math.min(m.quietestDb, db(Math.sqrt(sum / samples.length))) }
      setMeter(measuring.current)
      const bins = new Float32Array(player.analyser.frequencyBinCount)
      player.analyser.getFloatFrequencyData(bins)
      const hz = (i: number) => (i * (ctx as AudioContext).sampleRate) / player!.analyser.fftSize
      let high = 0
      let count = 0
      bins.forEach((v, i) => { if (hz(i) > 3000) { high += v; count++ } })
      trace.push({ t: performance.now(), rms: db(Math.sqrt(sum / samples.length)), high: high / count, peak: db(peak) })
      ;(window as unknown as { listenMeter: Measured }).listenMeter = measuring.current
    }, 50)
    return () => window.clearInterval(id)
  }, [])

  const find = (id: string) => tracks.find((t) => t.id === id) as Track

  const transition = async (name: string) => {
    setStatus(`Loading for ${name}...`)
    const p = getPlayer()
    p.pause()
    const [whole, to] = await Promise.all([bufferOf(find(a)), bufferOf(find(b))])
    const from = cut ? cutHalfway(whole) : whole
    const values: Record<string, unknown> = { transition: name, mixpitch: pitch, mixspeed: speed, mixecho: echo, mixlowpass: lowPass }
    const overlap = mixSeconds(from.duration, to.duration, seconds)
    p.setBuffer(from, measureLoudness(channels(from), from.sampleRate))
    p.seek(Math.max(0, from.duration - overlap - LEAD_IN_S))
    p.queueNext(to, measureLoudness(channels(to), to.sampleRate), overlap, mixEffectFrom((id) => values[id]))
    measuring.current = { peakDb: -Infinity, overs: 0, quietestDb: Infinity }
    trace.length = 0
    p.onAdvance = () => Object.assign(window, { listenAdvanced: performance.now() })
    Object.assign(window, { listenStarted: performance.now(), listenAdvanced: 0 })
    p.play()
    setStatus(`${name}: ${LEAD_IN_S} s of the first song, then a ${overlap.toFixed(0)} s blend`)
    ;(window as unknown as { listenAt: unknown }).listenAt = { name, overlap, startsIn: LEAD_IN_S }
  }

  const loudness = async (mode: 'off' | 'track' | 'album') => {
    setStatus('Measuring...')
    const p = getPlayer()
    p.pause()
    const t = find(a)
    const buffer = await bufferOf(t)
    const own = measureLoudness(channels(buffer), buffer.sampleRate)
    setSmartVolumeOn(mode !== 'off')
    let level = own
    if (mode === 'album') {
      const album = tracks.filter((x) => x.album && x.album === t.album && x.albumArtist === t.albumArtist).slice(0, 6)
      const levels = await Promise.all(album.map(async (x) => {
        const other = await bufferOf(x)
        return measureLoudness(channels(other), other.sampleRate)
      }))
      level = albumLevel([own, ...levels]) ?? own
      setStatus(`Album: ${album.length} songs measured, album level ${level.lufs.toFixed(1)} LUFS, this song ${own.lufs.toFixed(1)} LUFS`)
    } else setStatus(`${mode}: this song is ${own.lufs.toFixed(1)} LUFS`)
    p.setBuffer(buffer, levelForTarget(level, 0))
    p.seek(Math.min(30, buffer.duration / 3))
    measuring.current = { peakDb: -Infinity, overs: 0, quietestDb: Infinity }
    p.play()
  }

  const eqOn = useRef(false)
  // a change to any switch reaches a song that's already playing
  useEffect(() => {
    if (!player || !eqOn.current) return
    player.setDynamics({ headroom, limiter, limitAlways: true, compressor: squeeze ? { threshold, ratio, attack: 10, release: 150 } : null })
    player.setCustom([boost, boost, boost * 0.5, 0, 0, 0, 0, 0, 0, 0])
    player.setVolume(10 ** (preamp / 20))
    measuring.current = { peakDb: -Infinity, overs: 0, quietestDb: Infinity }
    trace.length = 0
  }, [boost, preamp, limiter, headroom, squeeze, threshold, ratio])

  const playEq = async () => {
    setStatus('Loading...')
    const p = getPlayer()
    p.pause()
    const buffer = await bufferOf(find(a))
    setSmartVolumeOn(false)
    eqOn.current = true
    p.setDynamics({ headroom, limiter, limitAlways: true, compressor: squeeze ? { threshold, ratio, attack: 10, release: 150 } : null })
    p.setCustom([boost, boost, boost * 0.5, 0, 0, 0, 0, 0, 0, 0])
    p.setVolume(10 ** (preamp / 20))
    p.setBuffer(buffer, measureLoudness(channels(buffer), buffer.sampleRate))
    p.seek(Math.min(40, buffer.duration / 3))
    measuring.current = { peakDb: -Infinity, overs: 0, quietestDb: Infinity }
    trace.length = 0
    p.play()
    setStatus('Equalizer: playing the first song. Flip the switches while it plays.')
  }

  const songPicker = (label: string, value: string, set: (id: string) => void) => (
    <label style={{ display: 'block', margin: '8px 0' }}>{label}{' '}
      <select value={value} onChange={(e) => set(e.target.value)} style={{ maxWidth: 560 }}>
        {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}{t.album ? ` (${t.album})` : ''}</option>)}
      </select>
    </label>
  )

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '24px auto', lineHeight: 1.5 }}>
      <h1>Listening test (temporary)</h1>
      {songPicker('First song', a, setA)}
      {songPicker('Second song', b, setB)}

      <h2>Transitions</h2>
      <p>Plays the end of the first song into the second. Listen for clicks, gaps, and whether each effect sounds right.</p>
      <label><input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} /> Cut the first song mid-way, so the effect is easy to hear</label><br />
      <label>Blend length: {seconds} s <input type="range" min={3} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></label><br />
      <label>Pitch: {pitch} semitones <input type="range" min={-6} max={6} step={0.5} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} /></label><br />
      <label>Custom speed: {speed.toFixed(2)}× <input type="range" min={0.8} max={1.2} step={0.01} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label><br />
      <label><input type="checkbox" checked={echo} onChange={(e) => setEcho(e.target.checked)} /> Custom: echo</label>{' '}
      <label><input type="checkbox" checked={lowPass} onChange={(e) => setLowPass(e.target.checked)} /> Custom: low-pass</label>
      <p>{['Crossfade', 'Muffled', 'Echo', 'Pitch', 'Custom'].map((n) => <button key={n} type="button" data-test={n} onClick={() => void transition(n)} style={{ marginRight: 8, padding: '8px 16px' }}>{n}</button>)}</p>

      <h2>Loudness</h2>
      <p>Plays the first song. Compare levels by switching, and pick a song with an album for Album.</p>
      <p>{(['off', 'track', 'album'] as const).map((m) => <button key={m} type="button" data-test={m} onClick={() => void loudness(m)} style={{ marginRight: 8, padding: '8px 16px' }}>{m === 'off' ? 'Normalization off' : m === 'track' ? 'Track gain' : 'Album gain'}</button>)}</p>

      <h2>Equalizer</h2>
      <p>A heavy bass boost, so the switches have something to do. Press play, then flip them while it plays and watch Clipped moments.</p>
      <label>Bass boost: +{boost} dB <input type="range" min={0} max={18} value={boost} onChange={(e) => setBoost(Number(e.target.value))} /></label><br />
      <label>Preamp: {preamp} dB <input type="range" min={-24} max={12} value={preamp} onChange={(e) => setPreamp(Number(e.target.value))} /></label><br />
      <label><input type="checkbox" data-test="headroom" checked={headroom} onChange={(e) => setHeadroom(e.target.checked)} /> Automatic headroom</label>{' '}
      <label><input type="checkbox" data-test="limiter" checked={limiter} onChange={(e) => setLimiter(e.target.checked)} /> Peak limiter</label>{' '}
      <label><input type="checkbox" data-test="compressor" checked={squeeze} onChange={(e) => setSqueeze(e.target.checked)} /> Compressor</label><br />
      <label>Threshold: {threshold} dB <input type="range" min={-60} max={0} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label><br />
      <label>Ratio: {ratio}:1 <input type="range" min={1} max={20} step={0.5} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} /></label>
      <p><button type="button" data-test="playeq" onClick={() => void playEq()} style={{ padding: '8px 16px' }}>Play with the equalizer</button></p>

      <h2>Channels (§78 E)</h2>
      <p>Play anything above, then swap the sides or tilt the balance. The balance follows the ear when swapped.</p>
      <label><input type="checkbox" data-test="swap" onChange={(e) => getPlayer().setSwap(e.target.checked)} /> Swap left and right</label><br />
      <label>Right side: {balance > 0 ? '+' : ''}{balance} dB <input type="range" min={-12} max={12} step={0.5} value={balance} onChange={(e) => { setBalance(Number(e.target.value)); getPlayer().setBalance(Number(e.target.value)) }} /></label>

      <p><button type="button" onClick={() => player?.pause()} style={{ padding: '8px 16px' }}>Stop</button></p>
      <h2>Meter</h2>
      <p data-test="status">{status}</p>
      <p>Peak {meter.peakDb.toFixed(1)} dBFS · Clipped moments {meter.overs} · Quietest moment {meter.quietestDb.toFixed(1)} dB</p>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Listen />)

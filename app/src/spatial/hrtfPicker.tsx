import { useMusicHold } from '../audio/duck'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pinkNoise } from '../audio/noise'
import { AbCards, RoundDots } from '../components/AbCards'
import { sfx } from '../audio/sfx'
import { measureLoudness, songGainDb } from '../audio/smartVolume'
import type { LibrarySong, SongManifest } from '../songs/library'
import { createRoundSource } from '../songs/rounds'
import { loadHrirIndex, loadHrirSet, type HrirIndexEntry } from './hrir'
import { IMPORTED_ID, loadStoredHrir } from './hrirStore'
import { answerHrtf, hrtfPair, hrtfProgress, startHrtfTest, twoRounds, type HrtfTest } from './knockout'
import { updateSpatial } from './settings'
import { SpatialStage } from './stage'
import type { HrirSet } from './types'
import { speakerOut } from '../audio/speakerGuard'

const SWITCH_S = 0.03

/**
 * The picker's own little graph: one looping clip into two spatial stages (virtual speakers), one
 * per candidate, and a crossfade between them for the blind A/B. The stages level-match themselves,
 * so neither side wins by being louder.
 */
class PickerAudio {
  private ctx: AudioContext
  private input: GainNode
  private stages: [SpatialStage, SpatialStage]
  private gains: [GainNode, GainNode]
  private out: DynamicsCompressorNode
  private src: AudioBufferSourceNode | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.out = ctx.createDynamicsCompressor()
    this.out.threshold.value = -1
    this.out.knee.value = 2
    this.out.ratio.value = 20
    this.stages = [new SpatialStage(ctx), new SpatialStage(ctx)]
    this.gains = [ctx.createGain(), ctx.createGain()]
    this.stages.forEach((s, i) => {
      s.setMode('speakers')
      this.gains[i].gain.value = i === 0 ? 1 : 0
      this.input.connect(s.input)
      s.output.connect(this.gains[i]).connect(this.out)
    })
    this.out.connect(speakerOut(ctx))
  }

  get playing() {
    return !!this.src
  }

  setSets(a: HrirSet, b: HrirSet) {
    this.stages[0].setHrir(a)
    this.stages[1].setHrir(b)
  }

  select(i: number) {
    const t = this.ctx.currentTime
    this.gains.forEach((g, j) => {
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(i === j ? 1 : 0, t + SWITCH_S)
    })
  }

  play(buffer: AudioBuffer, levelDb: number) {
    this.stop()
    void this.ctx.resume()
    this.input.gain.value = 10 ** (levelDb / 20)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.connect(this.input)
    src.start()
    this.src = src
  }

  stop() {
    if (!this.src) return
    try {
      this.src.stop()
    } catch {
      /* already stopped */
    }
    this.src.disconnect()
    this.src = null
  }

  dispose() {
    this.stop()
    this.out.disconnect()
  }
}

interface Clip {
  buffer: AudioBuffer
  title: string
  levelDb: number
}

/** Mono pink noise: one phantom source straight ahead, the easiest thing to judge "in front" on. */
/** Both channels as their average: the song as one source in the middle. */
function monoClip(b: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({ length: b.length, numberOfChannels: 2, sampleRate: b.sampleRate })
  const mid = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) {
    const ch = b.getChannelData(c)
    for (let i = 0; i < b.length; i++) mid[i] += ch[i] / b.numberOfChannels
  }
  out.copyToChannel(mid, 0)
  out.copyToChannel(mid, 1)
  return out
}

function noiseClip(ctx: AudioContext): AudioBuffer {
  const buf = pinkNoise(ctx, 10)
  buf.copyToChannel(buf.getChannelData(0), 1)
  return buf
}

export interface HrtfPickerProps {
  /** Any app player: its context is used and it is paused while the picker plays. */
  player: { ctx: AudioContext; pause(): void }
  /** Songs for the clip; empty → pink noise. */
  library: LibrarySong[]
  manifest: SongManifest
  /** The saved SpatialSettings.hrirId. */
  hrirId: string
  /** Called after the picker has saved a new id with updateSpatial. */
  onPick: (id: string) => void
  /** §107 G: a clip of one of your songs (a different one per attempt); null → pink noise. Used over `library`. */
  loadClip?: (attempt: number) => Promise<{ buffer: AudioBuffer; title: string } | null>
}

/**
 * Pick your HRTF by ear (plan §32 phase 3): the same clip through the virtual speakers with two
 * HRTF sets, blind as A and B, in a knockout over the bundled candidates (plus your import); the
 * winner becomes yours. An imported SOFA file (imported under the HRTF list) takes part too.
 */
export function HrtfPicker(props: HrtfPickerProps) {
  const { player, hrirId } = props
  const [index, setIndex] = useState<HrirIndexEntry[] | null>(null)
  const [imported, setImported] = useState<HrirSet | null>(null)
  /** §108: the test's rounds (knockout.ts `HrtfTest`); null before Start and after Keep current. */
  const [test, setTest] = useState<HrtfTest | null>(null)
  const [flip, setFlip] = useState(false)
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  useMusicHold(playing || test !== null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ winner: string; previous: string } | null>(null)
  // §107: what the test plays; your songs when there are some to play
  const [sound, setSound] = useState<'music' | 'noise'>('music')
  const audio = useRef<PickerAudio | null>(null)

  useEffect(() => {
    loadHrirIndex().then(setIndex, (e) => setError(String(e?.message ?? e)))
    loadStoredHrir(IMPORTED_ID).then(setImported, () => setImported(null))
    return () => {
      audio.current?.dispose()
      audio.current = null
    }
  }, [])

  const entries = useMemo(() => {
    const list = index ? [...index] : []
    if (imported) list.push({ id: IMPORTED_ID, name: imported.name, source: imported.source })
    return list
  }, [index, imported])
  const nameOf = (id: string) => entries.find((e) => e.id === id)?.name ?? id
  const plan = useMemo(() => twoRounds(entries), [entries])
  const current = entries.find((e) => e.id === hrirId)

  const source = useMemo(
    () => createRoundSource({ ctx: player.ctx, library: props.library, manifest: props.manifest, heardBy: {}, entrants: ['hrtf-a', 'hrtf-b'] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, props.library],
  )

  // the clip: one song for the whole bracket ("Another song" swaps it)
  const running = !!test && !test.winner
  useEffect(() => {
    if (!running) return
    let cancelled = false
    setClip(null)
    const done = (buffer: AudioBuffer, title: string) => {
      if (cancelled) return
      // §108: music folded to mono, one source straight ahead like the pink noise: "in front" is easier to judge
      if (buffer.numberOfChannels > 1) buffer = monoClip(buffer)
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
      setClip({ buffer, title, levelDb: songGainDb(measureLoudness(chans, buffer.sampleRate)) })
    }
    if (sound === 'noise') done(noiseClip(player.ctx), 'Pink noise')
    else if (props.loadClip) {
      props.loadClip(attempt).then(
        (c) => (c ? done(c.buffer, c.title) : done(noiseClip(player.ctx), 'Pink noise')),
        (e) => !cancelled && setError(String(e?.message ?? e)),
      )
    } else if (!props.library.length) done(noiseClip(player.ctx), 'Pink noise')
    else source.getRound(0, attempt).then((a) => done(a.buffer, a.title), (e) => !cancelled && setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, attempt, source, sound])

  // keep playing the new clip if the old one was playing
  useEffect(() => {
    if (clip && audio.current?.playing) audio.current.play(clip.buffer, clip.levelDb)
  }, [clip])

  // load the pair's sets into the two stages: A is pair[flip ? 1 : 0]
  const pair = test ? hrtfPair(test) : null
  const pairKey = pair ? `${pair[0]}|${pair[1]}|${flip}` : ''
  useEffect(() => {
    if (!pair) return
    let cancelled = false
    setReady(false)
    Promise.all([loadHrirSet(pair[flip ? 1 : 0]), loadHrirSet(pair[flip ? 0 : 1])]).then(
      ([a, b]) => {
        if (cancelled) return
        audio.current?.setSets(a, b)
        setReady(true)
      },
      (e) => !cancelled && setError(String(e?.message ?? e)),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey])

  const stopAudio = () => {
    audio.current?.stop()
    setPlaying(false)
  }

  const save = (id: string) => {
    updateSpatial({ hrirId: id })
    props.onPick(id)
  }

  const start = () => {
    if (entries.length < 2) return
    sfx.playStamp()
    player.pause()
    audio.current ??= new PickerAudio(player.ctx)
    audio.current.select(0)
    setActive(0)
    setFlip(Math.random() < 0.5)
    setError(null)
    setResult(null)
    setTest(startHrtfTest(plan))
  }

  const toggle = () => {
    if (!clip || !audio.current) return
    if (audio.current.playing) stopAudio()
    else {
      player.pause()
      audio.current.play(clip.buffer, clip.levelDb)
      setPlaying(true)
    }
  }

  const hear = (i: number) => {
    audio.current?.select(i)
    setActive(i)
  }

  /** Card `i` was picked, or null for "Same". */
  const answer = (i: number | null) => {
    if (!test || !pair) return
    sfx.playPop()
    const a = flip ? 1 : 0
    const next = answerHrtf(test, i === null ? null : pair[i === 0 ? a : 1 - a], plan)
    setTest(next)
    const won = next.winner
    if (won) {
      stopAudio()
      setResult({ winner: won, previous: hrirId })
      if (won !== hrirId) save(won)
      return
    }
    setFlip(Math.random() < 0.5)
    hear(0)
  }

  const keepCurrent = () => {
    stopAudio()
    setTest(null)
  }

  const progress = test ? hrtfProgress(test, plan) : null
  const picks = useMemo(() => hrtfProgress(startHrtfTest(plan), plan).of, [plan])

  return (
    <div className="selftest">
      {running && progress ? (
        <div className="selftest-round">
          <RoundDots round={progress.done + 1} of={progress.of} />
          <p className="selftest-step">
            {test?.final && <b>Final check. </b>}Tap a card to listen. Pick the one where the sound comes from <b>in front of you</b> and still sounds natural. If
            one is wider but thinner, pick the clearer one.
          </p>
          <div className="selftest-controls">
            <button type="button" className="ms-btn primary" disabled={!clip || !ready} onClick={toggle}>
              {playing ? '■ Pause' : '▶ Play'}
            </button>
            {clip && <span className="muted small">{clip.title}</span>}
          </div>
          <AbCards
            labels={['A', 'B']}
            active={active}
            playing={playing}
            disabled={!ready}
            onListen={(i) => {
              hear(i)
              if (!audio.current?.playing) toggle()
            }}
            onPick={answer}
            pickText={(l) => `Pick ${l}`}
          />
          <div className="selftest-controls">
            {sound === 'music' && (props.library.length > 0 || props.loadClip) && (
              <button type="button" className="ms-btn tonal" onClick={() => setAttempt((a) => a + 1)}>
                Another song
              </button>
            )}
            {/* §91 E5: when the two can't be told apart; the one already ahead in the knockout goes on */}
            <button type="button" className="ms-btn tonal" disabled={!ready} onClick={() => answer(null)}>
              Same
            </button>
            <button type="button" className="ms-btn tonal" onClick={keepCurrent}>
              Keep current{current ? `: ${current.name}` : ''}
            </button>
          </div>
        </div>
      ) : (
        <>
          {result ? (
            <div className="selftest-result">
              <strong>Yours: {nameOf(result.winner)}</strong>
              <p className="muted small">{entries.find((e) => e.id === result.winner)?.source}</p>
              <div className="selftest-controls">
                <button type="button" className="ms-btn primary" onClick={start}>
                  Again
                </button>
                {result.previous !== result.winner && hrirId === result.winner && (
                  <button type="button" className="ms-btn tonal" onClick={() => save(result.previous)}>
                    Back to {nameOf(result.previous)}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="selftest-result">
              <strong>Yours: {current?.name ?? nameOf(hrirId)}</strong>
              {current && <p className="muted small">{current.source}</p>}
              <button type="button" className="ms-btn primary" disabled={entries.length < 2} onClick={start}>
                Start: {picks} picks
              </button>
            </div>
          )}
          {/* §107: SOFA import lives under the HRTF list; here you choose what to listen to */}
          <div className="ms-segment-small" role="radiogroup" aria-label="Test sound">
            <button type="button" role="radio" aria-checked={sound === 'music'} className={sound === 'music' ? 'on' : ''} onClick={() => setSound('music')}>Music</button>
            <button type="button" role="radio" aria-checked={sound === 'noise'} className={sound === 'noise' ? 'on' : ''} onClick={() => setSound('noise')}>Pink noise</button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

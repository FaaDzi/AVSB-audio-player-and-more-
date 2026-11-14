import { useMusicHold } from '../audio/duck'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pinkNoise } from '../audio/noise'
import { AbCards, RoundDots } from '../components/AbCards'
import { sfx } from '../audio/sfx'
import { measureLoudness, songGainDb } from '../audio/smartVolume'
import type { LibrarySong, SongManifest } from '../songs/library'
import { createRoundSource } from '../songs/rounds'
import { forgetHrirSet, loadHrirIndex, loadHrirSet, type HrirIndexEntry } from './hrir'
import { deleteStoredHrir, IMPORTED_ID, loadStoredHrir, saveStoredHrir } from './hrirStore'
import { champion, currentPair, pick, startKnockout, totalPicks, twoRounds, type Knockout } from './knockout'
import { DEFAULT_SPATIAL, updateSpatial } from './settings'
import { importSofa } from './sofa'
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
}

/**
 * Pick your HRTF by ear (plan §32 phase 3): the same clip through the virtual speakers with two
 * HRTF sets, blind as A and B, in a knockout over the bundled candidates (plus your import); the
 * winner becomes yours. Also imports a measured SOFA file.
 */
export function HrtfPicker(props: HrtfPickerProps) {
  const { player, hrirId } = props
  const [index, setIndex] = useState<HrirIndexEntry[] | null>(null)
  const [imported, setImported] = useState<HrirSet | null>(null)
  const [ko, setKo] = useState<Knockout | null>(null)
  /** Round 2 is the round-1 winner's group; `done` = picks made in round 1. */
  const [round, setRound] = useState<{ n: 1 | 2; done: number }>({ n: 1, done: 0 })
  const [flip, setFlip] = useState(false)
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  useMusicHold(playing || ko !== null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ winner: string; previous: string } | null>(null)
  const [importing, setImporting] = useState(false)
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
  const running = !!ko && !champion(ko)
  useEffect(() => {
    if (!running) return
    let cancelled = false
    setClip(null)
    const done = (buffer: AudioBuffer, title: string) => {
      if (cancelled) return
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
      setClip({ buffer, title, levelDb: songGainDb(measureLoudness(chans, buffer.sampleRate)) })
    }
    if (!props.library.length) done(noiseClip(player.ctx), 'Pink noise')
    else source.getRound(0, attempt).then((a) => done(a.buffer, a.title), (e) => !cancelled && setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, attempt, source])

  // keep playing the new clip if the old one was playing
  useEffect(() => {
    if (clip && audio.current?.playing) audio.current.play(clip.buffer, clip.levelDb)
  }, [clip])

  // load the pair's sets into the two stages: A is pair[flip ? 1 : 0]
  const pair = ko ? currentPair(ko) : null
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
    setRound({ n: 1, done: 0 })
    setKo(startKnockout(plan.heads))
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

  const answer = (i: number) => {
    if (!ko || !pair) return
    sfx.playPop()
    const a = flip ? 1 : 0
    const next = pick(ko, pair[i === 0 ? a : 1 - a])
    setKo(next)
    let won = champion(next)
    // round 1 picked a group: its other sets are round 2
    if (won && round.n === 1 && plan.members(won).length > 1) {
      setRound({ n: 2, done: next.picks })
      setKo(startKnockout(plan.members(won)))
      won = null
    }
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
    setKo(null)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const set = await importSofa(file)
      await saveStoredHrir(set)
      forgetHrirSet(IMPORTED_ID)
      setImported(set)
      setResult(null)
      save(IMPORTED_ID)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const removeImport = async () => {
    await deleteStoredHrir(IMPORTED_ID).catch(() => {})
    forgetHrirSet(IMPORTED_ID)
    setImported(null)
    if (hrirId === IMPORTED_ID) save(DEFAULT_SPATIAL.hrirId)
  }

  const groupSize = Math.max(1, ...plan.heads.map((h) => plan.members(h).length))
  const picks = totalPicks(plan.heads.length) + totalPicks(groupSize)

  return (
    <div className="selftest">
      {running && ko ? (
        <div className="selftest-round">
          <RoundDots round={(round.n === 2 ? round.done : 0) + ko.picks + 1} of={picks} />
          <p className="selftest-step">
            Tap a card to listen. Pick the one that sounds more <b>outside your head</b>, in front of you.
          </p>
          <div className="selftest-controls">
            <button type="button" className="game-btn-sm primary" disabled={!clip || !ready} onClick={toggle}>
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
            {props.library.length > 0 && (
              <button type="button" className="game-btn-sm" onClick={() => setAttempt((a) => a + 1)}>
                Another song
              </button>
            )}
            <button type="button" className="game-btn-sm" onClick={keepCurrent}>
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
                <button type="button" className="game-btn-sm primary" onClick={start}>
                  Again
                </button>
                {result.previous !== result.winner && hrirId === result.winner && (
                  <button type="button" className="game-btn-sm" onClick={() => save(result.previous)}>
                    Back to {nameOf(result.previous)}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="selftest-result">
              <strong>Yours: {current?.name ?? nameOf(hrirId)}</strong>
              {current && <p className="muted small">{current.source}</p>}
              <button type="button" className="game-btn-primary" disabled={entries.length < 2} onClick={start}>
                Start: {picks} picks
              </button>
            </div>
          )}
          <div className="selftest-controls">
            <label className="game-btn-sm" style={{ cursor: importing ? 'progress' : 'pointer' }}>
              <span>{importing ? 'Reading…' : imported ? 'Replace SOFA…' : 'Import SOFA…'}</span>
              <input
                type="file"
                accept=".sofa,application/x-hdf5,application/octet-stream"
                style={{ display: 'none' }}
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  void onFile(f)
                }}
              />
            </label>
            {imported && (
              <button type="button" className="game-btn-sm" onClick={() => void removeImport()}>
                Remove {imported.name}
              </button>
            )}
            {hrirId !== DEFAULT_SPATIAL.hrirId && (
              <button type="button" className="game-btn-sm" onClick={() => save(DEFAULT_SPATIAL.hrirId)}>
                Reset to generic
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

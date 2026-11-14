// The blind A/B match (§65 step 4), on the old match engine: each round a song, both contenders simulated on your
// device and loudness-matched, A and B re-shuffled every round. Hear both, then vote. Keys: A/B or ←/→ switch,
// Space plays, Tab flips, 1/2 vote.
import { useCallback, useEffect, useRef, useState } from 'react'
import { reducedMotion } from './motion'
import { Icon } from '../ui'
import { frDb, type Iem, type IemData } from '../../audio/data'
import { IEM_OPTIONS, SPEAKER_OPTIONS } from '../../audio/filter'
import { loudWindows } from '../../audio/headroom'
import { longTermSpectrum, type Spectrum } from '../../audio/loudness'
import { prepareMatch } from '../../audio/match'
import { songGainDb } from '../../audio/smartVolume'
import { songLevel } from '../../audio/songLevel'
import { fireConfetti, sfx } from '../../audio/sfx'
import type { RoundAudio } from '../../match/MatchView'
import { newMatch, recordRound, winsNeeded, type MatchState, type Side } from '../../match/state'
import { matchPlayer } from './engine'
import type { BackSpace } from '../../audio/backSpace'
import { getSetting } from '../settings/store'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0))

/** Pre-analysed song clip so `prepareMatch` on the main thread takes only a few milliseconds. */
interface PreppedRound {
  audio: RoundAudio
  spectrum: Spectrum
  windows: Float32Array[][]
  levelDb: number
}

const preppedByBuffer = new WeakMap<AudioBuffer, PreppedRound>()
const inflightByBuffer = new WeakMap<AudioBuffer, Promise<PreppedRound>>()
let lastWarmed: PreppedRound | null = null

export function prepRoundAudio(a: RoundAudio): Promise<PreppedRound> {
  const hit = preppedByBuffer.get(a.buffer)
  if (hit) return Promise.resolve(hit)
  const running = inflightByBuffer.get(a.buffer)
  if (running) return running
  const job = (async () => {
    const chans = Array.from({ length: a.buffer.numberOfChannels }, (_, i) => a.buffer.getChannelData(i))
    // BS.1770 loudness runs inside songLevel.worker.ts off the main thread
    const levelPromise = songLevel({}, a.buffer)
    await yieldFrame()
    const spectrum = longTermSpectrum(chans, a.buffer.sampleRate, 4096, 96)
    await yieldFrame()
    const windows = loudWindows(chans, 64)
    const level = await levelPromise
    const res: PreppedRound = { audio: a, spectrum, windows, levelDb: songGainDb(level) }
    preppedByBuffer.set(a.buffer, res)
    inflightByBuffer.delete(a.buffer)
    return res
  })()
  inflightByBuffer.set(a.buffer, job)
  return job
}

/** Called by VsScreen so "ready" includes both decoding and round 1's spectrum/loudness prep. */
export async function warmRoundAudio(ready: Promise<unknown>): Promise<void> {
  lastWarmed = null
  const val = (await ready) as RoundAudio | null | undefined
  if (val && typeof val === 'object' && 'buffer' in val && val.buffer) {
    lastWarmed = await prepRoundAudio(val)
  }
}

export function MatchPage(p: {
  data: IemData
  entrants: [Iem, Iem]
  names: [string, string]
  photos: [string | null, string | null]
  /** "Hide names until the results": the reveal shows the result but keeps both names and photos hidden. */
  hideNames: boolean
  /** Per entrant: 'open' for an open-back headphone heard on in-ears (adds its sense of space), else dry. */
  spaces?: [BackSpace | null, BackSpace | null]
  reference: Float64Array
  candidateDb: (iem: Iem) => Float64Array
  mode: 'iem' | 'speakers'
  bestOf: number
  heading: string
  isGrandFinal: boolean
  /** Keep full treble detail (both contenders the same kind as your device, measurements agreeing): eq/trebleDetail.ts. */
  fullTreble?: boolean
  /** The listening device from settings/currentId, if any (used for adaptive driver protection). */
  device?: Iem | null
  getRound: (round: number, attempt: number) => Promise<RoundAudio>
  onDone: (winner: Side, state: MatchState) => void
  onLeave: () => void
}) {
  const player = matchPlayer()
  const [state, setState] = useState<MatchState>(() => newMatch(p.bestOf))
  const [attempt, setAttempt] = useState(0)
  const [audio, setAudio] = useState<RoundAudio | null>(() => lastWarmed?.audio ?? null)
  const [error, setError] = useState<string | null>(null)
  const [swap, setSwap] = useState(false)
  const [active, setActive] = useState(0)
  const [heard, setHeard] = useState<Set<number>>(new Set())
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [lastVote, setLastVote] = useState<number | null>(null)
  const raf = useRef(0)
  /** "Round 2: B" for a moment after each vote. */
  const [flash, setFlash] = useState<{ round: number; button: number } | null>(null)
  /** Bumped on every A/B switch, to replay the switch pulse. */
  const [pulse, setPulse] = useState(0)

  const round = state.rounds.length
  const decided = state.winner !== null
  const entrantOn = (button: number): Side => ((swap ? 1 - button : button) as Side)

  useEffect(() => {
    sfx.setListeningActive(playing)
    return () => sfx.setListeningActive(false)
  }, [playing])

  useEffect(() => {
    if (decided) return
    let cancelled = false
    const warmed = round === 0 && attempt === 0 ? lastWarmed : null
    if (warmed) lastWarmed = null
    else setAudio(null)
    setError(null)
    const s = Math.random() < 0.5
    const applyPrepped = (prepped: PreppedRound) => {
      if (cancelled) return
      const { audio: a, spectrum, windows, levelDb } = prepped
      const order = s ? [p.entrants[1], p.entrants[0]] : p.entrants
      const bottomGuard = getSetting('tourney_bottom_guard') !== false
      const maxBassBoost = Number(getSetting('tourney_max_bass_boost') ?? 10)
      const cornerChoice = getSetting('tourney_bottom_corner')
      let lowLimitHz = 0
      let lowBoostDb = maxBassBoost
      if (bottomGuard) {
        if (cornerChoice === 'Sub-Bass 45 Hz HPF') {
          lowLimitHz = 45
          lowBoostDb = 3
        } else if (cornerChoice === 'Sub-Bass 35 Hz HPF') {
          lowLimitHz = 35
          lowBoostDb = 4
        } else if (cornerChoice === 'Soft-Knee 6 dB Boost Cap') {
          lowLimitHz = 60
          lowBoostDb = 6
        } else {
          lowLimitHz = 35
          lowBoostDb = 6
        }
      }

      // Check whether user listening device is open-back:
      const isDeviceOpen = p.device?.back === 'open' || p.device?.back === 'semi-open'

      // Adaptive Excursion Guard:
      // Engages ONLY when an Open-Back headphone simulates a Closed-Back model (e.g. HD 600 -> WH-1000XM4).
      // For Open-Back simulating Open-Back (e.g. HD 600 -> HD 800 S or Sundara), or when listening on
      // IEMs / Closed headphones, it is 100% BYPASSED to keep the soundstage and deep bass natural!
      const matchOptions = order.map((e) => {
        const base = p.mode === 'speakers' ? SPEAKER_OPTIONS : IEM_OPTIONS
        const needsGuard = bottomGuard && isDeviceOpen && e.back === 'closed'
        return {
          ...base,
          holdAir: !p.fullTreble,
          maxBoostDb: needsGuard ? Math.min(base.maxBoostDb, maxBassBoost) : base.maxBoostDb,
          lowLimitHz: needsGuard ? lowLimitHz : 0,
          lowBoostDb: needsGuard ? lowBoostDb : base.maxBoostDb,
        }
      })

      const m = prepareMatch({
        grid: p.data.grid,
        candidates: order.map((e) => p.candidateDb(e) ?? frDb(p.data, e.fr)),
        reference: p.reference,
        options: matchOptions,
        spectrum,
        sampleRate: player.ctx.sampleRate,
        windows,
        levelDb,
      })
      player.setBuffer(a.buffer, [0, a.buffer.duration])
      player.setMatch(m, p.spaces && (s ? [p.spaces[1], p.spaces[0]] : p.spaces))
      player.select(0)
      setSwap(s)
      setActive(0)
      setHeard(new Set())
      setPlaying(false)
      setPosition(0)
      setAudio(a)
    }
    if (warmed) {
      applyPrepped(warmed)
      // trigger round 1's prefetch in engine.ts as well
      void p.getRound(round, attempt).catch(() => {})
    } else {
      p.getRound(round, attempt)
        .then(prepRoundAudio)
        .then(
          applyPrepped,
          (e) => !cancelled && setError(String(e?.message ?? e)),
        )
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, attempt, decided])

  useEffect(() => {
    const tick = () => {
      setPosition(player.position)
      raf.current = requestAnimationFrame(tick)
    }
    if (playing) raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, player])
  useEffect(() => () => player.pause(), [player])

  const showRaw = getSetting('tourney_raw_mode') !== false
  const [isRaw, setIsRaw] = useState(false)

  const markHeard = (side: number) => setHeard((h) => (h.has(side) ? h : new Set(h).add(side)))
  const select = useCallback((side: number) => {
    if (side !== player.active || isRaw) setPulse((n) => n + 1)
    setIsRaw(false)
    player.select(side)
    setActive(side)
    if (player.playing) markHeard(side)
  }, [player, isRaw])
  const playPause = useCallback(() => {
    if (player.playing) player.pause()
    else {
      player.play()
      markHeard(player.active)
    }
    setPlaying(player.playing)
  }, [player])
  const startRaw = useCallback(() => {
    if (isRaw) return
    setIsRaw(true)
    player.selectRaw()
    if (!player.playing) playPause()
  }, [isRaw, player, playPause])
  const stopRaw = useCallback(() => {
    if (!isRaw) return
    setIsRaw(false)
    player.select(active)
  }, [isRaw, player, active])

  const vote = (button: number) => {
    player.pause()
    setPlaying(false)
    sfx.setListeningActive(false)
    const next = recordRound(state, entrantOn(button))
    setLastVote(button)
    // the deciding vote hands over to the reveal, which brings its own drumroll and fanfare
    if (next.winner === null) {
      sfx.playStamp(0.7, button === 0 ? -0.4 : 0.4)
      setFlash({ round: round + 1, button })
      window.setTimeout(() => setFlash(null), 1100)
    }
    setState(next)
    setAttempt(0)
  }
  const canVote = heard.size === 2 && !decided

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!audio || decided || (e.target as HTMLElement).tagName === 'INPUT') return
      const k = e.key.toLowerCase()
      if (e.key === ' ') playPause()
      else if (e.key === 'ArrowLeft' || k === 'a') {
        select(0)
        if (!playing) playPause()
      } else if (e.key === 'ArrowRight' || k === 'b') {
        select(1)
        if (!playing) playPause()
      } else if (e.key === 'Tab') select(1 - active)
      else if (k === 'r' && showRaw) { if (!e.repeat) startRaw() }
      else if (canVote && e.key === '1') vote(0)
      else if (canVote && e.key === '2') vote(1)
      else return
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && showRaw) stopRaw()
    }
    const onBlur = () => {
      if (isRaw) stopRaw()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  })

  const need = winsNeeded(p.bestOf)
  const hint = canVote ? 'Which one sounded better on this song?' : heard.size === 0 ? 'Press A or B to start. Hear both, then vote.' : `Now try ${heard.has(0) ? 'B' : 'A'}. Switch as often as you like.`

  return (
    <div className="ms-scroll">
      <div className="ms-page ms-tz-matchpage">
        <div className="ms-tz-match-top">
          <button type="button" className="ms-btn text" onClick={() => { player.pause(); p.onLeave() }}><Icon name="arrow_back" size={20} /> Bracket</button>
          <span className="grow">{p.heading}</span>
          <span className="ms-tz-led" aria-hidden="true"><b>{state.wins[0]}</b><i>:</i><b>{state.wins[1]}</b></span>
          <span className="ms-tz-score" aria-label="Score">
            {[0, 1].map((s) => (
              <span key={s} className="ms-tz-pips">
                {Array.from({ length: need }, (_, i) => <i key={i} className={i < state.wins[s] ? 'on' : ''} />)}
              </span>
            ))}
          </span>
        </div>

        {decided ? (
          <Reveal names={p.names} photos={p.photos} hideNames={p.hideNames} winner={state.winner!} wins={state.wins} grandFinal={p.isGrandFinal} onContinue={() => p.onDone(state.winner!, state)} />
        ) : (
          <>
            <div className="ms-tz-song">
              <small>Round {round + 1}</small>
              <b>{audio ? audio.title : error ? 'This song failed' : 'Loading the song…'}</b>
              <span>{audio?.subtitle ?? error ?? ''}</span>
              <div className="ms-tz-song-actions">
                {error ? (
                  <button type="button" className="ms-btn tonal" onClick={() => setAttempt((a) => a + 1)}>Try another song</button>
                ) : (
                  <button type="button" className="ms-btn text" disabled={!audio} onClick={() => { player.pause(); setPlaying(false); setAttempt((a) => a + 1) }} title="Pick a different song for this round">
                    <Icon name="shuffle" size={18} /> Swap song
                  </button>
                )}
                {showRaw && (
                  <button
                    type="button"
                    className={`ms-tz-raw-chip${isRaw && playing ? ' live' : ''}`}
                    disabled={!audio}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      startRaw()
                    }}
                    onPointerUp={(e) => {
                      e.preventDefault()
                      stopRaw()
                    }}
                    onPointerCancel={stopRaw}
                    onPointerLeave={() => {
                      if (isRaw) stopRaw()
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ touchAction: 'none', userSelect: 'none' }}
                    title="Hold to hear raw uncorrected hardware sound, release to return (Key: Hold R)"
                    aria-label="Hold to hear raw hardware sound"
                    aria-pressed={isRaw}
                  >
                    B
                  </button>
                )}
              </div>
            </div>
            {flash && <div className="ms-tz-flash" key={flash.round}>Round {flash.round}: <b>{flash.button ? 'B' : 'A'}</b></div>}
            <div className="ms-tz-ab">
              {[0, 1].map((b) => (
                <button
                  type="button"
                  key={b}
                  className={`ms-tz-abbtn${active === b && playing ? ' live' : ''}${heard.has(b) ? ' heard' : ''}${lastVote === b ? ' voted' : ''}`}
                  disabled={!audio}
                  onClick={() => {
                    select(b)
                    if (!player.playing) playPause()
                  }}
                >
                  {active === b && <span className="ms-tz-pulse" key={pulse} aria-hidden="true" />}
                  <span className="ms-tz-ab-letter">{b ? 'B' : 'A'}</span>
                  <small>{heard.has(b) ? 'Heard' : 'Not heard yet'}</small>
                </button>
              ))}
            </div>
            <div className="ms-tz-transport">
              <button type="button" className="ms-play" disabled={!audio} onClick={playPause} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play_arrow'} fill /></button>
              <span className="ms-time">{fmt(position)}</span>
              <div className="ms-tz-bar"><span style={{ width: `${audio ? (position / audio.buffer.duration) * 100 : 0}%` }} /></div>
              <span className="ms-time">{audio ? fmt(audio.buffer.duration) : '0:00'}</span>
            </div>
            {/* fills as both sides are heard: the studio audience waits for your vote */}
            <div className="ms-tz-applause" aria-hidden="true"><span style={{ width: `${(heard.size / 2) * 100}%` }} /></div>
            <p className="ms-tz-hint">{hint}</p>
            <div className="ms-tz-votes">
              <button type="button" className="ms-btn primary" disabled={!canVote} onClick={() => vote(0)}>A was better <kbd>1</kbd></button>
              <button type="button" className="ms-btn primary" disabled={!canVote} onClick={() => vote(1)}>B was better <kbd>2</kbd></button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * After the deciding vote, as in the old app: a drumroll and "And the winner is…", then both contenders turn over,
 * the winner lifted and the loser dimmed.
 */
function Reveal({ names, photos, hideNames, winner, wins, grandFinal, onContinue }: {
  names: [string, string]
  photos: [string | null, string | null]
  hideNames: boolean
  winner: Side
  wins: [number, number]
  grandFinal: boolean
  onContinue: () => void
}) {
  const [shown, setShown] = useState(reducedMotion())
  useEffect(() => {
    if (shown) {
      sfx.playFanfare()
      return
    }
    // decided by a single round: the audience gasps before the drumroll
    if (Math.abs(wins[0] - wins[1]) === 1 && wins[0] + wins[1] > 1) sfx.playOoh()
    const roll = sfx.playDrumroll(1.8, 0.55)
    const t = setTimeout(() => {
      setShown(true)
      sfx.playFanfare()
      // every match win gets confetti on the show; in Clean only the grand final does
      if (grandFinal || document.documentElement.dataset.style === 'gameshow') fireConfetti(grandFinal ? 2800 : 1600)
    }, 1800)
    return () => {
      clearTimeout(t)
      roll.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!shown) {
    return (
      <div className="ms-tz-reveal rolling">
        <div className="ms-tz-roll-dots" aria-hidden="true"><i /><i /><i /></div>
        <b>And the winner is…</b>
      </div>
    )
  }
  return (
    <div className="ms-tz-reveal">
      <div className="ms-tz-reveal-cards">
        {[0, 1].map((side) => (
          <div key={side} className={`ms-tz-reveal-card${side === winner ? ' won' : ' lost'}`}>
            <span className="ms-tz-reveal-tag">{side === winner ? 'Winner' : 'Runner-up'} · Corner {side ? 'B' : 'A'}</span>
            <span className="ms-tz-reveal-photo">
              {hideNames || !photos[side] ? <Icon name={hideNames ? 'question_mark' : 'headphones'} size={56} /> : <img src={photos[side]!} alt="" />}
            </span>
            <b>{hideNames ? `Mystery contender ${side ? 'B' : 'A'}` : names[side]}</b>
            <small>{wins[side]} {wins[side] === 1 ? 'round' : 'rounds'} won</small>
          </div>
        ))}
      </div>
      {hideNames && <p className="ms-tz-note">Names stay hidden until the tournament's results.</p>}
      <button type="button" className="ms-btn primary" onClick={onContinue} autoFocus>Continue</button>
    </div>
  )
}

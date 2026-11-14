import { useCallback, useEffect, useRef, useState } from 'react'
import { frDb, type Iem, type IemData } from '../audio/data'
import { IEM_OPTIONS, SPEAKER_OPTIONS } from '../audio/filter'
import { loudWindows } from '../audio/headroom'
import { longTermSpectrum } from '../audio/loudness'
import { measureLoudness, songGainDb } from '../audio/smartVolume'
import { levelMatchOn, MATCH_WINDOWS, prepareMatch } from '../audio/match'
import type { ABPlayer } from '../audio/player'
import { fireConfetti, sfx } from '../audio/sfx'
import { MysteryContenderSvg } from '../game/Art'
import { analyzeMatchOutcome } from '../game/announcer'
import { HostBanner } from '../game/HostBanner'
import { classifyFlavour } from '../prefs/scoring'
import { NEAR_IDENTICAL_DB, tuningGapDb } from '../tournament/confidence'
import { ReviewSwitch } from '../reviews/ReviewThread'
import { imgUrl, type IemImage, type ReviewData } from '../reviews/reviews'
import { newMatch, recordRound, winsNeeded, type MatchState, type Side } from './state'
import { AUDIO_INTERRUPTED, isAndroid } from '../platform'
import { useBackAction } from '../game/backStack'

/** No keyboard (the Android app, or a touch-only phone in a browser): hide the key hints. */
const touchOnly = isAndroid() || (typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches)

export interface RoundAudio {
  /** Already cut to the clip. */
  buffer: AudioBuffer
  title: string
  subtitle: string
}

export interface MatchProps {
  data: IemData
  player: ABPlayer
  entrants: [Iem, Iem]
  reference: Float64Array
  /** A candidate's FR as simulated (default: its graph); App adds the ear-gain correction for headphones. */
  candidateDb?: (iem: Iem) => Float64Array
  mode: 'iem' | 'speakers'
  bestOf: number
  blind: boolean
  /** Tournament "hide names until the results": stays blind even after the match is decided. */
  hideNames?: boolean
  heading?: string
  /** Show the honest plain-English note on Match 1 (GDD Section 6). */
  isFirstMatch?: boolean
  /** Dim the screen while listening (eyes-closed listening). */
  dim?: boolean
  /** Audio for round `round`; `attempt` > 0 means the previous choice failed or was skipped. */
  getRound: (round: number, attempt: number) => Promise<RoundAudio>
  onDone: (winner: Side, state: MatchState) => void
  /** Shown for both IEMs once the match is decided (never during, to keep blind mode honest). */
  reviews?: ReviewData
  images?: Record<string, IemImage>
  seeds?: [number | null, number | null]
  prices?: [number | null, number | null]
  currentId?: string | null
  isGrandFinal?: boolean
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function MatchView(p: MatchProps) {
  const [state, setState] = useState<MatchState>(() => newMatch(p.bestOf))
  const [attempt, setAttempt] = useState(0)
  const [audio, setAudio] = useState<RoundAudio | null>(null)
  const [error, setError] = useState<string | null>(null)
  // In blind mode, which entrant is on button A is re-randomised every round.
  const [swap, setSwap] = useState(false)
  const [active, setActive] = useState(0)
  const [heard, setHeard] = useState<Set<number>>(new Set())
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const raf = useRef(0)

  const round = state.rounds.length
  const decided = state.winner !== null
  // once a match is decided, Back keeps the result (as Continue) instead of dropping it for a replay
  useBackAction(decided, () => {
    sfx.playPop()
    p.onDone(state.winner!, state)
  })
  const sideEntrant = (button: number): Side => ((swap ? 1 - button : button) as Side)

  // Keep SFX strictly silenced whenever ABPlayer is playing
  useEffect(() => {
    sfx.setListeningActive(playing)
    return () => sfx.setListeningActive(false)
  }, [playing])

  // load + prepare the round
  useEffect(() => {
    if (decided) return
    let cancelled = false
    setAudio(null)
    setError(null)
    const s = p.blind && Math.random() < 0.5
    p.getRound(round, attempt).then(
      (a) => {
        if (cancelled) return
        const chans = Array.from({ length: a.buffer.numberOfChannels }, (_, i) => a.buffer.getChannelData(i))
        const order = s ? [p.entrants[1], p.entrants[0]] : p.entrants
        const m = prepareMatch({
          grid: p.data.grid,
          candidates: order.map((e) => p.candidateDb?.(e) ?? frDb(p.data, e.fr)),
          reference: p.reference,
          options: p.mode === 'speakers' ? SPEAKER_OPTIONS : IEM_OPTIONS,
          spectrum: longTermSpectrum(chans, a.buffer.sampleRate),
          sampleRate: p.player.ctx.sampleRate,
          windows: loudWindows(chans, MATCH_WINDOWS),
          levelDb: songGainDb(measureLoudness(chans, a.buffer.sampleRate)),
        })
        p.player.setBuffer(a.buffer, [0, a.buffer.duration])
        p.player.setMatch(m)
        p.player.select(0)
        setSwap(s)
        setActive(0)
        setHeard(new Set())
        setPlaying(false)
        setPosition(0)
        setAudio(a)
      },
      (e) => !cancelled && setError(String(e?.message ?? e)),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, attempt, decided])

  // progress bar
  useEffect(() => {
    const tick = () => {
      setPosition(p.player.position)
      raf.current = requestAnimationFrame(tick)
    }
    if (playing) raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, p.player])

  useEffect(() => () => p.player.pause(), [p.player])
  // another app took the audio (YouTube, a call, a music player): pause, don't fight it
  useEffect(() => {
    const onInterrupt = () => {
      if (!p.player.playing) return
      p.player.pause()
      setPlaying(false)
    }
    window.addEventListener(AUDIO_INTERRUPTED, onInterrupt)
    return () => window.removeEventListener(AUDIO_INTERRUPTED, onInterrupt)
  }, [p.player])

  // Dim while listening: fade to near-black 3 s after the last tap; wake on tap or 3 s before the clip loops.
  const [dimmed, setDimmed] = useState(false)
  const lastPoke = useRef(0)
  useEffect(() => {
    lastPoke.current = performance.now()
    if (!p.dim || !playing || decided || !audio) {
      setDimmed(false)
      return
    }
    const id = setInterval(() => {
      const remaining = audio.buffer.duration - p.player.position
      if (remaining <= 3) {
        lastPoke.current = performance.now()
        setDimmed(false)
      } else if (performance.now() - lastPoke.current >= 3000) {
        setDimmed(true)
      }
    }, 200)
    const poke = () => {
      lastPoke.current = performance.now()
      setDimmed(false)
    }
    window.addEventListener('pointerdown', poke)
    return () => {
      clearInterval(id)
      window.removeEventListener('pointerdown', poke)
    }
  }, [p.dim, playing, decided, audio, p.player])

  const markHeard = (side: number) => setHeard((h) => (h.has(side) ? h : new Set(h).add(side)))

  const select = useCallback(
    (side: number) => {
      p.player.select(side)
      setActive(side)
      if (p.player.playing) markHeard(side)
    },
    [p.player],
  )

  const playPause = useCallback(() => {
    if (p.player.playing) p.player.pause()
    else {
      p.player.play()
      markHeard(p.player.active)
    }
    setPlaying(p.player.playing)
  }, [p.player])

  const vote = (button: number) => {
    p.player.pause()
    setPlaying(false)
    sfx.setListeningActive(false)
    const next = recordRound(state, sideEntrant(button))
    if (next.winner !== null) {
      const verdict = analyzeMatchOutcome({
        winner: p.entrants[next.winner],
        loser: p.entrants[(1 - next.winner) as Side],
        wins: next.wins,
        winnerSide: next.winner,
        winnerPrice: p.prices?.[next.winner] ?? null,
        loserPrice: p.prices?.[1 - next.winner] ?? null,
        winnerSeed: p.seeds?.[next.winner] ?? null,
        loserSeed: p.seeds?.[1 - next.winner] ?? null,
        currentIemId: p.currentId,
        isGrandFinal: p.isGrandFinal,
      })
      if (verdict.isUpset && !p.hideNames) sfx.playAirhorn() // an upset horn would give the names away
      else sfx.playFanfare()
      if (p.isGrandFinal) fireConfetti(2800)
    } else {
      sfx.playStamp(0.7, button === 0 ? -0.4 : 0.4) // the stamp lands on the side you voted for
    }
    setState(next)
    setAttempt(0)
  }

  const canVote = heard.size === 2
  /** DJ Tips' line in the voting dock: what to do next. */
  const dockLine = canVote
    ? 'Which one sounded better on this song?'
    : heard.size === 0
      ? 'Tap A or B to start. Hear both, then vote.'
      : `Now try ${heard.has(0) ? 'B' : 'A'}. Switch as often as you like.`
  
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!audio || decided || (e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === ' ') {
        e.preventDefault()
        playPause()
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        e.preventDefault()
        select(0)
        if (!playing) playPause()
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'b') {
        e.preventDefault()
        select(1)
        if (!playing) playPause()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        select(1 - active)
      } else if (canVote && e.key === '1') {
        e.preventDefault()
        vote(0)
      } else if (canVote && e.key === '2') {
        e.preventDefault()
        vote(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, decided, active, playing, canVote, playPause, select])

  const name = (side: Side) => p.entrants[side].name
  const buttonLabel = (button: number) =>
    p.blind ? `Mystery Tuning ${button === 0 ? 'A' : 'B'}` : p.entrants[sideEntrant(button)].name

  const needed = winsNeeded(p.bestOf)
  const loopRemaining = audio ? Math.max(0, Math.ceil(audio.buffer.duration - position)) : 0

  // Blind scoreboard summary that never confuses reshuffled A/B with static IEM 1 / IEM 2
  const hiWins = Math.max(state.wins[0], state.wins[1])
  const loWins = Math.min(state.wins[0], state.wins[1])
  const blindSeriesStatus = decided
    ? `Decided ${hiWins}–${loWins} · names stay hidden until the results`
    : round === 0
      ? `First to ${needed} song${needed > 1 ? 's' : ''} wins · A & B reshuffle each song`
      : hiWins === loWins
        ? `Series Tied ${hiWins}–${loWins} · A & B reshuffled for Song ${round + 1}`
        : hiWins === needed - 1
          ? `Match Point (${hiWins}–${loWins}) · A & B reshuffled for Song ${round + 1}`
          : `One contender leads ${hiWins}–${loWins} · A & B reshuffled`

  const outcome =
    decided && state.winner !== null && !p.hideNames
      ? analyzeMatchOutcome({
          winner: p.entrants[state.winner],
          loser: p.entrants[(1 - state.winner) as Side],
          wins: state.wins,
          winnerSide: state.winner,
          winnerPrice: p.prices?.[state.winner] ?? null,
          loserPrice: p.prices?.[1 - state.winner] ?? null,
          winnerSeed: p.seeds?.[state.winner] ?? null,
          loserSeed: p.seeds?.[1 - state.winner] ?? null,
          currentIemId: p.currentId,
          isGrandFinal: p.isGrandFinal,
        })
      : null

  return (
    <section className="jackbox-match-stage">
      {/* Eyes-Closed Listening Dim Overlay (pointer-events: none so clicks on IEM cards register immediately on first tap) */}
      <div
        className={`dim-overlay ${dimmed ? 'on' : ''}`}
        aria-hidden={!dimmed}
      >
        <span>Tap anywhere to wake screen</span>
      </div>

      {/* Top Row: Left Wobbly Round Blob + Center Scoreboard + Right Loop Timer Blob */}
      <div className="match-stage-top">
        <div className="wobbly-round-blob">
          {/* no "← Bracket" button: Back / Esc does it mid-match, and continues once decided */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {p.heading && <span className="blob-round-title">{p.heading}</span>}
          </div>
          {!decided && (
            <span className="blob-round-sub">
              {p.isFirstMatch
                ? 'Tests tuning · First to ' + needed
                : `Best of ${p.bestOf} · First to ${needed}`}
            </span>
          )}
        </div>

        {(p.blind && !decided) || p.hideNames ? (
          <div className="match-scoreboard blind-series-board" title="Identities & which side is A or B are reshuffled every song to keep the blind test honest">
            <div className="blind-series-pips">
              {Array.from({ length: p.bestOf }, (_, i) => {
                const doneRound = i < round
                const curRound = i === round
                return (
                  <span
                    key={i}
                    className={`series-song-pip ${doneRound ? 'done' : ''} ${curRound ? 'current' : ''}`}
                  >
                    {doneRound ? '✓' : i + 1}
                  </span>
                )
              })}
            </div>
            <span className="blind-series-text" aria-live="polite">{blindSeriesStatus}</span>
          </div>
        ) : (
          <div className="match-scoreboard" aria-live="polite">
            <div className="score-side left">
              <span className="score-iem-name">{name(0)}</span>
              <span className="score-num">{state.wins[0]}</span>
            </div>
            <span className="score-dash">–</span>
            <div className="score-side right">
              <span className="score-num">{state.wins[1]}</span>
              <span className="score-iem-name">{name(1)}</span>
            </div>
          </div>
        )}

        {!decided && (
          <div className="wobbly-timer-blob" title="Seconds remaining before clip loops">
            <span className="timer-digits">{audio ? loopRemaining : '--'}</span>
            <span className="timer-unit">LOOP</span>
          </div>
        )}
      </div>

      {!decided && (
        <>
          {/* The Song Card (GDD Section 6) */}
          <div className="match-song-card">
            {error && (
              <div className="song-error-row">
                <p className="error">Could not load track: {error}</p>
                <button type="button" className="game-btn-sm" onClick={() => setAttempt((a) => a + 1)}>
                  Try another song
                </button>
              </div>
            )}

            {!audio && !error && <p className="song-loading-text">Spinning up track &amp; {levelMatchOn() ? 'loudness-matched ' : ''}FIR filters…</p>}

            {audio && (
              <>
                <div className="song-card-top">
                  <div className="song-meta-inline">
                    <span className="song-map-kicker">
                      SONG {round + 1}/{p.bestOf}
                    </span>
                    <h3 className="song-title-line">{audio.title}</h3>
                    {audio.subtitle && <span className="song-sub-line">· {audio.subtitle}</span>}
                  </div>
                  <div className="song-controls-row">
                    <button type="button" className="game-btn-primary" onClick={playPause}>
                      {playing ? 'Pause' : 'Play'}{touchOnly ? '' : ' (Space)'}
                    </button>
                    <button
                      type="button"
                      className="game-btn-sm"
                      onClick={() => {
                        p.player.pause()
                        setPlaying(false)
                        setAttempt((a) => a + 1)
                      }}
                    >
                      Swap Track
                    </button>
                  </div>
                </div>

                <div className="song-progress-row">
                  <div className="song-progress-track">
                    <div
                      className="song-progress-fill"
                      style={{ width: `${(position / audio.buffer.duration) * 100}%` }}
                    />
                  </div>
                  <span className="song-time-readout">
                    {fmt(position)} / {fmt(audio.buffer.duration)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Two Big Framed Portrait Buttons: A (Left Arrow) and B (Right Arrow) */}
          {audio && (
            <>
              <div className="ab-framed-stage">
                {([0, 1] as const).map((b) => {
                  const isActive = active === b
                  const isHeard = heard.has(b)
                  const letter = b === 0 ? 'A' : 'B'
                  return (
                    <button
                      key={b}
                      type="button"
                      className={`framed-ab-card side-${letter} ${isActive ? 'active' : ''} ${playing && isActive ? 'playing' : ''}`}
                      onClick={() => {
                        select(b)
                        if (!playing) playPause()
                      }}
                    >
                      {/* the playing side is shown by its border alone: nothing moves */}
                      <div className="framed-portrait-box">
                        <MysteryContenderSvg side={letter} size={88} />
                      </div>
                      <div className="framed-ab-letter">{letter}</div>
                      <div className="framed-ab-sub">{buttonLabel(b)}</div>
                      <div className="framed-ab-key">
                        {playing && isActive ? 'Playing' : isHeard ? 'Tap to hear again' : 'Tap to listen'}
                        {touchOnly ? '' : ` · ${b === 0 ? '← / A' : '→ / B'}`}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Curved Bottom Voting Stage Dock (like Reference Image 3) */}
              <div className="voting-curved-dock">
                <div className="dock-guide">
                  <span className="dock-guide-kicker">
                    {canVote ? 'BOTH HEARD · READY TO VOTE' : 'BLIND A/B LISTENING'}
                  </span>
                  <p className="dock-guide-text">{dockLine}</p>
                </div>
                <div className="voting-dock-buttons">
                  <button
                    type="button"
                    className="vote-win-btn side-A"
                    disabled={!canVote}
                    onClick={() => vote(0)}
                  >
                    {canVote ? '' : '🔒 '}A wins{touchOnly ? '' : ' [1]'}
                  </button>
                  <button
                    type="button"
                    className="vote-win-btn side-B"
                    disabled={!canVote}
                    onClick={() => vote(1)}
                  >
                    {canVote ? '' : '🔒 '}B wins{touchOnly ? '' : ' [2]'}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* REVEAL: Both cards flip over with real names, product images, and bouncing winner card (GDD Section 6) */}
      {decided && state.winner !== null && (
        <div className="match-reveal-stage">

          {tuningGapDb(p.entrants[0], p.entrants[1]) < NEAR_IDENTICAL_DB && (
            <p className="reveal-coinflip" title="The device you wear changes the sound more than these two differ">
              Near-identical tunings (under {NEAR_IDENTICAL_DB} dB apart in every band): this one was a coin flip.
            </p>
          )}

          {outcome && outcome.stickers.length > 0 && (
            <div className="reveal-stickers-row">
              {outcome.stickers.map((s, idx) => (
                <span key={idx} className={`reveal-sticker ${s.color}`}>
                  {s.label}
                </span>
              ))}
            </div>
          )}

          <div className="reveal-cards-pair">
            {([0, 1] as const).map((side) => {
              const iem = p.entrants[side]
              const isWin = state.winner === side
              const img = p.images?.[iem.id]
              const price = p.prices?.[side]
              const seed = p.seeds?.[side]
              const fl = classifyFlavour(iem)

              return (
                <div
                  key={iem.id}
                  className={`reveal-flip-card ${isWin ? 'winner-bounce' : 'loser-dim'}`}
                >
                  <div className="reveal-card-kicker">
                    <span>{seed && !p.hideNames ? `SEED #${seed}` : `CONTENDER ${side + 1}`}</span>
                    <span>{isWin ? `WINNER (${state.wins[side]})` : `ELIMINATED / DROPPED (${state.wins[side]})`}</span>
                  </div>

                  <div className="reveal-photo-frame">
                    {p.hideNames ? (
                      <MysteryContenderSvg side={side === 0 ? 'A' : 'B'} size={96} />
                    ) : img ? (
                      <img src={imgUrl(img.src)} alt={iem.name} className="reveal-photo" />
                    ) : (
                      <div className="reveal-photo-placeholder">IEM</div>
                    )}
                  </div>

                  <h3 className="reveal-iem-name">
                    {p.hideNames ? 'Mystery Contender' : iem.name}
                    {!p.hideNames && iem.id === p.currentId && <span className="yours-inline"> (yours)</span>}
                  </h3>

                  {!p.hideNames && (
                    <div className="reveal-tags-row">
                      {price != null && <span className="fighter-price">${Math.round(price)}</span>}
                      <span className="flavour-pill" style={{ borderColor: fl.color, color: fl.color }}>
                        {fl.label}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {p.reviews && !p.hideNames && (
            <details className="reveal-reviews-drawer">
              <summary>What reviewers say</summary>
              <ReviewSwitch
                data={p.reviews}
                items={[p.entrants[state.winner], p.entrants[1 - state.winner]].map((iem) => ({ id: iem.id, label: iem.name }))}
              />
            </details>
          )}

          {outcome && <HostBanner quip={outcome.quip} compact />}

          <div className="reveal-continue-bar">
            <button
              type="button"
              className="game-btn-primary big"
              onClick={() => {
                sfx.playPop()
                p.onDone(state.winner!, state)
              }}
            >
              Continue to Bracket →
            </button>
          </div>
        </div>
      )}
      <p className="sim-fineprint">Each side is your own device EQ&apos;d to that model&apos;s graph: its tuning, not its fit, distortion or driver.</p>
    </section>
  )
}

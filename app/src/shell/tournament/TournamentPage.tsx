// Tournament (§65): home (start, continue, history), then setup → bracket → VS → match → results. The tournament
// logic and saves are the old app's (tournament/storage.ts, bracket.ts), so a tournament started in either app shows here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { warmFireWipes } from '../../game/fireWipe'
import { Dialog, Icon } from '../ui'
import { useShell } from '../context'
import { useDatabase } from '../database/DatabasePage'
import { appendHistory, loadHistory, loadTournament, saveTournament, type HistoryEntry, type TournamentSave } from '../../tournament/storage'
import { buildBracket, entrantsOf, isComplete, nextMatch, placings, playedIds, type BracketMatch } from '../../tournament/bracket'
import type { Iem } from '../../audio/data'
import { imgUrl } from '../../reviews/reviews'
import { DatabaseStatus } from '../database/DatabasePage'
import type { Database, Model } from '../database/catalog'
import { priceOf } from '../../data/catalog'
import { Graph, Reviews } from '../database/DevicePage'
import { BracketPage, contenderName } from './BracketPage'
import { backSpaceFor, candidateFr, libraryRounds, matchFullTreble, referenceFor, useRefs } from './engine'
import { MatchPage } from './MatchPage'
import { ResultsPage } from './ResultsPage'
import { SetupPage, SONGS_KEY, songsFor } from './SetupPage'
import { QuestionsPage } from './QuestionsPage'
import type { Preferences } from '../../prefs/types'
import { VsScreen, type VsSide } from './VsScreen'
import { SimilarPage } from './SimilarPage'
import { QuickPage, type QuickPick } from './QuickPage'
import { DEFAULT_PREFS } from '../../prefs/types'
import { kindOfIem } from '../../data/catalog'
import { loadPrefs } from '../../tournament/storage'
import { KINDS, kindDetail, kindLabel, type TourneyKind } from './kinds'

/** Matches in the double-elimination bracket (tournament/bracket.ts): 2N − 2. */
const matchCount = (n: number) => 2 * n - 2

function when(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function TournamentHome({ db, running, onNew, onContinue, onQuick, onSimilar }: { db: Database; running: TournamentSave | null; onNew: () => void; onContinue: () => void; onQuick: () => void; onSimilar: () => void }) {
  // read on every render: the page records a just-finished save into History after this first draws
  const history = loadHistory().slice().reverse()
  const name = (id: string) => db.catalog.byId.get(id)?.name ?? id
  const [selectedHistory, setSelectedHistory] = useState<HistoryEntry | null>(null)
  const [inspectingDevice, setInspectingDevice] = useState<string | null>(null)

  const photo = (id: string) => {
    const m = db.models.find((x) => x.members.some((y) => y.id === id))
    const img = m?.photoId ? db.catalog.images[m.photoId] : null
    return img ? imgUrl(img.src) : null
  }

  const trophyTitle = (kind?: string) => {
    if (kind === 'headphones') return '🎧 Headphone Audiophile Cup'
    if (kind === 'tws') return '⚡ True Wireless Championship Crown'
    return '🏆 IEM Dream Bracket Trophy'
  }

  return (
    <div className="ms-scroll">
      <div className="ms-page ms-tourney">
        <h1 className="ms-h1">Tournament</h1>

        <div className="ms-tourney-start">
          <button type="button" className="ms-tourney-hero main" onClick={onNew}>
            <span className="ms-tourney-lines" aria-hidden="true" />
            <Icon name="emoji_events" size={44} fill />
            <span className="ms-tourney-hero-text">
              <b>New tournament</b>
              <small>Blind matches through a bracket until one is left</small>
            </span>
            <span className="ms-tourney-kinds" aria-hidden="true">
              {KINDS.map((k) => <span key={k} className={`ms-kind-dot ${k}`} />)}
            </span>
          </button>
          <button type="button" className="ms-tourney-hero quick" onClick={onQuick}>
            <span className="ms-tourney-lines" aria-hidden="true" />
            <Icon name="bolt" size={44} fill />
            <span className="ms-tourney-hero-text">
              <b>Quick match</b>
              <small>Two of them, one blind round</small>
            </span>
          </button>
        </div>

        {running && (
          <section>
            <h2 className="ms-h2">{running.results.GF ? 'Latest' : 'Continue'}</h2>
            <button type="button" className={`ms-tourney-row ${(running.prefs.compare ?? 'iems') as TourneyKind}`} onClick={onContinue}>
              <span className="ms-kind-bar" aria-hidden="true" />
              <Icon name={running.results.GF ? 'emoji_events' : 'play_circle'} size={28} fill />
              <span className="grow">
                <b>{kindLabel(running.prefs.compare)} · {running.entrants.length} in the bracket</b>
                <small>{running.results.GF ? 'Finished · see the results' : `${Object.keys(running.results).length} of ${matchCount(running.entrants.length)} matches played`} · started {when(running.startedAt)}</small>
              </span>
              <Icon name="chevron_right" />
            </button>
          </section>
        )}

        <section>
          <h2 className="ms-h2">History &amp; Trophy Room</h2>
          {history.length === 0 ? (
            <p className="ms-tourney-empty">Finished tournaments show here with their champion and podium records.</p>
          ) : (
            <div className="ms-tourney-list">
              {history.map((h) => (
                <button
                  type="button"
                  className={`ms-tourney-row as-button ${(h.prefs.compare ?? 'iems') as TourneyKind}`}
                  key={h.id}
                  onClick={() => setSelectedHistory(h)}
                  title="View podium, trophies, and full standings"
                  style={{ textAlign: 'left', width: '100%' }}
                >
                  <span className="ms-kind-bar" aria-hidden="true" />
                  <Icon name="military_tech" size={28} fill />
                  <span className="grow">
                    <b>{name(h.championId)}</b>
                    <small>{kindLabel(h.prefs.compare)} · {h.size} entrants · runner-up {name(h.runnerUpId)} · {when(h.finishedAt)}</small>
                  </span>
                  <Icon name="chevron_right" />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* §106 C: same sound, other prices */}
        <button type="button" className="ms-tourney-hero similar" onClick={onSimilar}>
          <span className="ms-tourney-lines" aria-hidden="true" />
          <Icon name="compare_arrows" size={44} fill />
          <span className="ms-tourney-hero-text">
            <b>Find similar</b>
            <small>Same sound, every price: pick one, see what tunes like it</small>
          </span>
        </button>
      </div>

      {selectedHistory && (
        <Dialog
          title={trophyTitle(selectedHistory.prefs.compare)}
          wide
          onClose={() => setSelectedHistory(null)}
          footer={<button type="button" className="ms-btn text" onClick={() => setSelectedHistory(null)}>Close</button>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.85, fontSize: 14 }}>
              <span>{kindLabel(selectedHistory.prefs.compare)} Category · {selectedHistory.size} Contenders</span>
              <span>Finished: {when(selectedHistory.finishedAt)}</span>
            </div>

            {/* Podium Room */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              {[
                { place: '1st Champion', id: selectedHistory.championId, color: '#f59e0b', icon: 'emoji_events' },
                { place: '2nd Runner-Up', id: selectedHistory.runnerUpId, color: '#94a3b8', icon: 'military_tech' },
                { place: '3rd Place', id: selectedHistory.thirdId, color: '#b45309', icon: 'workspace_premium' },
              ].filter((p) => Boolean(p.id)).map((p) => {
                const img = photo(p.id)
                const dev = db.catalog.byId.get(p.id)
                const pr = priceOf(db.catalog, p.id)?.usd
                return (
                  <div
                    key={p.place}
                    onClick={() => setInspectingDevice(p.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: 16,
                      borderRadius: 16,
                      background: 'var(--field, rgba(255,255,255,0.05))',
                      border: `1px solid ${p.color}40`,
                      cursor: 'pointer',
                      textAlign: 'center',
                      gap: 8,
                    }}
                    title="Tap to view reviews & sound graph"
                  >
                    <span style={{ color: p.color, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700 }}>
                      <Icon name={p.icon} size={18} fill /> {p.place}
                    </span>
                    {img ? (
                      <img src={img} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 64, height: 64, borderRadius: 12, background: 'var(--chrome)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="headphones" size={32} />
                      </div>
                    )}
                    <b style={{ fontSize: 15, lineHeight: 1.2 }}>{dev?.name ?? p.id}</b>
                    {pr != null && <small style={{ opacity: 0.7 }}>${Math.round(pr)}</small>}
                  </div>
                )
              })}
            </div>

            {/* Full Roster Standings */}
            <div>
              <h4 style={{ margin: '8px 0 12px', fontSize: 15, fontWeight: 600 }}>All Contenders ({selectedHistory.entrants.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {selectedHistory.entrants.map((entId, idx) => {
                  const dev = db.catalog.byId.get(entId)
                  const img = photo(entId)
                  return (
                    <div
                      key={entId}
                      onClick={() => setInspectingDevice(entId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 12px',
                        borderRadius: 10,
                        background: 'var(--field, rgba(255,255,255,0.03))',
                        cursor: 'pointer',
                      }}
                      title="Tap to view reviews & sound graph"
                    >
                      <span style={{ opacity: 0.5, fontSize: 13, width: 24 }}>#{idx + 1}</span>
                      {img ? <img src={img} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} /> : <Icon name="headphones" size={20} />}
                      <span style={{ flex: 1, fontSize: 14 }}>{dev?.name ?? entId}</span>
                      <Icon name="chevron_right" size={16} />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {inspectingDevice && (() => {
        const iem = db.catalog.byId.get(inspectingDevice)
        const pr = priceOf(db.catalog, inspectingDevice)?.usd ?? db.models.find((x) => x.members.some((y) => y.id === inspectingDevice))?.usd
        const pImg = photo(inspectingDevice)
        return (
          <Dialog
            title={iem?.name ?? inspectingDevice}
            wide
            onClose={() => setInspectingDevice(null)}
            footer={<button type="button" className="ms-btn text" onClick={() => setInspectingDevice(null)}>Close</button>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0 12px' }}>
                {pImg ? (
                  <img src={pImg} alt="" style={{ width: 72, height: 72, borderRadius: 12, objectFit: 'cover', background: 'var(--field)' }} />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 12, background: 'var(--field)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="headphones" size={36} />
                  </div>
                )}
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{iem?.name ?? inspectingDevice}</h3>
                  <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 14 }}>
                    {[pr != null ? `$${Math.round(pr)}` : null, iem ? `Measured by ${iem.source.split(' (')[0]}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              {iem && <Graph catalog={db.catalog} iem={iem} />}
              {iem && <Reviews catalog={db.catalog} id={iem.id} />}
            </div>
          </Dialog>
        )
      })()}
    </div>
  )
}

type Rounds = ReturnType<typeof libraryRounds>
type View = { v: 'home' } | { v: 'quick'; initial?: [Model, Model] } | { v: 'similar'; refId: string | null; pickId: string | null } | { v: 'quickmatch'; q: QuickPick; rounds: Rounds } | { v: 'questions' } | { v: 'setup'; prefs: Preferences } | { v: 'bracket' } | { v: 'results' } | { v: 'match'; m: BracketMatch; rounds: Rounds }
type Vs = { m: BracketMatch; rounds: Rounds; first: Promise<unknown> }

export function TournamentPage() {
  const { data, setPlaying } = useShell()
  const { db, failed } = useDatabase()
  const refs = useRefs()
  const [save, setSave] = useState<TournamentSave | null>(() => loadTournament())
  const [view, setView] = useState<View>({ v: 'home' })
  const [vs, setVs] = useState<Vs | null>(null)
  const [quickVs, setQuickVs] = useState<{ q: QuickPick; rounds: Rounds; first: Promise<unknown> } | null>(null)
  /** §106 C: a Quick match started from Find similar goes back to its graph when it ends (and to its pair on Back). */
  const quickFrom = useRef<{ back: View; initial: [Model, Model] } | null>(null)
  /** The next match's rounds, started while the bracket is open. */
  const prefetched = useRef<Vs | null>(null)
  // bursts, speed lines and sounds into the cache before the first VS screen
  useEffect(() => warmFireWipes(), [])

  const bracket = useMemo(() => (save ? buildBracket(save.entrants.length, {
    bestOf: save.prefs.quickMode ? 1 : 3,
    lowerFinalBestOf: save.prefs.quickMode ? 1 : 5,
    grandFinalBestOf: save.prefs.quickMode ? 3 : 5,
  }) : null), [save])
  const done = Boolean(save && bracket && isComplete(bracket, save.results))
  /** A finished save goes into History once, however it got finished (here, or in the old app). */
  const recordHistory = (s: TournamentSave) => {
    if (!bracket || loadHistory().some((h) => h.id === s.startedAt)) return
    const p = placings(bracket, s.results)
    const idOf = (seed: number) => s.entrants[seed - 1]
    if (p.length >= 3) appendHistory({ id: s.startedAt, finishedAt: new Date().toISOString(), size: s.entrants.length, championId: idOf(p[0].seeds[0]), runnerUpId: idOf(p[1].seeds[0]), thirdId: idOf(p[2].seeds[0]), entrants: s.entrants, results: s.results, prefs: s.prefs })
  }
  // while the bracket is up, decode the next match's first song
  useEffect(() => {
    if (view.v !== 'bracket' || !save || !bracket) return
    const next = nextMatch(bracket, save.results)
    if (!next || prefetched.current?.m.id === next.id) return
    const pair = entrantsOf(bracket, next, save.results).map((seed) => save.entrants[seed! - 1]) as [string, string]
    const key = localStorage.getItem(SONGS_KEY) ?? 'library'
    const list = data.playlists.find((p) => p.id === key)
    const pool = songsFor(list ? data.tracks.filter((t) => list.tracks.includes(t.id)) : data.tracks, save.prefs.genres)
    const rounds = libraryRounds({ pool, heardBy: save.heardBy, entrants: pair, bestOf: next.bestOf })
    const first = rounds.prefetch()
    first.catch(() => {})
    prefetched.current = { m: next, rounds, first }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.v, save, bracket])
  useEffect(() => {
    if (done && save) recordHistory(save)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, save])
  // as in the old app: "Hide names until the results" hides every name; a field picked for you stays hidden
  // until each contender has played a match; and blind matches open on mystery contenders
  const hideAll = Boolean(save?.prefs.hideUntilResults) && !done
  const played = useMemo(() => (save && bracket ? playedIds(bracket, save.results, save.entrants) : new Set<string>()), [save, bracket])
  const masked = (seed: number | null) => {
    if (!save || seed === null) return false
    return hideAll || (Boolean(save.prefs.autoPick) && save.prefs.mystery === true && !done && !played.has(save.entrants[seed - 1]))
  }

  if (!db) return <DatabaseStatus failed={failed} />

  const store = (s: TournamentSave | null) => {
    saveTournament(s)
    setSave(s)
  }
  const ids = (s: TournamentSave, m: BracketMatch): [string, string] => entrantsOf(bracket!, m, s.results).map((seed) => s.entrants[seed! - 1]) as [string, string]
  const songsPool = () => {
    const key = localStorage.getItem(SONGS_KEY) ?? 'library'
    const list = data.playlists.find((p) => p.id === key)
    return songsFor(list ? data.tracks.filter((t) => list.tracks.includes(t.id)) : data.tracks, save?.prefs.genres)
  }
  const photoOf = (id: string) => {
    const m = db.models.find((x) => x.members.some((y) => y.id === id))
    const img = m?.photoId ? db.catalog.images[m.photoId] : null
    return img ? imgUrl(img.src) : null
  }

  const play = (m: BracketMatch) => {
    if (!save) return
    setPlaying(false)
    // the bracket already started decoding this match's first song, so the VS screen is ready at once
    const ready = prefetched.current?.m.id === m.id ? prefetched.current : null
    prefetched.current = null
    const rounds = ready?.rounds ?? libraryRounds({ pool: songsPool(), heardBy: save.heardBy, entrants: ids(save, m), bestOf: m.bestOf })
    setVs({ m, rounds, first: ready?.first ?? rounds.prefetch() })
  }

  const finish = (m: BracketMatch, winner: 0 | 1, wins: [number, number], rounds: Rounds) => {
    if (!save || !bracket) return
    const next: TournamentSave = { ...save, results: { ...save.results, [m.id]: { winner, wins } }, heardBy: rounds.commit(save.heardBy) }
    store(next)
    if (!isComplete(bracket, next.results)) return setView({ v: 'bracket' })
    recordHistory(next)
    setView({ v: 'results' })
  }

  /** Quick match: what you listen on comes from the saved answers (a tournament's setup sets it). */
  const quickPrefs = (): Preferences => ({ ...DEFAULT_PREFS, ...loadPrefs() }) as Preferences
  const startQuick = (q: QuickPick) => {
    setPlaying(false)
    const rounds = libraryRounds({ pool: songsFor(data.tracks, quickPrefs().genres), heardBy: {}, entrants: q.ids, bestOf: q.bestOf })
    setQuickVs({ q, rounds, first: rounds.prefetch() })
  }

  let page
  if (view.v === 'similar') {
    page = (
      <SimilarPage
        db={db}
        refId={view.refId}
        pickId={view.pickId}
        onChange={(refId, pickId) => setView({ v: 'similar', refId, pickId })}
        onBack={() => setView({ v: 'home' })}
        onListen={(a, b) => {
          quickFrom.current = { back: view, initial: [a, b] }
          setView({ v: 'quick', initial: [a, b] })
        }}
      />
    )
  } else if (view.v === 'quick') {
    page = (
      <QuickPage
        key={view.initial?.map((m) => m.id).join('|') ?? 'quick'}
        db={db}
        initial={view.initial}
        onCancel={() => {
          const from = quickFrom.current
          quickFrom.current = null
          setView(from && view.initial ? from.back : { v: 'home' })
        }}
        onStart={startQuick}
      />
    )
  } else if (view.v === 'quickmatch' && refs) {
    const prefs = quickPrefs()
    const entrants: [Iem, Iem] = [db.catalog.byId.get(view.q.ids[0])!, db.catalog.byId.get(view.q.ids[1])!]
    const rounds = view.rounds
    const device = prefs.currentId ? db.catalog.byId.get(prefs.currentId) : undefined
    page = (
      <MatchPage
        key={view.q.ids.join('|')}
        data={db.catalog.data}
        entrants={entrants}
        names={[entrants[0].name, entrants[1].name]}
        photos={[photoOf(entrants[0].id), photoOf(entrants[1].id)]}
        hideNames={false}
        device={device}
        spaces={[backSpaceFor(db.catalog, entrants[0], prefs), backSpaceFor(db.catalog, entrants[1], prefs)]}
        reference={referenceFor(db.catalog, refs, prefs)}
        candidateDb={(iem) => candidateFr(db.catalog, iem, prefs)}
        mode={prefs.mode}
        bestOf={view.q.bestOf}
        heading={`Quick match · best of ${view.q.bestOf}`}
        isGrandFinal={false}
        fullTreble={matchFullTreble(refs, prefs, view.q.ids)}
        getRound={rounds.getRound}
        loadProgress={rounds.progress}
        // from Find similar: back to the pair's graph, 5 s after the result or on Continue
        autoContinueMs={quickFrom.current ? 5000 : undefined}
        onDone={() => {
          const from = quickFrom.current
          quickFrom.current = null
          setView(from ? from.back : { v: 'home' })
        }}
        onLeave={() => setView({ v: 'quick', initial: quickFrom.current?.initial })}
      />
    )
  } else if (view.v === 'questions') {
    page = <QuestionsPage onCancel={() => setView({ v: 'home' })} onDone={(prefs) => setView({ v: 'setup', prefs })} />
  } else if (view.v === 'setup') {
    page = <SetupPage db={db} prefs={view.prefs} onCancel={() => setView({ v: 'questions' })} onStart={(s) => { store(s); setView({ v: 'bracket' }) }} />
  } else if (view.v === 'bracket' && save && bracket) {
    page = <BracketPage db={db} save={save} bracket={bracket} masked={masked} onBack={() => setView({ v: 'home' })} onPlay={play} />
  } else if (view.v === 'results' && save && bracket && done) {
    page = <ResultsPage db={db} save={save} bracket={bracket} onBack={() => setView({ v: 'home' })} onBracket={() => setView({ v: 'bracket' })} onNew={() => setView({ v: 'questions' })} />
  } else if (view.v === 'match' && save && bracket && refs) {
    const [a, b] = ids(save, view.m)
    const entrants: [Iem, Iem] = [db.catalog.byId.get(a)!, db.catalog.byId.get(b)!]
    const seeds = entrantsOf(bracket, view.m, save.results)
    const m = view.m
    const rounds = view.rounds
    const device = save.prefs.currentId ? db.catalog.byId.get(save.prefs.currentId) : undefined
    page = (
      <MatchPage
        key={m.id}
        data={db.catalog.data}
        entrants={entrants}
        names={[contenderName(db, save, seeds[0], hideAll), contenderName(db, save, seeds[1], hideAll)]}
        photos={[photoOf(a), photoOf(b)]}
        hideNames={hideAll}
        device={device}
        spaces={[backSpaceFor(db.catalog, entrants[0], save.prefs), backSpaceFor(db.catalog, entrants[1], save.prefs)]}
        reference={referenceFor(db.catalog, refs, save.prefs)}
        candidateDb={(iem) => candidateFr(db.catalog, iem, save.prefs)}
        mode={save.prefs.mode}
        bestOf={m.bestOf}
        heading={`Match ${m.playOrder} of ${bracket.matches.length}`}
        isGrandFinal={m.bracket === 'grand'}
        fullTreble={matchFullTreble(refs, save.prefs, [a, b])}
        getRound={rounds.getRound}
        loadProgress={rounds.progress}
        onDone={(winner, st) => finish(m, winner, st.wins, rounds)}
        onLeave={() => setView({ v: 'bracket' })}
      />
    )
  } else {
    page = <TournamentHome db={db} running={save} onNew={() => setView({ v: 'questions' })} onQuick={() => { quickFrom.current = null; setView({ v: 'quick' }) }} onSimilar={() => setView({ v: 'similar', refId: null, pickId: null })} onContinue={() => setView({ v: done ? 'results' : 'bracket' })} />
  }

  const vsSide = (s: TournamentSave, seed: number | null): VsSide => {
    const id = seed ? s.entrants[seed - 1] : ''
    const iem = id ? db.catalog.byId.get(id) : undefined
    const kind = (s.prefs.compare ?? 'iems') as VsSide['kind']
    return { name: contenderName(db, s, seed, masked(seed)), photo: id ? photoOf(id) : null, seed, kind, masked: s.prefs.blind !== false || masked(seed) || !seed, detail: kindDetail(kind, iem?.back) }
  }

  let vsNode = null
  if (vs && save && bracket) {
    const seeds = entrantsOf(bracket, vs.m, save.results)
    const m = vs.m
    vsNode = (
      <VsScreen
        left={vsSide(save, seeds[0])}
        right={vsSide(save, seeds[1])}
        round={`Match ${m.playOrder} of ${bracket.matches.length}`}
        stakes={m.bracket === 'grand' ? 'Grand final · the title is on the line' : m.bracket === 'lower' ? 'Lower bracket · the loser is out' : 'Upper bracket · the winner advances'}
        ready={vs.first}
        onStart={() => {
          setView({ v: 'match', m, rounds: vs.rounds })
          setVs(null)
        }}
      />
    )
  }

  if (quickVs) {
    const side = (id: string): VsSide => {
      const iem = db.catalog.byId.get(id)
      const kind = (iem ? kindOfIem(iem) : 'iems') as VsSide['kind']
      return { name: iem?.name ?? id, photo: photoOf(id), seed: null, kind, masked: true, detail: kindDetail(kind, iem?.back) }
    }
    vsNode = (
      <VsScreen
        left={side(quickVs.q.ids[0])}
        right={side(quickVs.q.ids[1])}
        round={`Quick match · Best of ${quickVs.q.bestOf}`}
        stakes="One match · blind"
        ready={quickVs.first}
        onStart={() => {
          setView({ v: 'quickmatch', q: quickVs.q, rounds: quickVs.rounds })
          setQuickVs(null)
        }}
      />
    )
  }

  return (
    <>
      {page}
      {vsNode}
    </>
  )
}

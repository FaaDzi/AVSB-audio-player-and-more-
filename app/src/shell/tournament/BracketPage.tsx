// The bracket (§65 step 3): upper and lower brackets as columns of rounds, then the grand final; the next match is lit.
import { Icon, TopBar } from '../ui'
import type { Database } from '../database/catalog'
import { describeSlot, entrantsOf, nextMatch, type Bracket, type BracketMatch } from '../../tournament/bracket'
import type { TournamentSave } from '../../tournament/storage'
import { kindLabel } from './kinds'

export function contenderName(db: Database, save: TournamentSave, seed: number | null, masked: boolean): string {
  if (seed === null) return '—'
  if (masked) return `Contender #${seed}`
  const id = save.entrants[seed - 1]
  return db.catalog.byId.get(id)?.name ?? id
}

/** Whether a seed's name is hidden: "Hide names until the results", or a picked-for-you field until it has played. */
export type MaskFn = (seed: number | null) => boolean

function MatchCard({ db, save, bracket, m, next, masked }: { db: Database; save: TournamentSave; bracket: Bracket; m: BracketMatch; next: boolean; masked: MaskFn }) {
  const seeds = entrantsOf(bracket, m, save.results)
  const r = save.results[m.id]
  return (
    <div className={`ms-tz-match${next ? ' next' : ''}${r ? ' done' : ''}`}>
      <div className="ms-tz-match-head"><span>Match {m.playOrder}</span><span>Bo{m.bestOf}</span></div>
      {[0, 1].map((side) => {
        const won = r ? r.winner === side : false
        return (
          <div key={side} className={`ms-tz-slot${won ? ' won' : r ? ' lost' : ''}`}>
            <span className="ms-tz-seed">{seeds[side] ?? ''}</span>
            <span className="grow ms-ellipsis">{seeds[side] !== null ? contenderName(db, save, seeds[side], masked(seeds[side])) : describeSlot(bracket, m.slots[side])}</span>
            {r && <b>{r.wins[side]}</b>}
          </div>
        )
      })}
    </div>
  )
}

function Columns({ title, rounds, ...rest }: { title: string; rounds: BracketMatch[][]; db: Database; save: TournamentSave; bracket: Bracket; nextId?: string; masked: MaskFn }) {
  return (
    <section className="ms-tz-half">
      <h2 className="ms-h2">{title}</h2>
      <div className="ms-tz-cols">
        {rounds.map((round, i) => (
          <div className="ms-tz-col" key={i}>
            <small>{round[0]?.label}</small>
            {round.map((m) => <MatchCard key={m.id} m={m} next={m.id === rest.nextId} {...rest} />)}
          </div>
        ))}
      </div>
    </section>
  )
}

const byRound = (ms: BracketMatch[]) => {
  const rounds: BracketMatch[][] = []
  for (const m of ms) (rounds[m.round - 1] ??= []).push(m)
  return rounds.map((r) => r.sort((a, b) => a.index - b.index))
}

export function BracketPage({ db, save, bracket, masked, onBack, onPlay }: { db: Database; save: TournamentSave; bracket: Bracket; masked: MaskFn; onBack: () => void; onPlay: (m: BracketMatch) => void }) {
  const next = nextMatch(bracket, save.results)
  const played = Object.keys(save.results).length
  const props = { db, save, bracket, nextId: next?.id, masked }
  const kind = save.prefs.compare ?? 'iems'
  return (
    <div className="ms-scroll">
      <TopBar back={onBack} title={`${kindLabel(kind)} tournament`} />
      <div className={`ms-page ms-tz-bracket ${kind}`}>
        <div className={`ms-tz-next ${kind}`}>
          <span className="ms-tourney-lines" aria-hidden="true" />
          <div className="grow">
            <small>{next ? `Match ${next.playOrder} of ${bracket.matches.length}` : 'All matches played'}</small>
            <b>{next ? entrantsOf(bracket, next, save.results).map((s) => contenderName(db, save, s, masked(s))).join('  vs  ') : 'The results are in'}</b>
            <div className="ms-tz-progress"><span style={{ width: `${(played / bracket.matches.length) * 100}%` }} /></div>
          </div>
          {next && (
            <button type="button" className="ms-btn ms-tz-play" onClick={() => onPlay(next)}>
              <Icon name="play_arrow" fill /> Play match
            </button>
          )}
        </div>
        <Columns title="Upper bracket" rounds={byRound(bracket.matches.filter((m) => m.bracket === 'upper'))} {...props} />
        <Columns title="Lower bracket" rounds={byRound(bracket.matches.filter((m) => m.bracket === 'lower'))} {...props} />
        <Columns title="Grand final" rounds={byRound(bracket.matches.filter((m) => m.bracket === 'grand'))} {...props} />
      </div>
    </div>
  )
}

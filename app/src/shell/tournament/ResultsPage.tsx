// Results (§65 step 5): as in the old app, a drumroll lights the podium (3rd, then 2nd, then the champion with a
// fanfare and confetti), then awards under the podium, then every placing from the double-elimination bracket.
import { useEffect, useState } from 'react'
import { Dialog, Icon, TopBar } from '../ui'
import { fireConfetti, sfx } from '../../audio/sfx'
import { priceOf } from '../../data/catalog'
import { imgUrl } from '../../reviews/reviews'
import type { Database } from '../database/catalog'
import { computeAwards } from '../../tournament/awards'
import { placings, type Bracket } from '../../tournament/bracket'
import type { TournamentSave } from '../../tournament/storage'
import { reducedMotion } from './motion'
import { Graph, Reviews } from '../database/DevicePage'

const REVEALED_KEY = 'shell.tourney.revealed'
const PICK_TITLE = { flawless: 'FLAWLESS', dominating: 'DOMINATING', favourite: 'FAVOURITE' } as const
const COMEBACK_TITLE = { perfect: 'PERFECT COMEBACK', great: 'GREAT COMEBACK', comeback: 'COMEBACK' } as const

export function ResultsPage({ db, save, bracket, onBack, onBracket, onNew }: { db: Database; save: TournamentSave; bracket: Bracket; onBack: () => void; onBracket: () => void; onNew: () => void }) {
  const places = placings(bracket, save.results)
  const idOf = (seed: number) => save.entrants[seed - 1]
  const model = (id: string) => db.catalog.byId.get(id)
  const nameOf = (seed: number) => model(idOf(seed))?.name ?? idOf(seed)
  const photo = (id: string) => {
    const m = db.models.find((x) => x.members.some((y) => y.id === id))
    const img = m?.photoId ? db.catalog.images[m.photoId] : null
    return img ? imgUrl(img.src) : null
  }
  const priceForSeed = (seed: number) => {
    const id = idOf(seed)
    return priceOf(db.catalog, id)?.usd ?? db.models.find((x) => x.members.some((y) => y.id === id))?.usd ?? null
  }
  const awards = computeAwards(bracket, save.results, save.entrants.length, {
    priceOf: priceForSeed,
    randomSeeds: save.prefs.hideUntilResults === true,
  })
  const awardCards: { key: string; cls: string; icon: string; title: string; seed: number; sub: string }[] = []
  if (awards.pickRate) {
    const p = awards.pickRate
    awardCards.push({
      key: 'pick',
      cls: `pick ${p.tier}`,
      icon: '★',
      title: PICK_TITLE[p.tier],
      seed: p.seed,
      sub: `Picked in ${p.won} of ${p.played} songs (${Math.round((100 * p.won) / p.played)} %)`,
    })
  }
  if (awards.comeback) {
    const b = awards.comeback
    awardCards.push({
      key: 'comeback',
      cls: `comeback ${b.tier}`,
      icon: '↺',
      title: COMEBACK_TITLE[b.tier],
      seed: b.seed,
      sub: b.tier === 'perfect' ? 'Lost a match and still won it all' : `Lost a match, fought back to ${b.place}`,
    })
  }
  if (awards.darkHorse) {
    const d = awards.darkHorse
    awardCards.push({
      key: 'horse',
      cls: 'dark-horse',
      icon: '♞',
      title: 'DARK HORSE',
      seed: d.seed,
      sub: `Seed ${d.seed}, finished ${d.place}`,
    })
  }
  if (awards.goliath) {
    const g = awards.goliath
    awardCards.push({
      key: 'goliath',
      cls: 'goliath',
      icon: '⚔',
      title: 'GOLIATH',
      seed: g.seed,
      sub: `$${Math.round(g.price)} beat the $${Math.round(g.beatPrice)} ${nameOf(g.beat)}`,
    })
  }
  if (awards.heartbreak) {
    const h = awards.heartbreak
    awardCards.push({
      key: 'heart',
      cls: 'heartbreak',
      icon: '♡',
      title: 'HEARTBREAK',
      seed: h.seed,
      sub: `Lost ${h.score[0]}–${h.score[1]} to ${nameOf(h.to)}`,
    })
  }

  const podium = places.slice(0, 3).map((p) => idOf(p.seeds[0]))
  const kind = save.prefs.compare ?? 'iems'
  const seen = localStorage.getItem(REVEALED_KEY) === save.startedAt
  // 0 = nothing lit yet … 3 = champion shown
  const [lit, setLit] = useState(seen || reducedMotion() ? 3 : 0)
  const [inspecting, setInspecting] = useState<string | null>(null)

  useEffect(() => {
    if (lit === 3) return
    const roll = sfx.playDrumroll(3.2, 0.5)
    const light = (n: number, pan: number) => () => {
      sfx.playStamp(0.65, pan)
      setLit(n)
    }
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(light(1, 0.4), 900),
      setTimeout(light(2, -0.4), 1900),
      setTimeout(() => {
        localStorage.setItem(REVEALED_KEY, save.startedAt)
        setLit(3)
        sfx.playChampion()
        fireConfetti(3200)
      }, 3100),
      ...awardCards.map((_, i) => setTimeout(() => sfx.playPop(), 3400 + i * 130)),
    ]
    return () => {
      roll.stop()
      timers.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // podium order on screen: 2nd, 1st, 3rd; lit order: 3rd (1), 2nd (2), 1st (3)
  const step = (place: number) => (place === 2 ? 1 : place === 1 ? 2 : 3)
  const card = (place: number) => {
    const id = podium[place]
    if (!id) return null
    const on = lit >= step(place)
    return (
      <div
        key={place}
        className={`ms-tz-podium-card p${place + 1}${on ? ' on' : ''}`}
        onClick={() => on && setInspecting(id)}
        style={{ cursor: on ? 'pointer' : 'default' }}
        title={on ? 'Tap to view reviews, scores & frequency response graph' : undefined}
      >
        <span className="ms-tz-podium-photo">{on ? (photo(id) ? <img src={photo(id)!} alt="" /> : <Icon name="headphones" size={48} />) : <Icon name="question_mark" size={48} />}</span>
        <b>{on ? model(id)?.name ?? id : '…'}</b>
        <span className="ms-tz-podium-step">{['1st', '2nd', '3rd'][place]}</span>
      </div>
    )
  }

  return (
    <div className="ms-scroll">
      <TopBar back={onBack} title="Results" actions={<button type="button" className="ms-btn text" onClick={onBracket}>Bracket</button>} />
      <div className={`ms-page ms-tz-results ${kind}`}>
        <div className={`ms-tz-podium ${kind}${lit === 3 ? ' done' : ''}`}>
          <span className="ms-tourney-lines" aria-hidden="true" />
          <div className="ms-tz-podium-title">{lit === 3 ? <><Icon name="emoji_events" size={22} fill /> Champion: {model(podium[0])?.name ?? podium[0]}</> : 'And the champion is…'}</div>
          <div className="ms-tz-podium-row">{[1, 0, 2].map(card)}</div>
        </div>
        {lit === 3 && (
          <>
            {awardCards.length > 0 && (
              <div className="ms-tz-awards" aria-label="Tournament awards">
                {awardCards.map((a, i) => {
                  const id = idOf(a.seed)
                  const p = photo(id)
                  return (
                    <div
                      key={a.key}
                      className={`ms-tz-award ${a.cls}`}
                      style={{ animationDelay: `${i * 120}ms`, cursor: 'pointer' }}
                      onClick={() => setInspecting(id)}
                      title="Tap to view reviews & sound graph"
                    >
                      <span className="ms-tz-award-icon" aria-hidden="true">{a.icon}</span>
                      <span className="ms-tz-photo">{p ? <img src={p} alt="" /> : <Icon name="headphones" size={22} />}</span>
                      <div className="ms-tz-award-body">
                        <span className="ms-tz-award-title">{a.title}</span>
                        <b>{nameOf(a.seed)}</b>
                        <small>{a.sub}</small>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="ms-tz-note">Your ears picked it blind, over {save.entrants.length - 1} others. Tap any contender to view its reviews and sound curve.</p>
            <div className="ms-tz-places">
              {places.map((p, i) => (
                <div
                  className={`ms-tz-place${i < 3 ? ` top${i + 1}` : ''}`}
                  key={p.place}
                  onClick={() => p.seeds[0] && setInspecting(idOf(p.seeds[0]))}
                  style={{ cursor: 'pointer' }}
                  title="Tap to view reviews & sound graph"
                >
                  <span className="ms-tz-place-n">{p.place}</span>
                  <span className="grow">{p.seeds.map((s) => model(idOf(s))?.name ?? idOf(s)).join(', ')}</span>
                  <Icon name="chevron_right" size={18} />
                </div>
              ))}
            </div>
            <div className="ms-tz-go">
              <button type="button" className="ms-btn primary" onClick={onNew}><Icon name="add" size={20} /> New tournament</button>
            </div>
          </>
        )}
      </div>

      {inspecting && (() => {
        const iem = db.catalog.byId.get(inspecting)
        const pr = priceOf(db.catalog, inspecting)?.usd ?? db.models.find((x) => x.members.some((y) => y.id === inspecting))?.usd
        const pImg = photo(inspecting)
        return (
          <Dialog
            title={iem?.name ?? inspecting}
            wide
            onClose={() => setInspecting(null)}
            footer={<button type="button" className="ms-btn text" onClick={() => setInspecting(null)}>Close</button>}
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
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{iem?.name ?? inspecting}</h3>
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

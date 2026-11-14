// Tournament setup (§65 step 2): kind, size, format, what you listen on, the contenders and the songs.
import { getGear, setActive } from '../sound/gear'
import { useMemo, useState } from 'react'
import { Icon, TopBar } from '../ui'
import { useShell } from '../context'
import { imgUrl } from '../../reviews/reviews'
import { listModels, type Database, type Model } from '../database/catalog'
import { kindOfIem, type Catalog } from '../../data/catalog'
import { pickGameRoster, type SlotRole } from '../../prefs/scoring'
import { genreGroup } from '../../songs/genres'
import type { Track } from '../library'
import { DEFAULT_PREFS, type Preferences } from '../../prefs/types'
import type { TournamentSave } from '../../tournament/storage'
import { shuffleSeeds } from '../../tournament/bracket'
import { canPlay } from '../library'
import { KINDS, kindLabel, type TourneyKind } from './kinds'

export const SONGS_KEY = 'shell.tourney.songs'
const SIZES = [4, 8, 16] as const

function Photo({ db, model }: { db: Database; model: Model }) {
  const photo = model.photoId ? db.catalog.images[model.photoId] : null
  return <span className="ms-tz-photo">{photo ? <img src={imgUrl(photo.src)} alt="" loading="lazy" decoding="async" /> : <Icon name="headphones" />}</span>
}

/** The merged catalog narrowed to one kind, for the old roster logic (it ranks every row it's given). */
function kindCatalog(c: Catalog, kind: TourneyKind): Catalog {
  return { ...c, kind, data: { ...c.data, iems: c.data.iems.filter((i) => kindOfIem(i) === kind) } }
}

/**
 * "Pick for me", as in the old app (GDD section 5): your own gear as seed 1 when it's this kind, the best matches for
 * your answers within budget (at most 2 per brand), one stretch pick above budget and one dark horse in another flavour.
 */
export function autoPick(db: Database, prefs: Preferences, kind: TourneyKind): { ids: string[]; roles: Record<string, SlotRole> } {
  const c = kindCatalog(db.catalog, kind)
  const own = prefs.currentId ? db.catalog.byId.get(prefs.currentId) : undefined
  const p: Preferences = { ...prefs, compare: kind, includeCurrent: Boolean(own && kindOfIem(own) === kind) }
  return pickGameRoster(c, p)
}

/** The songs for the tournament: the chosen list, narrowed to the picked genre groups when that still leaves 3 or more. */
export function songsFor(tracks: Track[], genres: string[] | undefined): Track[] {
  if (!genres?.length) return tracks
  const narrowed = tracks.filter((t) => t.genre && t.genre.split(/[;,/]/).some((g) => genres.includes(genreGroup(g.trim().toLowerCase()))))
  return narrowed.length >= 3 ? narrowed : tracks
}

export function SetupPage({ db, prefs: answers, onCancel, onStart }: { db: Database; prefs: Preferences; onCancel: () => void; onStart: (save: TournamentSave, songs: string) => void }) {
  const { data } = useShell()
  const saved = useMemo(() => ({ ...DEFAULT_PREFS, ...answers }) as Preferences, [answers])
  const [kind, setKind] = useState<TourneyKind>((saved.compare as TourneyKind) ?? 'iems')
  const [size, setSize] = useState<number>(SIZES.includes(saved.size as 4) ? saved.size : 8)
  const [quick, setQuick] = useState(Boolean(saved.quickMode))
  /** Headphone brackets: open (incl. semi-open), closed, or both, as the old questionnaire asked. */
  const [backs, setBacks] = useState<'any' | 'open' | 'closed'>(saved.hpType === 'open' || saved.hpType === 'closed' ? saved.hpType : 'any')
  const [hideNames, setHideNames] = useState(Boolean(saved.hideUntilResults))
  const [device, setDevice] = useState<string | null>(saved.currentId ?? null)
  const [deviceQuery, setDeviceQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  /** The field came from Pick for me: as in the old app, those stay mystery contenders until they've played. */
  const [autoPicked, setAutoPicked] = useState(false)
  const [roles, setRoles] = useState<Record<string, SlotRole>>({})
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState(() => localStorage.getItem(SONGS_KEY) ?? 'library')

  const byId = useMemo(() => new Map(db.models.map((m) => [m.id, m])), [db])
  const backOk = (m: Model) => kind !== 'headphones' || backs === 'any' || (backs === 'closed' ? m.members[0].back === 'closed' : m.members[0].back === 'open' || m.members[0].back === 'semi-open')
  const candidates = useMemo(() => listModels(db.models, { query, kinds: new Set([kind]), reviewedOnly: !query, sort: query ? 'name' : 'score' }).filter(backOk).slice(0, 60),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, query, kind, backs])
  const deviceMatches = useMemo(() => (deviceQuery ? listModels(db.models, { query: deviceQuery, kinds: new Set(KINDS), reviewedOnly: false, sort: 'name' }).slice(0, 8) : []), [db, deviceQuery])
  const pool = songsFor(songs === 'library' ? data.tracks : data.tracks.filter((t) => data.playlists.find((p) => p.id === songs)?.tracks.includes(t.id)), saved.genres)
  const playable = pool.filter(canPlay).length
  const ready = picked.length === size && playable >= 3

  const toggle = (id: string) => {
    setAutoPicked(false)
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < size ? [...p, id] : p))
  }
  const changeKind = (k: TourneyKind) => {
    setKind(k)
    setPicked([])
    setRoles({})
  }
  const changeSize = (n: number) => {
    setSize(n)
    setPicked((p) => p.slice(0, n))
  }

  const start = () => {
    const prefs: Preferences = { ...saved, compare: kind, size: size as Preferences['size'], quickMode: quick, hideUntilResults: hideNames, currentId: device, hpType: kind === 'headphones' ? backs : undefined, blind: true, autoPick: autoPicked, mystery: autoPicked }
    localStorage.setItem(SONGS_KEY, songs)
    // one device everywhere: what the tournament simulates on becomes your active gear (My gear)
    if (device !== getGear().active) setActive(device)
    // your own gear keeps seed 1, as in the old app; the rest are seeded at random
    const yours = picked.find((id) => roles[id] === 'yours')
    const entrants = yours ? [yours, ...shuffleSeeds(picked.filter((id) => id !== yours))] : shuffleSeeds(picked)
    onStart({ version: 1, prefs, entrants, roles: autoPicked ? roles : undefined, results: {}, heardBy: {}, startedAt: new Date().toISOString() }, songs)
  }

  const deviceModel = device ? byId.get(device) ?? null : null

  return (
    <div className="ms-scroll">
      <TopBar back={onCancel} title="New tournament" />
      <div className="ms-page ms-tz-setup">
        <section className="ms-tz-step">
          <h2 className="ms-h2">What's competing</h2>
          <div className="ms-tz-kinds">
            {KINDS.map((k) => (
              <button type="button" key={k} className={`ms-tz-kind ${k}${k === kind ? ' on' : ''}`} onClick={() => changeKind(k)} aria-pressed={k === kind}>
                <span className="ms-tourney-lines" aria-hidden="true" />
                <Icon name={k === 'headphones' ? 'headphones' : k === 'tws' ? 'earbuds' : 'earbuds_battery'} size={32} fill />
                <b>{kindLabel(k)}</b>
              </button>
            ))}
          </div>
          <div className="ms-tz-options">
            <div className="ms-tz-seg" role="group" aria-label="Bracket size">
              {SIZES.map((n) => <button type="button" key={n} className={n === size ? 'on' : ''} onClick={() => changeSize(n)}>{n}</button>)}
              <small>in the bracket</small>
            </div>
            <div className="ms-tz-seg" role="group" aria-label="Format">
              <button type="button" className={!quick ? 'on' : ''} onClick={() => setQuick(false)}>Best of 3</button>
              <button type="button" className={quick ? 'on' : ''} onClick={() => setQuick(true)}>Best of 1</button>
              <small>{quick ? 'finals best of 3' : 'finals best of 5'}</small>
            </div>
            {kind === 'headphones' && (
              <div className="ms-tz-seg" role="group" aria-label="Headphone type">
                {(['any', 'open', 'closed'] as const).map((b) => <button type="button" key={b} className={b === backs ? 'on' : ''} onClick={() => { setBacks(b); setPicked([]); setRoles({}) }}>{b === 'any' ? 'Both' : b === 'open' ? 'Open back' : 'Closed back'}</button>)}
              </div>
            )}
            <label className="ms-tz-toggle">
              <input type="checkbox" className="ms-switch" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
              <span>Hide names until the results</span>
            </label>
          </div>
        </section>

        <section className="ms-tz-step">
          <h2 className="ms-h2">What you listen on</h2>
          <p className="ms-tz-note">Every contender is simulated on this, so you hear their tuning through your own gear.</p>
          {deviceModel ? (
            <div className="ms-tz-device">
              <Photo db={db} model={deviceModel} />
              <b className="grow">{deviceModel.name}</b>
              <button type="button" className="ms-btn text" onClick={() => setDevice(null)}>Change</button>
            </div>
          ) : (
            <>
              <label className="ms-search">
                <Icon name="search" />
                <input placeholder="Search your IEM or headphone" aria-label="Search your device" value={deviceQuery} onChange={(e) => setDeviceQuery(e.target.value)} />
              </label>
              <div className="ms-tz-list">
                {deviceMatches.map((m) => (
                  <button type="button" key={m.id} className="ms-tz-row" onClick={() => { setDevice(m.id); setDeviceQuery('') }}>
                    <Photo db={db} model={m} />
                    <span className="grow">{m.name}</span>
                    <small>{kindLabel(m.kind)}</small>
                  </button>
                ))}
              </div>
              {!deviceQuery && <p className="ms-tz-note">Not set: a typical {kindLabel(saved.listeningOn === 'headphones' ? 'headphones' : 'iems').toLowerCase()} tuning is used instead.</p>}
            </>
          )}
        </section>

        <section className="ms-tz-step">
          <div className="ms-tz-head">
            <h2 className="ms-h2">Contenders <span className="ms-tz-count">{picked.length} / {size}</span></h2>
            <button type="button" className="ms-btn tonal" onClick={() => { const r = autoPick(db, { ...saved, size: size as Preferences['size'], currentId: device, hpType: kind === 'headphones' ? backs : undefined }, kind); setPicked(r.ids.slice(0, size)); setRoles(r.roles); setAutoPicked(true) }}><Icon name="casino" size={20} /> Pick for me</button>
          </div>
          {picked.length > 0 && (
            <div className="ms-tz-picked">
              {picked.map((id) => {
                const m = byId.get(id)
                return m ? (
                  <button type="button" key={id} className={`ms-tz-pick ${kind}`} onClick={() => toggle(id)} title="Remove">
                    <Photo db={db} model={m} />
                    <span>{m.name}</span>
                    {roles[id] && roles[id] !== 'pick' && <em className="ms-tz-role">{roles[id] === 'yours' ? 'Yours' : roles[id] === 'stretch' ? 'Stretch pick' : 'Dark horse'}</em>}
                    <Icon name="close" size={16} />
                  </button>
                ) : null
              })}
            </div>
          )}
          <label className="ms-search">
            <Icon name="search" />
            <input placeholder={`Search ${kindLabel(kind)}`} aria-label="Search contenders" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="ms-tz-list">
            {candidates.map((m) => {
              const on = picked.includes(m.id)
              return (
                <button type="button" key={m.id} className={`ms-tz-row${on ? ' on' : ''}`} onClick={() => toggle(m.id)} disabled={!on && picked.length >= size}>
                  <Photo db={db} model={m} />
                  <span className="grow">{m.name}</span>
                  {m.score !== null && <small>{m.score.toFixed(1)}</small>}
                  <Icon name={on ? 'check_circle' : 'add_circle'} fill={on} />
                </button>
              )
            })}
          </div>
        </section>

        <section className="ms-tz-step">
          <h2 className="ms-h2">Songs</h2>
          <div className="ms-tz-songs">
            <button type="button" className={`ms-chip${songs === 'library' ? ' on' : ''}`} onClick={() => setSongs('library')}>Whole library</button>
            {data.playlists.map((p) => <button type="button" key={p.id} className={`ms-chip${songs === p.id ? ' on' : ''}`} onClick={() => setSongs(p.id)}>{p.name}</button>)}
          </div>
          <p className="ms-tz-note">{playable} playable songs{saved.genres?.length ? ' in your genres' : ''}. Each round picks a different one and plays one of its liveliest 40-second parts.</p>
        </section>

        <div className="ms-tz-go">
          <button type="button" className="ms-btn primary full" disabled={!ready} onClick={start}>
            <Icon name="emoji_events" size={20} /> {ready ? 'Start the tournament' : picked.length < size ? `Pick ${size - picked.length} more` : 'Choose a list with at least 3 playable songs'}
          </button>
        </div>
      </div>
    </div>
  )
}

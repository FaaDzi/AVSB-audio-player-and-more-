import '../eqStudio.css'
import { useMemo, useState } from 'react'
import { graphOf, priceOf, splitName, type Catalog } from '../../data/catalog'
import type { Iem } from '../../audio/data'
import { imgUrl } from '../../reviews/reviews'
import { messagesFor } from '../../reviews/ReviewThread'
import { Icon, Menu, TopBar } from '../ui'
import { DatabaseStatus, useDatabase, usd } from './DatabasePage'
import type { Database, Model } from './catalog'
import type { Biquad } from '../../eq/biquad'
import { getPresets, presetFields, presetFilters, setEq } from '../eqState'
import { pickersFor, rowForChoice, type ConfigRow } from './configs'
import { hearDevice, toggleStar, useGear } from '../sound/gear'
import { setSound, useSound } from '../sound/soundState'
import { useShell } from '../context'

const X_MARKS = [20, 100, 1000, 10000, 20000]
const hzToX = (hz: number) => (Math.log10(hz / 20) / 3) * 1000
const HEIGHT = 340
const DB_PER_VIEW = 60
const dbToY = (db: number) => HEIGHT / 2 - (db / DB_PER_VIEW) * HEIGHT

/** Level-matched at 300 Hz to 3 kHz, so curves and targets share a centre. */
function centred(grid: number[], values: ArrayLike<number>) {
  let sum = 0
  let count = 0
  grid.forEach((hz, i) => {
    if (hz >= 300 && hz <= 3000) {
      sum += values[i]
      count++
    }
  })
  const middle = count ? sum / count : 0
  return grid.map((_, i) => values[i] - middle)
}

const pathOf = (grid: number[], values: number[]) => grid.map((hz, i) => `${hzToX(hz).toFixed(1)},${dbToY(values[i]).toFixed(1)}`).join(' ')

/** `base`: the device a custom EQ sits on (§85), drawn thin behind it so the difference shows. */
export function Graph({ catalog, iem, base }: { catalog: Catalog; iem: Iem; base?: Iem }) {
  const [targetIndex, setTargetIndex] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const graph = useMemo(() => graphOf(catalog, [iem]), [catalog, iem])
  const { grid } = catalog.data
  const target = graph.targets[targetIndex] ?? graph.targets[0]
  const curve = useMemo(() => pathOf(grid, centred(grid, graph.fr(iem))), [grid, graph, iem])
  const baseLine = useMemo(() => (base ? pathOf(grid, centred(grid, graph.fr(base))) : ''), [grid, graph, base])
  const targetLine = useMemo(() => (target ? pathOf(grid, centred(grid, target.values)) : ''), [grid, target])
  return (
    <section className="ms-db-card">
      <div className="ms-db-card-head">
        <h3>Frequency response</h3>
        {base && <span className="ms-db-legend"><i className="eq" />With your EQ<i className="base" />As it comes</span>}
        {target && (
          <button type="button" className="ms-db-pill" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
            <i className="dash" /> {target.name} <Icon name="arrow_drop_down" size={20} />
          </button>
        )}
      </div>
      <div className="ms-db-graph">
        <svg viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Frequency response of ${iem.name}`}>
          {[-20, -10, 0, 10, 20].map((db) => <line key={db} className={db === 0 ? 'zero' : ''} x1="0" x2="1000" y1={dbToY(db)} y2={dbToY(db)} />)}
          {X_MARKS.map((hz) => <line key={hz} x1={hzToX(hz)} x2={hzToX(hz)} y1="0" y2={HEIGHT} />)}
          {targetLine && <polyline className="target" points={targetLine} />}
          {baseLine && <polyline className="base" points={baseLine} />}
          <polyline className="curve" points={curve} />
        </svg>
        {X_MARKS.slice(1, -1).map((hz) => <span key={hz} style={{ left: `${hzToX(hz) / 10}%` }}>{hz >= 1000 ? `${hz / 1000}k` : hz}</span>)}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} compact onClose={() => setMenu(null)} items={graph.targets.map((t, i) => ({ label: t.name, checked: i === targetIndex, onSelect: () => setTargetIndex(i) }))} />}
    </section>
  )
}

function ConfigPicker({ rows, current, onChoose }: { rows: ConfigRow[]; current: string; onChoose: (id: string) => void }) {
  const [open, setOpen] = useState<{ kind: string; x: number; y: number } | null>(null)
  const pickers = pickersFor(rows, current)
  if (!pickers.length) return null
  const picker = open && pickers.find((p) => p.kind === open.kind)
  return (
    <div className="ms-db-configs">
      {pickers.map((p) => (
        <label key={p.kind} className="ms-db-config">
          <span>{p.kind}</span>
          <button type="button" className="ms-db-pill" aria-haspopup="menu" onClick={(e) => setOpen({ kind: p.kind, x: e.clientX, y: e.clientY })}>
            <span className="ms-ellipsis">{p.value}</span> <Icon name="arrow_drop_down" size={20} />
          </button>
        </label>
      ))}
      {open && picker && <Menu x={open.x} y={open.y} compact onClose={() => setOpen(null)} items={picker.options.map((value) => ({ label: value, checked: value === picker.value, onSelect: () => onChoose(rowForChoice(rows, current, picker.kind, value)) }))} />}
    </div>
  )
}

export function Reviews({ catalog, id }: { catalog: Catalog; id: string }) {
  const messages = useMemo(() => messagesFor(catalog.reviews, id), [catalog, id])
  if (!messages.length) return <section className="ms-db-card"><h3>Reviews</h3><p className="ms-db-none">No reviews for this one yet.</p></section>
  return (
    <section className="ms-db-card">
      <h3>Reviews <small>{messages.length}</small></h3>
      <ul className="ms-db-reviews">
        {messages.map((m, i) => {
          const [think, pros, cons] = m.point ?? [m.quote ?? '', [], []]
          return (
            <li key={i}>
              <div className="who"><b>{m.who}</b>{m.grade && <em>{m.grade}</em>}</div>
              {m.verdict && <p className="verdict">{m.verdict}</p>}
              {think && <p>{think}</p>}
              {(pros.length > 0 || cons.length > 0) && (
                <div className="pc">
                  {pros.map((x) => <span key={x} className="pro"><Icon name="add" size={16} />{x}</span>)}
                  {cons.map((x) => <span key={x} className="con"><Icon name="remove" size={16} />{x}</span>)}
                </div>
              )}
              {m.url && <a href={m.url} target="_blank" rel="noreferrer">{m.linkText} <Icon name="open_in_new" size={14} /></a>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One model: its photo, graph, price, options and what reviewers say. */
export function DevicePage({ id, back }: { id: string; back: () => void }) {
  const { db, failed } = useDatabase()
  const [chosen, setChosen] = useState<string | null>(null)
  const model = useMemo(() => db?.models.find((m) => m.id === id) ?? null, [db, id])
  const rows = useMemo<ConfigRow[]>(() => (model ? model.members.map((m) => ({ id: m.id, variant: splitName(m.name).variant, source: m.source })) : []), [model])
  if (!db) return <DatabaseStatus failed={failed} />
  if (!model) return <div className="ms-empty"><p>This model is no longer in the database.</p></div>
  const { catalog } = db
  const iem = model.members.find((m) => m.id === chosen) ?? model.members[0]
  const photo = catalog.images[iem.id] ?? (model.photoId ? catalog.images[model.photoId] : null)
  const price = priceOf(catalog, iem.id) ?? model.members.map((m) => priceOf(catalog, m.id)).find(Boolean) ?? null
  const squig = catalog.squig[iem.id]
  if (model.custom) return <CustomEqPage db={db} model={model} back={back} />
  return (
    <div className="ms-scroll">
      <TopBar title={model.name} back={back} />
      <div className="ms-page ms-db-device">
        <header className="ms-db-hero">
          <span className="ms-db-hero-photo">{photo ? <img src={imgUrl(photo.src)} alt={model.name} /> : <Icon name="headphones" size={56} />}</span>
          <div className="grow">
            <h1>{model.name}</h1>
            <p className="ms-db-facts">
              {price && (price.url ? <a href={price.url} target="_blank" rel="noreferrer"><b>{usd(price.usd)}</b> {price.source}</a> : <span><b>{usd(price.usd)}</b> {price.source}</span>)}
              {model.score !== null && <span><b>{model.score.toFixed(1)}</b> average score</span>}
              <span>Measured by {iem.source.split(' (')[0]}</span>
              {squig && <a href={squig.url} target="_blank" rel="noreferrer">Open on squig.link <Icon name="open_in_new" size={14} /></a>}
            </p>
            <ConfigPicker rows={rows} current={iem.id} onChoose={setChosen} />
            <TryButton id={iem.id} />
          </div>
        </header>
        <Graph catalog={catalog} iem={iem} />
        <Reviews catalog={catalog} id={iem.id} />
      </div>
    </div>
  )
}

const KIND_WORD: Record<Biquad['kind'], string> = { peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf', lowpass: 'Low-pass', highpass: 'High-pass' }

/** One of your saved EQs on its device (§85): the device as it comes against the device with the EQ, and the EQ itself. */
function CustomEqPage({ db, model, back }: { db: Database; model: Model; back: () => void }) {
  const { go, push, showToast } = useShell()
  const custom = model.custom!
  const iem = model.members[0]
  const base = db.catalog.byId.get(custom.baseId)
  const preset = getPresets().find((p) => p.name === custom.preset)
  const photo = model.photoId ? db.catalog.images[model.photoId] : null
  const filters = useMemo(() => (preset ? presetFilters(preset).filter((f) => f.gain !== 0) : []), [preset])
  return (
    <div className="ms-scroll">
      <TopBar title={model.name} back={back} />
      <div className="ms-page ms-db-device">
        <header className="ms-db-hero">
          <span className="ms-db-hero-photo">{photo ? <img src={imgUrl(photo.src)} alt={custom.baseName} /> : <Icon name="tune" size={56} />}</span>
          <div className="grow">
            <h1>{model.name}</h1>
            <p className="ms-db-facts">
              <span>Your EQ</span>
              <a role="button" tabIndex={0} onClick={() => push({ page: 'device', id: db.models.find((m) => m.members.some((x) => x.id === custom.baseId))?.id ?? custom.baseId })}>on <b>{custom.baseName}</b></a>
              <span><b>{filters.length}</b> {filters.length === 1 ? 'filter' : 'filters'}</span>
            </p>
            {preset && (
              <div className="ms-db-try">
                <button type="button" className="ms-btn primary" onClick={() => { setEq({ ...presetFields(preset), on: true }); showToast(`Playing with ${preset.name}`) }}>
                  <Icon name="graphic_eq" size={20} /> Use this EQ
                </button>
                <button type="button" className="ms-btn text" onClick={() => { setEq({ ...presetFields(preset), on: true }); go({ page: 'settings', section: 'equalizer' }) }}>
                  <Icon name="tune" size={20} /> Open in Equalizer
                </button>
              </div>
            )}
          </div>
        </header>
        <Graph catalog={db.catalog} iem={iem} base={base} />
        <section className="ms-db-card">
          <h3>Filters <small>{filters.length}</small></h3>
          {filters.length ? (
            <ul className="ms-db-filters">
              {filters.map((f, i) => (
                <li key={i}><em>{KIND_WORD[f.kind]}</em><b>{f.fc >= 1000 ? `${+(f.fc / 1000).toFixed(2)} kHz` : `${Math.round(f.fc)} Hz`}</b><span className={f.gain > 0 ? 'up' : 'down'}>{f.gain > 0 ? '+' : '−'}{Math.abs(f.gain).toFixed(1)} dB</span><small>Q {f.q.toFixed(2)}</small></li>
              ))}
            </ul>
          ) : <p className="ms-db-none">This EQ is flat.</p>}
        </section>
      </div>
    </div>
  )
}

/**
 * Quick check in the Database/Gallery view (§69): lets you test how this device sounds on your saved gear
 * (or star it for the quick switcher) without yanking you out into the Settings screen.
 * Adding/editing your own device and saved test devices lives in Settings → My gear.
 */
function TryButton({ id }: { id: string }) {
  const gear = useGear()
  const sound = useSound()
  const { current, playing, setPlaying, shuffleLibrary, showToast } = useShell()
  const starred = gear.starred.includes(id)
  const active = sound.aim.kind === 'device' && !sound.bypass && sound.aim.id === id
  return (
    <div className="ms-db-try">
      <button
        type="button"
        className={`ms-btn ${active ? 'tonal' : 'primary'}`}
        aria-pressed={active}
        onClick={() => {
          if (active) {
            setSound({ aim: { kind: 'off' }, bypass: false })
            showToast('Back to your device as it is')
            return
          }
          hearDevice(id)
          if (!current) shuffleLibrary()
          else if (!playing) setPlaying(true)
          showToast(gear.active ? 'Testing this device on your gear' : 'Added to your quick switch (pick your own device in Settings → My gear)')
        }}
      >
        <Icon name="hearing" size={20} /> {active ? 'Hearing this now' : 'I want to hear this'}
      </button>
      <button type="button" className={`ms-btn ${starred ? 'tonal' : 'text'}`} aria-pressed={starred} onClick={() => toggleStar(id)} title={starred ? 'In your quick switch' : 'Add to your quick switch'}>
        <Icon name="star" fill={starred} size={20} /> {starred ? 'Starred' : 'Star'}
      </button>
    </div>
  )
}

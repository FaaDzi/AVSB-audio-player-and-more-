// Quick match (§67): any two from the Database, even of different kinds, best of 1, 3 or 5, on the same VS screen
// and blind A/B as a tournament. Nothing goes into the bracket history.
import { useMemo, useState } from 'react'
import { Icon, TopBar } from '../ui'
import { imgUrl } from '../../reviews/reviews'
import { listModels, type Database, type Model } from '../database/catalog'
import { KINDS, kindDetail, kindLabel } from './kinds'

export interface QuickPick {
  ids: [string, string]
  bestOf: number
}

function Slot({ db, label, model, onPick, onClear }: { db: Database; label: string; model: Model | null; onPick: (m: Model) => void; onClear: () => void }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => (query ? listModels(db.models, { query, kinds: new Set(KINDS), reviewedOnly: false, sort: 'name' }).slice(0, 8) : []), [db, query])
  const photo = (m: Model) => {
    const img = m.photoId ? db.catalog.images[m.photoId] : null
    return img ? <img src={imgUrl(img.src)} alt="" /> : <Icon name="headphones" size={40} />
  }
  return (
    <div className={`ms-tz-qslot${model ? ` ${model.kind}` : ''}`}>
      <small>{label}</small>
      {model ? (
        <>
          <span className="ms-tz-qslot-photo">{photo(model)}</span>
          <b>{model.name}</b>
          <span className="ms-tz-qslot-kind">{kindDetail(model.kind, model.members[0].back)}</span>
          <button type="button" className="ms-btn text" onClick={onClear}>Change</button>
        </>
      ) : (
        <>
          <label className="ms-search">
            <Icon name="search" />
            <input placeholder="Search IEMs, TWS or headphones" aria-label={`Search for ${label}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="ms-tz-list">
            {matches.map((m) => (
              <button type="button" key={m.id} className="ms-tz-row" onClick={() => { onPick(m); setQuery('') }}>
                <span className="ms-tz-photo">{photo(m)}</span>
                <span className="grow">{m.name}</span>
                <small>{kindLabel(m.kind)}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function QuickPage({ db, onCancel, onStart }: { db: Database; onCancel: () => void; onStart: (q: QuickPick) => void }) {
  const [a, setA] = useState<Model | null>(null)
  const [b, setB] = useState<Model | null>(null)
  const [bestOf, setBestOf] = useState(3)
  const ready = Boolean(a && b && a.id !== b.id)
  return (
    <div className="ms-scroll">
      <TopBar back={onCancel} title="Quick match" />
      <div className="ms-page ms-tz-quick">
        <p className="ms-tz-note">Pick any two, even an IEM against a headphone. Both are simulated on what you listen on (set in a tournament's setup), and the match is blind.</p>
        <div className="ms-tz-qslots">
          <Slot db={db} label="Corner A" model={a} onPick={setA} onClear={() => setA(null)} />
          <span className="ms-tz-qvs" aria-hidden="true">VS</span>
          <Slot db={db} label="Corner B" model={b} onPick={setB} onClear={() => setB(null)} />
        </div>
        <div className="ms-tz-options">
          <div className="ms-tz-seg" role="group" aria-label="Format">
            {[1, 3, 5].map((n) => <button type="button" key={n} className={n === bestOf ? 'on' : ''} onClick={() => setBestOf(n)}>Best of {n}</button>)}
          </div>
        </div>
        <div className="ms-tz-go">
          <button type="button" className="ms-btn primary full" disabled={!ready} onClick={() => onStart({ ids: [a!.id, b!.id], bestOf })}>
            <Icon name="bolt" size={20} /> {ready ? 'Start the match' : a && b ? 'Pick two different ones' : 'Pick both corners'}
          </button>
        </div>
      </div>
    </div>
  )
}

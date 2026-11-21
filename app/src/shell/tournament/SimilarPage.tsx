// §106 C: Find similar. Pick a device; every other one of the same kind is scored against its curve (similar.ts) and
// the best are listed per price band. A result opens both curves on one graph, and Listen starts a blind Quick match
// of the two; after the match, you come back to that graph.
import { useMemo, useState } from 'react'
import { Icon, TopBar } from '../ui'
import { imgUrl } from '../../reviews/reviews'
import { listModels, type Database, type Model } from '../database/catalog'
import { Graph } from '../database/DevicePage'
import { byPriceBand, findSimilar, type SimilarHit } from '../similar'
import { KINDS, kindDetail, kindLabel } from './kinds'

const usd = (n: number | null) => (n === null ? 'Price unknown' : `$${n.toLocaleString('en-US')}`)

function Photo({ db, model }: { db: Database; model: Model }) {
  const img = model.photoId ? db.catalog.images[model.photoId] : null
  return <span className="ms-tz-photo">{img ? <img src={imgUrl(img.src)} alt="" /> : <Icon name="headphones" size={28} />}</span>
}

export function SimilarPage({ db, refId, pickId, onChange, onBack, onListen }: {
  db: Database
  /** The model searched from, and the result being compared (ids of models), kept by the page above. */
  refId: string | null
  pickId: string | null
  onChange: (refId: string | null, pickId: string | null) => void
  onBack: () => void
  onListen: (ref: Model, pick: Model) => void
}) {
  const [query, setQuery] = useState('')
  const [cheaper, setCheaper] = useState(false)
  const ref = refId ? db.models.find((m) => m.id === refId) ?? null : null
  const matches = useMemo(() => (query ? listModels(db.models, { query, kinds: new Set(KINDS), reviewedOnly: false, sort: 'name' }).slice(0, 8) : []), [db, query])
  // the reference's first measurement is the target; the scan is a few hundred ms over the whole catalog
  const hits = useMemo(() => (ref ? findSimilar(db, ref, ref.members[0]) : []), [db, ref])
  const shown = useMemo(() => (cheaper && ref?.usd != null ? hits.filter((h) => h.model.usd !== null && h.model.usd < ref.usd!) : hits), [hits, cheaper, ref])
  const bands = useMemo(() => byPriceBand(shown), [shown])
  const pick: SimilarHit | undefined = pickId ? hits.find((h) => h.model.id === pickId) : undefined

  if (ref && pick) {
    return (
      <div className="ms-scroll">
        <TopBar back={() => onChange(ref.id, null)} title="Compare" />
        <div className="ms-page ms-tz-similar">
          <div className="ms-tz-simpair">
            <span><Photo db={db} model={ref} /><b>{ref.name}</b><small>{usd(ref.usd)}</small></span>
            <span className="ms-tz-simscore"><b>{Math.round(pick.score)}%</b><small>match</small></span>
            <span><Photo db={db} model={pick.model} /><b>{pick.model.name}</b><small>{usd(pick.model.usd)}</small></span>
          </div>
          <Graph catalog={db.catalog} iem={ref.members[0]} compare={pick.iem} />
          <button type="button" className="ms-btn primary full" onClick={() => onListen(ref, pick.model)}>
            <Icon name="headphones" size={20} /> Listen: blind A/B
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ms-scroll">
      <TopBar back={onBack} title="Find similar" />
      <div className="ms-page ms-tz-similar">
        {ref ? (
          <>
            <div className="ms-tz-simref">
              <Photo db={db} model={ref} />
              <span className="grow"><b>{ref.name}</b><small>{kindDetail(ref.kind, ref.members.find((m) => m.back)?.back)} · {usd(ref.usd)}</small></span>
              <button type="button" className="ms-btn text" onClick={() => onChange(null, null)}>Change</button>
            </div>
            {ref.usd !== null && (
              <div className="ms-tz-seg" role="group" aria-label="Price">
                <button type="button" className={cheaper ? '' : 'on'} onClick={() => setCheaper(false)}>Any price</button>
                <button type="button" className={cheaper ? 'on' : ''} onClick={() => setCheaper(true)}>Cheaper than this</button>
              </div>
            )}
            {bands.map((b) => (
              <section key={b.label} className="ms-tz-simband">
                <h2 className="ms-h2">{b.label}</h2>
                <div className="ms-tz-list">
                  {b.hits.map((h) => (
                    <button type="button" key={h.model.id} className="ms-tz-row" onClick={() => onChange(ref.id, h.model.id)}>
                      <Photo db={db} model={h.model} />
                      <span className="grow">{h.model.name}<small>{usd(h.model.usd)}</small></span>
                      <span className="ms-tz-simmeter" style={{ '--match': `${h.score}%` } as React.CSSProperties}><b>{Math.round(h.score)}%</b></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!bands.length && <p className="ms-tz-note">Nothing of the same kind to compare with.</p>}
          </>
        ) : (
          <>
            <p className="ms-tz-note">Pick an IEM, TWS or headphone. Others of the same kind are ranked by how close their sound is, in every price range.</p>
            <label className="ms-search">
              <Icon name="search" />
              <input placeholder="Search IEMs, TWS or headphones" aria-label="Search a device" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
            <div className="ms-tz-list">
              {matches.map((m) => (
                <button type="button" key={m.id} className="ms-tz-row" onClick={() => { setQuery(''); onChange(m.id, null) }}>
                  <Photo db={db} model={m} />
                  <span className="grow">{m.name}</span>
                  <small>{kindLabel(m.kind)}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

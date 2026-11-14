import { useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogKind } from '../../data/catalog'
import { imgUrl } from '../../reviews/reviews'
import { useShell } from '../context'
import { Chip, Icon, IconButton, Menu } from '../ui'
import { TipListRow, tipMatches, useTips } from './EarTips'
import { listModels, loadDatabase, SORTS, type Database, type Model, type SortMode } from './catalog'

const KINDS: [CatalogKind, string][] = [['iems', 'IEMs'], ['tws', 'TWS'], ['headphones', 'Headphones'], ['speakers', 'Speakers'], ['soundbar', 'Soundbars']]
const ROW_HEIGHT = 80
const EXTRA_ROWS = 8

export const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/** Loads the database for a page, sharing one copy between them. */
export function useDatabase(): { db: Database | null; failed: string | null } {
  const [db, setDb] = useState<Database | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadDatabase().then((d) => { if (live) setDb(d) }, (e: unknown) => { if (live) setFailed(String(e)) })
    return () => { live = false }
  }, [])
  return { db, failed }
}

export function DatabaseStatus({ failed }: { failed: string | null }) {
  return (
    <div className="ms-empty">
      <Icon name={failed ? 'error' : 'database'} />
      <p>{failed ? `The database didn't load (${failed})` : 'Opening the database...'}</p>
    </div>
  )
}

function ModelRow({ model, db, onOpen }: { model: Model; db: Database; onOpen: () => void }) {
  const photo = model.photoId ? db.catalog.images[model.photoId] : null
  const options = model.members.length
  const kindLabel = KINDS.find(([k]) => k === model.kind)?.[1]
  return (
    <button type="button" className="ms-db-row" onClick={onOpen}>
      <span className="ms-db-photo">{photo ? <img src={imgUrl(photo.src)} alt="" loading="lazy" decoding="async" /> : <Icon name="headphones" />}</span>
      <span className="ms-db-text">
        <b className="ms-ellipsis">{model.name}</b>
        <small className="ms-ellipsis">{[kindLabel, options > 1 ? `${options} options` : null, model.reviewCount ? `${model.reviewCount} ${model.reviewCount === 1 ? 'review' : 'reviews'}` : null].filter(Boolean).join(' · ')}</small>
      </span>
      {model.usd !== null && <span className="ms-db-price">{usd(model.usd)}</span>}
      <span className="ms-db-score">{model.score !== null ? model.score.toFixed(1) : ''}</span>
    </button>
  )
}

/** Every IEM, earbud and headphone we have, as one list. Only the rows on screen are drawn: there are thousands. */
export function DatabasePage({ initialKind }: { initialKind?: 'tips' } = {}) {
  const { push } = useShell()
  const { db, failed } = useDatabase()
  const { tips } = useTips()
  // ear tips aren't catalog models: their chip shows them on their own (§79 D)
  const [tipsMode, setTipsMode] = useState(initialKind === 'tips')
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<CatalogKind>>(() => new Set(['iems', 'tws', 'headphones']))
  const [reviewedOnly, setReviewedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('name')
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 900 })

  const shown = useMemo(() => (db && !tipsMode ? listModels(db.models, { query, kinds, reviewedOnly, sort }) : []), [db, query, kinds, reviewedOnly, sort, tipsMode])
  const shownTips = useMemo(() => (tipsMode ? (tips?.rows ?? []).filter((r) => tipMatches(r, query)) : []), [tips, query, tipsMode])
  const counts = useMemo(() => {
    const c = new Map<CatalogKind, number>()
    for (const m of db?.models ?? []) c.set(m.kind, (c.get(m.kind) ?? 0) + 1)
    return c
  }, [db])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setView((v) => ({ ...v, height: el.clientHeight }))
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [db])

  // a new list starts from its top
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
    setView((v) => ({ ...v, top: 0 }))
  }, [query, kinds, reviewedOnly, sort, tipsMode])

  if (!db) return <DatabaseStatus failed={failed} />

  const toggleKind = (kind: CatalogKind) => {
    if (tipsMode) {
      setTipsMode(false)
      setKinds(new Set([kind]))
      return
    }
    const next = new Set(kinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setKinds(next)
  }

  const listTop = list.current?.offsetTop ?? 0
  const from = Math.max(0, Math.floor((view.top - listTop) / ROW_HEIGHT) - EXTRA_ROWS)
  const to = Math.min(shown.length, Math.ceil((view.top - listTop + view.height) / ROW_HEIGHT) + EXTRA_ROWS)

  return (
    <div className="ms-scroll" ref={scroller} onScroll={(e) => { const top = e.currentTarget.scrollTop; setView((v) => ({ ...v, top })) }}>
      <div className="ms-page ms-db">
        <h1 className="ms-h1">Database</h1>
        <label className="ms-search">
          <Icon name="search" />
          <input placeholder="Search by name, brand or option" aria-label="Search the database" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <IconButton icon="close" label="Clear search" small onClick={() => setQuery('')} />}
        </label>
        <div className="ms-db-tools">
          <div className="ms-chips">
            {KINDS.map(([kind, label]) => <Chip key={kind} label={`${label} ${(counts.get(kind) ?? 0).toLocaleString('en-US')}`} selected={!tipsMode && kinds.has(kind)} onClick={() => toggleKind(kind)} />)}
            <Chip label={`Ear tips ${tips?.rows.length ?? ''}`.trim()} selected={tipsMode} onClick={() => setTipsMode(!tipsMode)} />
            {!tipsMode && <Chip label="Reviewed" selected={reviewedOnly} onClick={() => setReviewedOnly(!reviewedOnly)} />}
          </div>
          {!tipsMode && <button type="button" className="ms-tool ms-db-sort" onClick={(e) => setSortMenu({ x: e.clientX, y: e.clientY })}>
            <Icon name="sort" size={20} /> {SORTS.find(([s]) => s === sort)?.[1]}
          </button>}
        </div>
        {tipsMode ? (
          <>
            <p className="ms-count ms-db-count">{shownTips.length} {shownTips.length === 1 ? 'tip' : 'tips'} · Fernanda Gunsan and Jay&apos;s Audio</p>
            {!shownTips.length && <div className="ms-empty small"><Icon name="search_off" /><p>Nothing matches.</p></div>}
            <div className="ms-db-list">{shownTips.map((r) => <TipListRow key={r.key} row={r} onOpen={() => push({ page: 'tip', id: r.key })} />)}</div>
          </>
        ) : <>
        <p className="ms-count ms-db-count">{shown.length.toLocaleString('en-US')} {shown.length === 1 ? 'model' : 'models'}</p>
        {!shown.length && <div className="ms-empty small"><Icon name="search_off" /><p>Nothing matches.</p></div>}
        <div ref={list} className="ms-db-list" style={{ height: shown.length * ROW_HEIGHT }}>
          <div style={{ transform: `translateY(${from * ROW_HEIGHT}px)` }}>
            {shown.slice(from, to).map((m) => <ModelRow key={m.id} model={m} db={db} onOpen={() => push({ page: 'device', id: m.id })} />)}
          </div>
        </div>
        </>}
      </div>
      {sortMenu && <Menu x={sortMenu.x} y={sortMenu.y} compact onClose={() => setSortMenu(null)} items={SORTS.map(([s, label]) => ({ label, checked: s === sort, onSelect: () => setSort(s) }))} />}
    </div>
  )
}

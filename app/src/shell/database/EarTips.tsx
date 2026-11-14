// Ear tips in the Database (plan §79 D): Fernanda Gunsan's tier list and Jay's Audio's tip database as Database rows,
// each opening a page in the device page's look. Replaces the old app's table under Audio Tools.
import { useEffect, useMemo, useState } from 'react'
import { imgUrl } from '../../reviews/reviews'
import { mergeTips, opinionsDiffer, type FernandaTip, type JayTip, type TipRow } from '../../components/eartips'
import { Icon, TopBar } from '../ui'
import { DatabaseStatus } from './DatabasePage'

interface FernandaData { reviewer: string; url: string; notes: string[]; tips: FernandaTip[] }
interface JayData { reviewer: string; url: string; baseline: string; note: string; tips: JayTip[] }
export interface Tips { rows: TipRow[]; fernanda: FernandaData; jay: JayData }

let loading: Promise<Tips> | null = null
function loadTips(): Promise<Tips> {
  const get = (f: string) => fetch(imgUrl(`data/${f}`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${f}: ${r.status}`))))
  loading ??= Promise.all([get('eartips.json'), get('eartips_jay.json')]).then(([fernanda, jay]: [FernandaData, JayData]) => ({
    rows: mergeTips(fernanda.tips, jay.tips),
    fernanda,
    jay,
  }))
  loading.catch(() => { loading = null })
  return loading
}

export function useTips(): { tips: Tips | null; failed: string | null } {
  const [tips, setTips] = useState<Tips | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadTips().then((t) => live && setTips(t), (e: unknown) => live && setFailed(String(e)))
    return () => { live = false }
  }, [])
  return { tips, failed }
}

const KIND: Record<string, string> = { silicone: 'Silicone', foam: 'Foam', stock: 'Stock' }

/** Jay's three ratings in a few words: "Grip Great · Flex Normal · Detail +". */
function jayLine(j: JayTip): string {
  const tech = j.tech?.rating === 'Improved' ? 'Detail +' : j.tech?.rating === 'Reduced' ? 'Detail −' : 'Detail ='
  return [j.grip?.rating && `Grip ${j.grip.rating}`, j.flex?.rating && `Flex ${j.flex.rating}`, tech].filter(Boolean).join(' · ')
}

export function tipMatches(r: TipRow, query: string) {
  const q = query.trim().toLowerCase()
  return !q || r.name.toLowerCase().includes(q) || (r.kind ?? '').includes(q)
}

export function TipListRow({ row, onOpen }: { row: TipRow; onOpen: () => void }) {
  const sub = [row.kind && KIND[row.kind], row.jay && jayLine(row.jay), opinionsDiffer(row) && 'Two opinions'].filter(Boolean).join(' · ')
  return (
    <button type="button" className="ms-db-row" onClick={onOpen}>
      <span className="ms-db-photo">{row.photo ? <img src={imgUrl(row.photo)} alt="" loading="lazy" decoding="async" /> : <Icon name="earbuds" />}</span>
      <span className="ms-db-text">
        <b className="ms-ellipsis">{row.name}</b>
        <small className="ms-ellipsis">{sub || 'Fernanda Gunsan'}</small>
      </span>
      <span className="ms-db-score" title={row.fernanda?.tier ? "Fernanda Gunsan's tier" : undefined}>{row.fernanda?.tier ?? ''}</span>
    </button>
  )
}

/** One tip: photo, what it is, and both reviewers as review cards. */
export function TipPage({ id, back }: { id: string; back: () => void }) {
  const { tips, failed } = useTips()
  const row = useMemo(() => tips?.rows.find((r) => r.key === id) ?? null, [tips, id])
  if (!tips) return <DatabaseStatus failed={failed} />
  if (!row) return <div className="ms-empty"><p>This tip is no longer in the list.</p></div>
  const { fernanda: f, jay: j } = row
  const rating = (label: string, r: JayTip['grip']) => r?.rating && <span key={label}><b>{r.rating}</b> {label.toLowerCase()}</span>
  return (
    <div className="ms-scroll">
      <TopBar title={row.name} back={back} />
      <div className="ms-page ms-db-device">
        <header className="ms-db-hero">
          <span className="ms-db-hero-photo">{row.photo ? <img src={imgUrl(row.photo)} alt={row.name} /> : <Icon name="earbuds" size={56} />}</span>
          <div className="grow">
            <h1>{row.name}</h1>
            <p className="ms-db-facts">
              {row.kind && <span><b>{KIND[row.kind]}</b></span>}
              {f?.tier && <span><b>Tier {f.tier}</b> Fernanda Gunsan</span>}
              {j && [rating('Grip', j.grip), rating('Flex', j.flex), rating('Detail', j.tech)]}
            </p>
            {j?.build && <p className="ms-db-none">{j.build}</p>}
          </div>
        </header>
        {j?.graph && (
          <section className="ms-db-card">
            <h3>Sound <small>vs {tips.jay.baseline}</small></h3>
            <img className="ms-tip-graph" src={imgUrl(j.graph)} alt={`${row.name} against ${tips.jay.baseline}`} loading="lazy" />
          </section>
        )}
        <section className="ms-db-card">
          <h3>Reviews <small>{(f ? 1 : 0) + (j ? 1 : 0)}</small></h3>
          <ul className="ms-db-reviews">
            {f && (
              <li>
                <div className="who"><b>Fernanda Gunsan</b>{f.tier && <em>Tier {f.tier}</em>}</div>
                {f.tagline && <p className="verdict">{f.tagline}</p>}
                <p>{f.review}</p>
                {(f.useOn || f.usedWith) && <p className="ms-db-none">{[f.useOn && `For ${f.useOn}`, f.usedWith && `Tried on ${f.usedWith}`].filter(Boolean).join(' · ')}</p>}
                <a href={tips.fernanda.url} target="_blank" rel="noreferrer">Instagram (translated from Indonesian) <Icon name="open_in_new" size={14} /></a>
              </li>
            )}
            {j && (
              <li>
                <div className="who"><b>Jay&apos;s Audio</b><em>{jayLine(j)}</em></div>
                {j.verdict && <p className="verdict">{j.verdict}</p>}
                {j.tonality && <p>{j.tonality}</p>}
                {[j.grip, j.flex, j.tech].some((r) => r?.note) && (
                  <div className="pc">
                    {[['Grip', j.grip], ['Flex', j.flex], ['Detail', j.tech]].map(([label, r]) => (r as JayTip['grip'])?.note && <span key={label as string}>{label as string}: {(r as JayTip['grip'])!.note}</span>)}
                  </div>
                )}
                <a href={tips.jay.url} target="_blank" rel="noreferrer">Jay&apos;s tip database <Icon name="open_in_new" size={14} /></a>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

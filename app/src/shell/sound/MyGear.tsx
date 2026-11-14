// Settings → My gear (§69): what you're listening on now, the devices you own, the ones you've starred to hear,
// and your source (DAC / dongle, DSP cable). Sound and the tournament both use the active device.
import { useMemo, useState } from 'react'
import { Icon } from '../ui'
import { useShell } from '../context'
import { useDatabase } from '../database/DatabasePage'
import { listModels, type Database } from '../database/catalog'
import { kindOfIem } from '../../data/catalog'
import { imgUrl } from '../../reviews/reviews'
import { kindDetail } from '../tournament/kinds'
import { addOwned, hearDevice, removeOwned, setActive, setAnc, toggleStar, useGear } from './gear'
import { useSound } from './soundState'
import { SourceSection } from './SourceSection'

const KINDS = new Set(['iems', 'tws', 'headphones', 'speakers', 'soundbar'] as const)

function Photo({ db, id, size = 44 }: { db: Database; id: string; size?: number }) {
  const model = db.models.find((m) => m.members.some((x) => x.id === id))
  const img = model?.photoId ? db.catalog.images[model.photoId] : null
  return (
    <span className="ms-tz-photo" style={{ width: size, height: size }}>
      {img ? <img src={imgUrl(img.src)} alt="" /> : <Icon name="headphones" />}
    </span>
  )
}

function AddSearch({ db, label, onPick, onClose }: { db: Database; label: string; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => (query ? listModels(db.models, { query, kinds: KINDS, reviewedOnly: false, sort: 'name' }).slice(0, 10) : []), [db, query])
  return (
    <div className="ms-gear-add">
      <label className="ms-search">
        <Icon name="search" />
        <input autoFocus placeholder="Search IEMs, headphones or speakers" aria-label={label} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      </label>
      <div className="ms-tz-list">
        {matches.map((m) => (
          <button type="button" key={m.id} className="ms-tz-row" onClick={() => { onPick(m.id); onClose() }}>
            <Photo db={db} id={m.id} />
            <span className="grow">{m.name}</span>
            <small>{kindDetail(m.kind, m.members[0].back)}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

export function MyGear() {
  const { db } = useDatabase()
  const gear = useGear()
  const sound = useSound()
  const { showToast, go } = useShell()
  const [adding, setAdding] = useState<'owned' | 'starred' | null>(null)
  if (!db) return null
  const name = (id: string) => db.catalog.byId.get(id)?.name ?? id
  const detail = (id: string) => {
    const d = db.catalog.byId.get(id)
    return d ? kindDetail(kindOfIem(d), d.back) : ''
  }
  const active = gear.active ? db.catalog.byId.get(gear.active) : undefined
  const hearing = sound.aim.kind === 'device' && !sound.bypass ? sound.aim.id : null

  return (
    <div className="ms-gear">
      <section className="ms-gear-now">
        <small>What you're listening on now</small>
        {active ? (
          <div className="ms-gear-now-card">
            <Photo db={db} id={active.id} size={88} />
            <div className="grow">
              <b>{active.name}</b>
              <span>{detail(active.id)}</span>
              <p className="ms-tz-note">Every simulation, target and tournament is built on this device's measurement.</p>
            </div>
          </div>
        ) : (
          <p className="ms-tz-note">Nothing set yet. Add the IEM, TWS or headphone you use, so simulations and targets start from its real sound.</p>
        )}
      </section>

      <section className="ms-set-section">
        <div className="ms-gear-head">
          <h3>Your devices</h3>
          <button type="button" className="ms-btn tonal" onClick={() => setAdding(adding === 'owned' ? null : 'owned')}><Icon name="add" size={20} /> Add device</button>
        </div>
        {adding === 'owned' && <AddSearch db={db} label="Search a device you own" onPick={(id) => { addOwned(id); showToast(`Added ${name(id)}`) }} onClose={() => setAdding(null)} />}
        <div className="ms-gear-list">
          {gear.owned.map((d) => {
            const on = d.id === gear.active
            const tws = db.catalog.byId.get(d.id) && kindOfIem(db.catalog.byId.get(d.id)!) === 'tws'
            return (
              <div key={d.id} className={`ms-gear-row${on ? ' on' : ''}`}>
                <Photo db={db} id={d.id} />
                <div className="grow">
                  <b>{name(d.id)}</b>
                  <small>{detail(d.id)}{on ? ' · listening on now' : ''}</small>
                  {tws && (
                    <label className="ms-gear-anc">
                      <input type="checkbox" checked={Boolean(d.anc)} onChange={(e) => setAnc(d.id, e.target.checked)} /> I use it with noise cancelling on
                    </label>
                  )}
                </div>
                {!on && <button type="button" className="ms-btn text" onClick={() => setActive(d.id)}>Listen on this</button>}
                <button type="button" className="ms-iconbtn" aria-label={`Remove ${name(d.id)}`} title="Remove" onClick={() => removeOwned(d.id)}><Icon name="delete" size={20} /></button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="ms-set-section">
        <div className="ms-gear-head">
          <h3>Starred to hear</h3>
          <button type="button" className="ms-btn tonal" onClick={() => setAdding(adding === 'starred' ? null : 'starred')}><Icon name="star" size={20} /> Star a device</button>
        </div>
        <p className="ms-tz-note">Devices you want to hear on your own gear. Switch between them from the player bar.</p>
        {adding === 'starred' && <AddSearch db={db} label="Search a device to star" onPick={(id) => toggleStar(id, true)} onClose={() => setAdding(null)} />}
        <div className="ms-gear-list">
          {gear.starred.map((id) => (
            <div key={id} className={`ms-gear-row${hearing === id ? ' on' : ''}`}>
              <Photo db={db} id={id} />
              <div className="grow">
                <b>{name(id)}</b>
                <small>{detail(id)}{hearing === id ? ' · hearing it now' : ''}</small>
              </div>
              <button type="button" className="ms-btn text" onClick={() => { hearDevice(id); go({ page: 'settings', section: 'equalizer' }) }}>Hear it</button>
              <button type="button" className="ms-iconbtn" aria-label={`Unstar ${name(id)}`} title="Unstar" onClick={() => toggleStar(id, false)}><Icon name="star" fill size={20} /></button>
            </div>
          ))}
        </div>
      </section>

      <SourceSection activeId={gear.active} />
    </div>
  )
}

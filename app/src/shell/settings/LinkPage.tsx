import { useEffect, useState } from 'react'
import { onPairLink, pairError, phoneLink, takePairLink, type PhoneLinkStatus } from '../linkClient'
import { host, type LinkStatus } from '../host'
import { refresh as refreshLibrary } from '../localLibrary'
import { Dialog, Icon, IconButton, Menu, useLongPress } from '../ui'
import { getSetting, setSetting } from './store'
import { useShell } from '../context'

type ExtendedPhoneLinkStatus = PhoneLinkStatus & {
  latencyMs?: number | null
}

type ExtendedPhoneLinkPlugin = NonNullable<typeof phoneLink> & {
  resync?: () => Promise<ExtendedPhoneLinkStatus>
  ping?: () => Promise<ExtendedPhoneLinkStatus>
}

type ExtendedHostLink = NonNullable<ReturnType<typeof host>>['link'] & {
  resync?: () => Promise<LinkStatus & { latencyMs?: number }>
  ping?: () => Promise<LinkStatus & { latencyMs?: number }>
}

type PairedPhone = LinkStatus['phones'][number]

/** A paired phone at a glance: the PC owner's own name for it, else the phone's, else its Android version. */
export const phoneLabel = (p: PairedPhone) => p.customName || p.name || p.os || 'Phone'

/** §81 F: one phone in detail (right-click it): rename it, and see the model number and Android version it sent. */
export function PhoneProfile({ phone, onClose }: { phone: PairedPhone; onClose: () => void }) {
  const { showToast } = useShell()
  const [name, setName] = useState(phoneLabel(phone))
  const save = () => {
    const next = name.trim()
    // the phone's own name isn't a custom one: clearing the box, or typing that name, goes back to it
    void host()?.link?.rename?.(phone.id, next === phone.name ? '' : next)
    onClose()
  }
  return (
    <Dialog
      title={phoneLabel(phone)}
      onClose={onClose}
      footer={<><button type="button" className="ms-btn text" onClick={onClose}>Cancel</button><button type="button" className="ms-btn primary" onClick={save}>Save</button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <input className="ms-input" value={name} maxLength={40} placeholder={phone.name} aria-label="Name on this PC" autoFocus onChange={(e) => setName(e.target.value)} />
      </form>
      <div className="ms-set-group" style={{ marginTop: 16 }}>
        {phone.model && (
          <div className="ms-set-row">
            <Icon name="tag" />
            <span className="grow ms-set-text"><span className="ms-set-label">{phone.model}</span><small>Model number</small></span>
            <IconButton icon="content_copy" label="Copy model number" small onClick={() => { void navigator.clipboard?.writeText(phone.model ?? ''); showToast('Model number copied') }} />
          </div>
        )}
        {phone.os && (
          <div className="ms-set-row">
            <Icon name="android" />
            <span className="grow ms-set-text"><span className="ms-set-label">{phone.os}</span>{phone.customName && <small>{phone.name}</small>}</span>
          </div>
        )}
        <div className="ms-set-row">
          <Icon name={phone.connected ? 'phonelink_ring' : 'smartphone'} fill={phone.connected} />
          <span className="grow ms-set-text"><span className="ms-set-label">{phone.connected ? 'Connected now' : 'Not connected'}</span><small>Paired {new Date(phone.pairedAt).toLocaleDateString()}</small></span>
        </div>
      </div>
    </Dialog>
  )
}

const PHOTO_KEY = 'profile.photo'

/** A picked picture as a small square JPEG (data URL), so it fits in the settings and loads at once. */
async function squarePhoto(file: File, size = 256): Promise<string> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** The phone's own profile (hold its card): the name the PC sees, and a picture kept on this phone. */
function MyProfile({ name, onClose }: { name: string; onClose: (saved: boolean) => void }) {
  const { showToast } = useShell()
  const [text, setText] = useState(name)
  const [photo, setPhoto] = useState(String(getSetting(PHOTO_KEY) || ''))
  const save = () => {
    setSetting(PHOTO_KEY, photo)
    // an empty name goes back to the phone's own (Android's device name)
    void phoneLink?.setName?.({ name: text.trim() }).catch(() => {}).then(() => onClose(true))
  }
  return (
    <Dialog
      title="Your profile"
      onClose={() => onClose(false)}
      footer={<><button type="button" className="ms-btn text" onClick={() => onClose(false)}>Cancel</button><button type="button" className="ms-btn primary" onClick={save}>Save</button></>}
    >
      <div className="ms-profile-edit">
        <label className="ms-avatar big" aria-label="Choose a picture">
          {photo ? <img src={photo} alt="" /> : <Icon name="add_a_photo" size={32} />}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void squarePhoto(file).then(setPhoto).catch(() => showToast("That picture couldn't be read"))
            }}
          />
        </label>
        {photo && <button type="button" className="ms-btn text" onClick={() => setPhoto('')}>Remove picture</button>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <input className="ms-input" value={text} maxLength={40} placeholder="Name" aria-label="Name" onChange={(e) => setText(e.target.value)} />
      </form>
    </Dialog>
  )
}

/**
 * The profile card on top of Settings (§81 F). PC: the paired phones by name, connected ones first; right-click for
 * one phone in detail. Phone: this phone's name and the PC it plays from. A click opens the pairing page.
 */
export function ProfileCard({ selected, onOpen }: { selected: boolean; onOpen: () => void }) {
  const link = host()?.link
  const [phones, setPhones] = useState<PairedPhone[]>([])
  const [mine, setMine] = useState<(PhoneLinkStatus & { deviceName?: string }) | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [round, setRound] = useState(0)
  const press = useLongPress()
  const photo = phoneLink ? String(getSetting(PHOTO_KEY) || '') : ''
  useEffect(() => {
    if (link) {
      const read = () => void link.status().then((s) => setPhones(s?.phones ?? []))
      read()
      return link.onChange(read)
    }
    if (!phoneLink) return
    const read = () => void phoneLink!.status().then(setMine).catch(() => {})
    read()
    const sub = phoneLink.addListener('changed', read)
    return () => { void sub.then((h) => h.remove()) }
  }, [link, round])

  const sorted = [...phones].sort((a, b) => Number(b.connected) - Number(a.connected))
  const live = sorted.filter((p) => p.connected)
  const title = phoneLink
    ? mine?.deviceName || 'This phone'
    : sorted.length ? (live.length ? live : sorted).map(phoneLabel).join(' · ') : 'Connect a phone'
  const sub = phoneLink
    ? mine?.paired ? `${mine.connected ? 'Connected to' : 'Paired with'} ${mine.name}` : 'Connect to a PC'
    : !sorted.length ? 'Play this library on your phone' : live.length ? 'Connected' : 'Not connected'
  const shown = phones.find((p) => p.id === detail)
  return (
    <>
      <button
        type="button"
        className={`ms-settings-profile${selected ? ' on' : ''}`}
        onClick={onOpen}
        // phone: hold for your own name and picture. PC: right-click for a paired phone in detail
        {...(phoneLink ? press(() => setEditing(true)) : {
          onContextMenu: (e: React.MouseEvent) => {
            if (!sorted.length) return
            e.preventDefault()
            if (sorted.length === 1) setDetail(sorted[0].id)
            else setMenu({ x: e.clientX, y: e.clientY })
          },
        })}
      >
        <span className="ms-avatar">{photo ? <img src={photo} alt="" /> : <Icon name={phoneLink || sorted.length ? 'smartphone' : 'person'} fill />}</span>
        <span className="grow ms-ellipsis">{title}<small>{sub}</small></span>
      </button>
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={sorted.map((p) => ({ label: phoneLabel(p), icon: p.connected ? 'phonelink_ring' : 'smartphone', onSelect: () => setDetail(p.id) }))} />}
      {shown && <PhoneProfile phone={shown} onClose={() => setDetail(null)} />}
      {editing && <MyProfile name={mine?.deviceName ?? ''} onClose={(saved) => { setEditing(false); if (saved) setRound((n) => n + 1) }} />}
    </>
  )
}

/**
 * Settings → Pair a phone / Connect to a PC (§70 D1/D2 & §73.C3):
 * Includes live connection status badge (🟢 Direct Local Wi-Fi vs 🟡 Relayed / Connecting with latency ms)
 * and a "Resync / Pre-Warm Connection" action that pings the paired peer and refreshes the library list immediately.
 */
export function Phone() {
  const { showToast } = useShell()
  const link = host()?.link as ExtendedHostLink | undefined
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [pairing, setPairing] = useState<{ link: string; expires: number; qr: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [removing, setRemoving] = useState<LinkStatus['phones'][number] | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  useEffect(() => {
    if (!link) return
    const read = () => void link.status().then(setStatus)
    read()
    return link.onChange(read)
  }, [link])

  useEffect(() => {
    if (!pairing) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [pairing])

  useEffect(() => {
    if (
      pairing &&
      (now >= pairing.expires ||
        (status && !status.pairing && now - (pairing.expires - 5 * 60_000) > 1500))
    ) {
      setPairing(null)
    }
  }, [now, pairing, status])

  if (!link) {
    return phoneLink ? (
      <ConnectToPc />
    ) : (
      <div className="ms-set-card">
        <Icon name="computer" size={20} />
        <p>
          Phones pair with the PC app: open Settings → Pair a phone there and scan its code with
          this app.
        </p>
      </div>
    )
  }

  const open = () =>
    void link.pair().then(
      (p) => p && setPairing(p),
      () => showToast("Pairing couldn't start"),
    )
  const close = () => {
    setPairing(null)
    void link.stopPairing()
  }

  const handlePcResync = async () => {
    if (resyncing) return
    setResyncing(true)
    const t0 = performance.now()
    try {
      if (typeof link.resync === 'function') {
        const next = await link.resync()
        if (next) setStatus(next)
        setLatencyMs(
          typeof next?.latencyMs === 'number'
            ? next.latencyMs
            : Math.max(1, Math.round(performance.now() - t0)),
        )
      } else {
        const res = await fetch('/shell-host/resync').then((r) => r.json()).catch(() => null)
        const next = await link.status()
        setStatus(next)
        setLatencyMs(
          typeof res?.latencyMs === 'number'
            ? res.latencyMs
            : Math.max(1, Math.round(performance.now() - t0)),
        )
      }
      await refreshLibrary().catch(() => {})
      showToast('PC Link resynced and library refreshed')
    } catch (e) {
      showToast(String((e as Error)?.message ?? e))
    } finally {
      setResyncing(false)
    }
  }

  const phones = status?.phones ?? []
  const connectedCount = phones.filter((p) => p.connected).length
  const left = pairing ? Math.max(0, Math.round((pairing.expires - now) / 1000)) : 0

  return (
    <>
      <section className="ms-set-section">
        <h3>Connection Status</h3>
        <div className="ms-set-group">
          <div className="ms-set-row">
            <Icon name={status?.online ? 'wifi_tethering' : 'portable_wifi_off'} fill={!!status?.online} />
            <span className="grow ms-set-text">
              <span className="ms-set-label" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>PC Link Host</span>
                <span className="ms-set-badge">
                  {status?.online
                    ? connectedCount > 0
                      ? `🟢 Direct Local Wi-Fi / Active (${connectedCount} connected)`
                      : '🟢 Ready for Paired Phones'
                    : status?.running
                      ? '🟡 Connecting / Starting…'
                      : '⚪ Standby'}
                  {latencyMs !== null ? ` · ${latencyMs} ms` : ''}
                </span>
              </span>
              <small>
                {status?.running
                  ? status.online
                    ? status.lanPort
                      ? `Streaming Host active (LAN HTTP port ${status.lanPort} + encrypted iroh P2P; real-time 128 kbps Low Data streaming ready).`
                      : 'Listening for paired phones via encrypted iroh P2P with real-time 128 kbps Low Data streaming.'
                    : 'Initializing encrypted P2P listener…'
                  : 'Starts automatically as soon as a phone is paired.'}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="ms-set-row clickable"
            disabled={resyncing}
            onClick={() => void handlePcResync()}
          >
            <Icon name="sync" />
            <span className="grow ms-set-text">
              <span className="ms-set-label">
                {resyncing ? 'Resyncing & pre-warming…' : 'Resync / Pre-Warm Connection'}
              </span>
              <small>Re-announce on local Wi-Fi and push updated library tracks to connected phones</small>
            </span>
          </button>
        </div>
      </section>

      <section className="ms-set-section">
        <h3>Phones</h3>
        <div className="ms-set-group">
          {phones.map((p) => (
            <div className="ms-set-row" key={p.id} onContextMenu={(e) => { e.preventDefault(); setDetail(p.id) }}>
              <Icon name={p.connected ? 'phonelink_ring' : 'smartphone'} fill={p.connected} />
              <span className="grow ms-set-text">
                <span className="ms-set-label">{phoneLabel(p)}</span>
                <small>
                  {p.connected
                    ? '🟢 Connected now'
                    : `Paired · expires ${new Date(p.expires).toLocaleDateString()} unless it connects before`}
                </small>
              </span>
              <IconButton icon="edit" label="Rename and details" small onClick={() => setDetail(p.id)} />
              <button type="button" className="ms-btn text" onClick={() => setRemoving(p)}>
                Remove
              </button>
            </div>
          ))}
          {phones.length < 5 ? (
            <button type="button" className="ms-set-row clickable" onClick={open}>
              <Icon name="qr_code_2" />
              <span className="grow ms-set-text">
                <span className="ms-set-label">Pair a phone</span>
                <small>Show a code to scan with this app on your phone</small>
              </span>
              <Icon name="chevron_right" size={20} />
            </button>
          ) : (
            <div className="ms-set-row">
              <Icon name="block" />
              <span className="grow ms-set-text">
                Five phones are paired
                <small>Remove one to pair another</small>
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="ms-set-card">
        <Icon name="shield" size={20} />
        <p>
          Everything between a phone and this PC is paired and authenticated end to end with Ed25519
          keys. On the same Wi-Fi, audio streams directly over an authenticated LAN HTTP channel at
          full speed with zero storage used on your phone; when away from home, it switches
          automatically to encrypted P2P or relay transport. Low Data mode encodes live 128 kbps
          Opus on the fly without waiting for full-file transcoding.
          {status && (
            <>
              {' '}
              This PC is{' '}
              {status.running
                ? status.online
                  ? 'ready for its phones.'
                  : 'starting…'
                : 'not listening: it starts once a phone is paired.'}
            </>
          )}
        </p>
      </div>

      {pairing && (
        <Dialog
          title="Pair a phone"
          onClose={close}
          footer={
            <button type="button" className="ms-btn text" onClick={close}>
              Done
            </button>
          }
        >
          <div className="ms-pair">
            <div className="ms-pair-qr" dangerouslySetInnerHTML={{ __html: pairing.qr }} />
            <p>
              On your phone, open this app, go to <b>Settings → Connect to a PC</b> and scan this
              code. This PC then asks you to allow it.
            </p>
            <p className="ms-pair-left">
              {left > 0
                ? `The code works once, for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more`
                : 'The code has expired'}
            </p>
            <button
              type="button"
              className="ms-btn tonal"
              onClick={() => {
                void navigator.clipboard?.writeText(pairing.link)
                showToast('Pairing link copied')
              }}
            >
              <Icon name="content_copy" size={18} /> Copy link instead
            </button>
          </div>
        </Dialog>
      )}

      {phones.filter((p) => p.id === detail).map((p) => <PhoneProfile key={p.id} phone={p} onClose={() => setDetail(null)} />)}

      {removing && (
        <Dialog
          title={`Remove ${phoneLabel(removing)}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="ms-btn text" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ms-btn primary"
                onClick={() => {
                  void link
                    .remove(removing.id)
                    .then(() => showToast(`${phoneLabel(removing)} removed. It can't connect any more`))
                  setRemoving(null)
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p>
            It&apos;s disconnected right away and can&apos;t play from this PC again unless you pair
            it again.
          </p>
        </Dialog>
      )}
    </>
  )
}

/**
 * Android: Settings → Connect to a PC (§70 D2 & §73.C3).
 * Displays live connection status badge (`🟢 Direct Local Wi-Fi` vs `🟡 Relayed / Connecting` with latency ms)
 * and a "Resync / Pre-Warm Connection" button that pings the paired PC and refreshes the library list immediately.
 */
export function ConnectToPc() {
  const { showToast } = useShell()
  const extLink = phoneLink as ExtendedPhoneLinkPlugin | null
  const [st, setSt] = useState<ExtendedPhoneLinkStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [forgetting, setForgetting] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  useEffect(() => {
    if (!extLink) return
    const read = () =>
      void extLink.status().then((next: ExtendedPhoneLinkStatus) => {
        setSt(next)
        if (typeof next?.latencyMs === 'number') setLatencyMs(next.latencyMs)
      })
    read()
    // Pre-warm connection on mount when paired so the local Wi-Fi path is ready before playback starts
    void extLink
      .ping?.()
      .then((next) => {
        if (next) {
          setSt(next)
          if (typeof next.latencyMs === 'number') setLatencyMs(next.latencyMs)
        }
      })
      .catch(() => {})
    const timer = window.setInterval(read, 3000)
    const sub = extLink.addListener('changed', read)
    return () => {
      window.clearInterval(timer)
      void sub.then((h) => h.remove())
    }
  }, [extLink])

  const pairWith = async (text: string) => {
    if (!extLink || !text.trim()) return
    setBusy('Waiting for the PC to allow this phone…')
    try {
      const r = await extLink.pair({ link: text.trim() })
      showToast(r.ok ? `Connected to ${r.name}. Its songs are in your Library` : pairError(r.error))
      if (r.ok) {
        setTyped('')
        void refreshLibrary().catch(() => {})
      }
    } catch (e) {
      showToast(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
      void extLink.status().then(setSt)
    }
  }

  useEffect(() => {
    const now = takePairLink()
    if (now) void pairWith(now)
    return onPairLink(() => {
      const l = takePairLink()
      if (l) void pairWith(l)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scan = () =>
    void extLink!.scan().then(
      (r) => {
        if (r.text) void pairWith(r.text)
      },
      (e) => showToast(String(e?.message ?? e)),
    )

  const handleResync = async () => {
    if (!extLink || resyncing) return
    setResyncing(true)
    const t0 = performance.now()
    try {
      if (typeof extLink.resync === 'function') {
        const next = await extLink.resync()
        setSt(next)
        setLatencyMs(
          typeof next?.latencyMs === 'number'
            ? next.latencyMs
            : Math.max(1, Math.round(performance.now() - t0)),
        )
      } else {
        await extLink.refresh()
        const next = (await extLink.status()) as ExtendedPhoneLinkStatus
        const elapsed = Math.max(1, Math.round(performance.now() - t0))
        setSt(next)
        setLatencyMs(typeof next?.latencyMs === 'number' ? next.latencyMs : elapsed)
      }
      await refreshLibrary().catch(() => {})
      showToast('Connection pre-warmed & PC library synced')
    } catch (e) {
      showToast(String((e as Error)?.message ?? e))
    } finally {
      setResyncing(false)
    }
  }

  if (st?.paired) {
    const effectiveLatency = st.latencyMs ?? latencyMs
    const transportLabel =
      st.transport === 'lan-http'
        ? 'Direct Local Wi-Fi (HTTP)'
        : st.transport === 'iroh-direct'
          ? 'Direct P2P (QUIC)'
          : st.transport === 'iroh-relayed'
            ? 'Relayed (QUIC)'
            : st.path === 'direct'
              ? 'Direct Local Wi-Fi'
              : 'Relayed / Connecting'
    const badgeLabel = st.refused
      ? '🔴 Pairing Refused / Expired'
      : st.connected
        ? st.path === 'direct'
          ? `🟢 ${transportLabel}${effectiveLatency != null ? ` (${effectiveLatency} ms)` : ''}`
          : `🟡 ${transportLabel}${effectiveLatency != null ? ` (${effectiveLatency} ms)` : ''}`
        : '⚪ Offline / Sleeping'

    const how = st.refused
      ? `${st.name} no longer accepts this phone. Pair again from the PC`
      : st.connected
        ? st.transport === 'lan-http'
          ? 'Streaming over direct local Wi-Fi HTTP with Range seeking and live 128 kbps Low Data support.'
          : st.path === 'relayed'
            ? 'Connected through an encrypted relay. Ensure both devices are on the same Wi-Fi and firewall allows local traffic for direct LAN speed.'
            : 'Connected directly via encrypted P2P QUIC with zero-storage RAM streaming.'
        : `${st.name} is offline or asleep. Tap Resync / Pre-Warm Connection to wake up the link.`

    return (
      <>
        <section className="ms-set-section">
          <h3>Your PC</h3>
          <div className="ms-set-group">
            <div className="ms-set-row">
              <Icon name="computer" fill={st.connected} />
              <span className="grow ms-set-text">
                <span className="ms-set-label" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{st.name}</span>
                  <span className="ms-set-badge">{badgeLabel}</span>
                </span>
                <small>{how}</small>
              </span>
            </div>
            <div className="ms-set-row">
              <Icon name="library_music" />
              <span className="grow ms-set-text">
                {st.songs} songs from this PC
                <small>In your Library, in the {st.name} folder (streamed in RAM · 0 MB phone storage used)</small>
              </span>
            </div>
            <button
              type="button"
              className="ms-set-row clickable"
              disabled={resyncing}
              onClick={() => void handleResync()}
            >
              <Icon name="bolt" />
              <span className="grow ms-set-text">
                <span className="ms-set-label">
                  {resyncing ? 'Pinging PC & refreshing library…' : 'Resync / Pre-Warm Connection'}
                </span>
                <small>
                  Ping {st.name}, establish a direct local Wi-Fi path, and refresh the library track list immediately
                </small>
              </span>
            </button>
            <button
              type="button"
              className="ms-set-row clickable"
              onClick={() => void extLink!.refresh().then(() => refreshLibrary()).then(() => showToast('Checked for new songs'))}
            >
              <Icon name="refresh" />
              <span className="grow ms-set-text">Check for new songs</span>
            </button>
            <button
              type="button"
              className="ms-set-row clickable"
              onClick={() => setForgetting(true)}
            >
              <Icon name="link_off" />
              <span className="grow ms-set-text">
                Disconnect from this PC
                <small>Its songs leave this phone; songs saved on the phone stay</small>
              </span>
            </button>
          </div>
        </section>
        {forgetting && (
          <Dialog
            title={`Disconnect from ${st.name}?`}
            onClose={() => setForgetting(false)}
            footer={
              <>
                <button type="button" className="ms-btn text" onClick={() => setForgetting(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="ms-btn primary"
                  onClick={() => {
                    void extLink!.forget().then(() => refreshLibrary().catch(() => {}))
                    setForgetting(false)
                  }}
                >
                  Disconnect
                </button>
              </>
            }
          >
            <p>To connect again later, pair from the PC&apos;s Settings → Pair a phone.</p>
          </Dialog>
        )}
      </>
    )
  }

  return (
    <>
      <section className="ms-set-section">
        <div className="ms-set-group">
          <button type="button" className="ms-set-row clickable" disabled={!!busy} onClick={scan}>
            <Icon name="qr_code_scanner" />
            <span className="grow ms-set-text">
              <span className="ms-set-label">Scan the PC&apos;s code</span>
              <small>On the PC: Settings → Pair a phone</small>
            </span>
            <Icon name="chevron_right" size={20} />
          </button>
          <form
            className="ms-set-row ms-lib-type"
            onSubmit={(e) => {
              e.preventDefault()
              void pairWith(typed)
            }}
          >
            <Icon name="link" />
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or paste the pairing link"
              aria-label="Pairing link"
            />
            <button type="submit" className="ms-btn text" disabled={!typed.trim() || !!busy}>
              Pair
            </button>
          </form>
        </div>
      </section>
      {busy && (
        <div className="ms-set-card">
          <span className="ms-spinner" />
          <p>{busy}</p>
        </div>
      )}
      <div className="ms-set-card">
        <Icon name="shield" size={20} />
        <p>
          Everything between this phone and your PC is encrypted end to end, at home and away. The
          PC only shares the songs in its library folders, and streamed tracks play directly in RAM
          without filling your phone&apos;s storage.
        </p>
      </div>
    </>
  )
}

export const LinkPage = Phone
export default LinkPage

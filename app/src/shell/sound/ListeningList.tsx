// §118: the listening presets as a list. Each row says what it does on this pair; Gaming slides open its genres.
// A preset sets the earbuds (what the pair supports) and the sound (EQ worked out against the gear, spatial mode).
// When one of the owner's own EQs is playing, it asks first, then hands over (the EQ stays saved).
import { useState } from 'react'
import { earbudsPlan, type Caps, type Noise } from '../../wireless/capabilities'
import { LISTENING, listeningName, type ListeningPreset } from '../../wireless/listeningPresets'
import { useEq } from '../eqState'
import { useShell } from '../context'
import { Dialog, Icon } from '../ui'
import { applyListeningSound, userEqInUse } from './applyListening'

const GROUP_ICON = { gaming: 'sports_esports', focus: 'self_improvement', street: 'directions_walk', plain: 'music_note' } as const

/** The earbud part in words, for this pair. */
function earbudsText(p: ListeningPreset, caps: Caps | null): string | null {
  if (!caps) return null
  const plan = earbudsPlan(p.earbuds, caps)
  const parts = [
    plan.noise ? (plan.noise.mode === 1 ? 'noise cancelling' : plan.noise.mode === 2 ? 'ambient' : 'noise control off') : null,
    plan.game === 1 ? 'game mode' : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function ListeningList({ caps, onEarbuds }: { caps: Caps | null; onEarbuds: (plan: { noise?: Noise; game?: number }) => Promise<void> }) {
  const { showToast } = useShell()
  const eq = useEq()
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<{ preset: ListeningPreset; replaces: string } | null>(null)
  // the row shows its new state at once; the sound follows a frame later and the earbuds after that
  const [pending, setPending] = useState<string | null>(null)
  const playing = pending ?? (eq.on ? eq.preset : null)

  const go = (p: ListeningPreset, toast: string) => {
    setPending(p.group === 'plain' ? '' : listeningName(p))
    window.setTimeout(() => {
      applyListeningSound(p)
      setPending(null)
      showToast(toast)
      void onEarbuds(earbudsPlan(p.earbuds, caps ?? { noise: null, game: false, connection: false, gestures: null }))
    }, 0)
  }
  const pick = (p: ListeningPreset) => {
    // tapping the preset in use again turns it off, as Saved EQ does
    if (p.group !== 'plain' && playing === listeningName(p)) return go(LISTENING.find((x) => x.group === 'plain')!, `${listeningName(p)} off`)
    const mine = p.group === 'plain' ? null : userEqInUse()
    if (mine) setAsking({ preset: p, replaces: mine })
    else go(p, `${listeningName(p)} on`)
  }

  const row = (p: ListeningPreset, sub = false) => {
    const on = p.group === 'plain' ? false : playing === listeningName(p)
    const buds = earbudsText(p, caps)
    return (
      <button type="button" key={p.id} className={`ms-wl-preset${sub ? ' sub' : ''}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => pick(p)}>
        {!sub && <Icon name={GROUP_ICON[p.group]} size={22} />}
        <span className="ms-wl-preset-text">
          <b>{p.label}</b>
          <small>{[buds, p.sound].filter(Boolean).join(' · ')}</small>
        </span>
        {on && <Icon name="check" size={20} />}
      </button>
    )
  }
  const gaming = LISTENING.filter((p) => p.group === 'gaming')
  const gamingOn = gaming.find((p) => playing === listeningName(p))

  return (
    <section className="ms-set-section ms-wl-presets">
      <div className="ms-gear-head"><h3><Icon name="tune" size={20} /> Presets</h3></div>
      <button type="button" className={`ms-wl-preset${gamingOn ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="sports_esports" size={22} />
        <span className="ms-wl-preset-text">
          <b>Gaming{gamingOn ? ` · ${gamingOn.label}` : ''}</b>
          <small>{[earbudsText(gaming[0], caps), 'pick the kind of game'].filter(Boolean).join(' · ')}</small>
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={22} />
      </button>
      {open && <div className="ms-wl-subpresets">{gaming.map((p) => row(p, true))}</div>}
      {/* Plain isn't listed: tapping the preset in use again goes back to plain */}
      {LISTENING.filter((p) => p.group !== 'gaming' && p.group !== 'plain').map((p) => row(p))}
      {asking && (
        <Dialog title={`Use ${listeningName(asking.preset)}?`} onClose={() => setAsking(null)} footer={<>
          <button type="button" className="ms-btn text" onClick={() => setAsking(null)}>Cancel</button>
          <button type="button" className="ms-btn tonal" onClick={() => { const p = asking.preset; setAsking(null); go(p, `${listeningName(p)} on`) }}>Use preset</button>
        </>}>
          <p>{listeningName(asking.preset)} replaces <b>{asking.replaces}</b>. Your EQ stays saved.</p>
        </Dialog>
      )}
    </section>
  )
}

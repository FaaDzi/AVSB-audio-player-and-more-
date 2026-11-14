// The old app's questionnaire (sheets 3–7) as five quick cards before setup (§66): how your sound feels, how loud you
// listen, budget, tuning flavour and genres. The answers feed Pick for me (prefs/scoring.ts pickGameRoster) and the songs.
import { useState } from 'react'
import { Icon, TopBar } from '../ui'
import { sfx } from '../../audio/sfx'
import { FLAVOUR_INFO } from '../../prefs/scoring'
import { DEFAULT_PREFS, type FlavourId, type Preferences, type Volume } from '../../prefs/types'
import { hasSavedProfile, loadPrefs, savePrefs } from '../../tournament/storage'
import { GENRE_GROUPS } from '../../songs/genres'

const FEELINGS = [
  { id: 'too-much-bass', label: 'Too much bass' },
  { id: 'not-enough-bass', label: 'Not enough bass' },
  { id: 'too-bright', label: 'Too bright' },
  { id: 'too-dull', label: 'Too dull' },
  { id: 'vocals-distant', label: 'Vocals feel distant' },
  { id: 'love-it', label: 'Love it' },
  { id: 'want-different', label: 'I want something different' },
]
const VOLUMES: [Volume, string, string][] = [
  ['low', 'Quiet', 'Late at night: needs extra bass and warmth'],
  ['mid', 'Medium', 'Everyday volume, balanced'],
  ['high', 'Loud', 'Front-row energy: smooths sharp treble'],
]
const BUDGETS: { label: string; sub: string; range: [number, number] }[] = [
  { label: 'Under $50', sub: 'Budget kings and giant killers', range: [0, 50] },
  { label: '$50 to $150', sub: 'Sweet-spot daily drivers', range: [50, 150] },
  { label: '$150 to $400', sub: 'Mid-fi heavy hitters', range: [150, 400] },
  { label: '$400 to $1,000', sub: 'Kilobuck contenders', range: [400, 1000] },
  { label: '$1,000 and up', sub: 'Summit-fi and statement gear', range: [1000, 5000] },
]

/** Same mapping as the old questionnaire: what you dislike now becomes what the picks should do differently. */
function currentFrom(feelings: string[], sibilant: boolean): Preferences['current'] {
  const bass = feelings.includes('not-enough-bass') ? 'more' : feelings.includes('too-much-bass') ? 'less' : 'ok'
  const treble = feelings.includes('too-dull') ? 'more' : feelings.includes('too-bright') ? 'less' : 'ok'
  const vocals = feelings.includes('vocals-distant') ? 'more' : 'ok'
  return { bass, vocals, treble, sibilant }
}

const STEPS = ['How does your current sound feel?', 'How loud do you usually listen?', "What's your budget?", 'Pick your tuning flavour', 'Which genres should the songs come from?']

export function QuestionsPage({ onCancel, onDone }: { onCancel: () => void; onDone: (p: Preferences) => void }) {
  const [p, setP] = useState<Preferences>(() => {
    const saved = { ...DEFAULT_PREFS, ...loadPrefs() } as Preferences
    return { ...saved, feelings: saved.feelings?.length ? saved.feelings : ['love-it'], flavour: saved.flavour ?? 'neutral' }
  })
  const [step, setStep] = useState(0)
  const set = (patch: Partial<Preferences>) => setP((x) => ({ ...x, ...patch }))
  const finish = (final = p) => {
    savePrefs(final)
    sfx.playStamp(0.7)
    onDone(final)
  }
  const next = (patch: Partial<Preferences> = {}) => {
    const merged = { ...p, ...patch }
    setP(merged)
    if (step === STEPS.length - 1) return finish(merged)
    sfx.playStamp(0.55)
    setStep(step + 1)
  }
  const toggleFeeling = (id: string) => {
    sfx.playPop()
    const now = p.feelings ?? []
    // "Love it" and the complaints exclude each other
    const feelings = id === 'love-it' ? ['love-it'] : now.includes(id) ? now.filter((f) => f !== id) : [...now.filter((f) => f !== 'love-it'), id]
    set({ feelings, current: currentFrom(feelings, p.current.sibilant) })
  }
  const genres = p.genres ?? []
  const toggleGenre = (id: string) => {
    sfx.playPop()
    set({ genres: genres.includes(id) ? genres.filter((g) => g !== id) : genres.length < 3 ? [...genres, id] : genres })
  }

  return (
    <div className="ms-scroll">
      <TopBar back={step ? () => setStep(step - 1) : onCancel} title="New tournament" actions={hasSavedProfile() ? <button type="button" className="ms-btn text" onClick={() => finish()}>Use my last answers</button> : undefined} />
      <div className="ms-page ms-tz-questions">
        <div className="ms-tz-qdots" aria-label={`Question ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => <i key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />)}
        </div>
        <div className="ms-tz-qcard" key={step}>
          <small>Question {step + 1} of {STEPS.length}</small>
          <h2>{STEPS[step]}</h2>

          {step === 0 && (
            <>
              <div className="ms-tz-qchips">
                {FEELINGS.map((f) => <button type="button" key={f.id} className={`ms-chip${p.feelings?.includes(f.id) ? ' on' : ''}`} onClick={() => toggleFeeling(f.id)}>{f.label}</button>)}
              </div>
              <label className="ms-tz-toggle">
                <input type="checkbox" className="ms-switch" checked={p.current.sibilant} onChange={(e) => set({ current: { ...p.current, sibilant: e.target.checked } })} />
                <span>"S" sounds are harsh (sibilance)</span>
              </label>
              <button type="button" className="ms-btn primary ms-tz-qnext" disabled={!p.feelings?.length} onClick={() => next()}>Next</button>
            </>
          )}

          {step === 1 && (
            <div className="ms-tz-qopts three">
              {VOLUMES.map(([v, title, sub]) => (
                <button type="button" key={v} className={`ms-tz-qopt${p.volume === v ? ' on' : ''}`} onClick={() => next({ volume: v })}>
                  <Icon name={v === 'low' ? 'volume_mute' : v === 'mid' ? 'volume_down' : 'volume_up'} size={30} />
                  <b>{title}</b>
                  <small>{sub}</small>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="ms-tz-qopts">
              {BUDGETS.map((b) => (
                <button type="button" key={b.label} className={`ms-tz-qopt row${p.budget[1] === b.range[1] ? ' on' : ''}`} onClick={() => next({ budget: b.range })}>
                  <b>{b.label}</b>
                  <small>{b.sub}</small>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="ms-tz-qopts flavours">
              {(Object.keys(FLAVOUR_INFO) as FlavourId[]).map((id) => {
                const info = FLAVOUR_INFO[id]
                return (
                  <button type="button" key={id} className={`ms-tz-qopt${p.flavour === id ? ' on' : ''}`} style={{ '--flavour': info.color } as React.CSSProperties} onClick={() => next({ flavour: id, sliders: { ...info.sliders } })}>
                    <span className="ms-tz-flavour-dot" aria-hidden="true" />
                    <b>{info.label}</b>
                    <small>{info.tagline}</small>
                  </button>
                )
              })}
            </div>
          )}

          {step === 4 && (
            <>
              <p className="ms-tz-note">Pick up to 3 ({genres.length}/3), or none to use the whole list.</p>
              <div className="ms-tz-qchips">
                {GENRE_GROUPS.map((g) => <button type="button" key={g.id} className={`ms-chip${genres.includes(g.id) ? ' on' : ''}`} onClick={() => toggleGenre(g.id)}>{g.label}</button>)}
              </div>
              <button type="button" className="ms-btn primary ms-tz-qnext" onClick={() => next()}>{genres.length ? 'Done' : 'Use every genre'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

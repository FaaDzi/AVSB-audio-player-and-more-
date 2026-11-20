import { MyGear } from '../sound/MyGear'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Icon, IconButton } from '../ui'
import { useShell } from '../context'
import { Slider } from '../PlayerBar'
import { getSetting, setSetting, useArtistSeparators, useSettings } from './store'
import { SEPARATORS, splitArtists } from '../library'
import { downloadBackup, parseBackup, restoreBackup } from './backup'
import { importCustomFont, removeCustomFont, SEED_COLORS, useIsDark } from '../theme'
import { ALL_PAGES, DEFAULTS, PAGE_GROUPS, searchPages, type Page, type Row, type Rule, type Section } from './pages'
import { analysedCount, clearAnalysis, libraryCount, useAnalysisProgress } from '../analysis'
import { LEARN_AFTER } from '../autoplay'
import { getListening, resetLearning, useListening } from '../stats'
import { StatsPage } from './StatsPage'
import { BulkMetaRows, DuplicatesPage, LibraryCount, LibraryFolders, MetadataNamingSection } from './LibraryPages'
import { scan, triggerMetadataRefresh } from '../localLibrary'
import { About, DataNetworkSection, Equalizer, HeaderSlot, SwapPage, Logs, NetworkEmpty, Phone, PriorityPage, Shortcuts, Storage } from './CustomPages'
import { ProfileCard } from './LinkPage'
import { AppUpdateRow, UpdateDot } from './AppUpdate'
import { SavedEqPage } from './SavedEqPage'
import { onPhoneBack, usePhone } from '../PhoneNav'

type Value = boolean | string | number
type Ctx = { get: (id: string) => Value | undefined; set: (id: string, v: Value) => void; enter: (id: string) => void }

/** Action rows that do something, with a line that says where they stand. */
const ACTIONS: Record<string, { sub: () => string; confirm: string; button: string; run: (toast: (text: string) => void) => void }> = {
  'Reset recommendation learning': {
    sub: () => `Ranking tunes to you after ${LEARN_AFTER} Autoplay songs (${getListening().autoplayed} so far)`,
    confirm: 'Autoplay forgets what it learned from your listening and skips. Your statistics stay.',
    button: 'Reset',
    run: (toast) => { resetLearning(); toast('Recommendation learning reset') },
  },
  'Clear song analysis': {
    sub: () => `${analysedCount()} of ${libraryCount()} songs analyzed`,
    confirm: 'Autoplay forgets how your songs sound. While Song analysis is on, your Library is analyzed again.',
    button: 'Clear',
    run: (toast) => { void clearAnalysis().then(() => toast('Song analysis cleared')) },
  },
}

const trailOf = (id: string) => ALL_PAGES.find((p) => p.id === id)?.parent

/** Three panes: the app sidebar, this list with search, then the open page. */
export function SettingsPage({ initial }: { initial?: string }) {
  const phone = usePhone()
  // the phone opens on the list unless it was sent to a page (a link from elsewhere in the app)
  const [phonePane, setPhonePane] = useState(Boolean(initial))
  const [openId, setOpenId] = useState(initial ?? 'appearance')
  const [history, setHistory] = useState<string[]>(() => {
    const parent = initial && trailOf(initial)
    return parent ? [parent] : []
  })
  const [query, setQuery] = useState('')
  useSettings()
  useListening()
  useAnalysisProgress()
  const dark = useIsDark()
  const [scrolled, setScrolled] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const hits = useMemo(() => searchPages(query).filter((h) => !phone || h.page.id !== 'shortcuts'), [query, phone])
  const open = ALL_PAGES.find((p) => p.id === openId) ?? ALL_PAGES[0]

  const moveTo = (id: string, trail: string[]) => {
    setHistory(trail)
    setOpenId(id)
    setScrolled(false)
  }
  const show = (id: string) => {
    const parent = trailOf(id)
    moveTo(id, parent ? [parent] : [])
    setPhonePane(true)
  }
  const enter = (id: string) => moveTo(id, [...history, openId])
  const swap = (id: string) => moveTo(id, history)
  const back = () => moveTo(history[history.length - 1], history.slice(0, -1))
  const selected = history.length ? history[0] : openId
  const hasBack = history.length > 0 || phone
  // on the phone the list and the page take turns: the page's back goes up a level, then to the list
  const backPhone = () => (history.length ? back() : setPhonePane(false))
  const backRef = useRef(backPhone)
  backRef.current = backPhone
  useEffect(() => onPhoneBack(() => {
    if (!phone || !phonePane) return false
    backRef.current()
    return true
  }), [phone, phonePane])

  useEffect(() => {
    if (initial) show(initial)
  }, [initial])

  const ctx: Ctx = {
    get: (id) => (id === '__dark' ? dark : getSetting(id)),
    set: setSetting,
    enter,
  }

  return (
    <div className={`ms-settings${phone ? ` phone ${phonePane ? 'pane' : 'list'}` : history.length ? ' deep' : ''}`}>
      <div className="ms-settings-list">
        <h1>Settings</h1>
        <label className="ms-search small">
          <Icon name="search" />
          <input placeholder="Search settings" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <IconButton icon="close" label="Clear search" small onClick={() => setQuery('')} />}
        </label>
        {query ? (
          <div className="ms-settings-group">
            {!hits.length && <p className="ms-settings-none">Nothing matches.</p>}
            {hits.map((h) => (
              <button type="button" className="ms-settings-item" key={`${h.page.id}-${h.row ?? ''}`} onClick={() => show(h.page.id)}>
                <Icon name={h.page.icon} />
                <span className="grow ms-ellipsis">{h.row ?? h.page.title}{h.row && <small>{h.page.title}</small>}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <ProfileCard selected={selected === 'phone'} onOpen={() => show('phone')} />
            {PAGE_GROUPS.map((group, i) => {
              const visiblePages = group.filter((p) => !phone || p.id !== 'shortcuts')
              if (!visiblePages.length) return null
              return (
                <div className="ms-settings-group" key={i}>
                  {visiblePages.map((p) => (
                    <button type="button" key={p.id} className={`ms-settings-item${selected === p.id ? ' on' : ''}`} aria-current={selected === p.id ? 'page' : undefined} onClick={() => show(p.id)}>
                      <Icon name={p.icon} fill={selected === p.id} />
                      <span className="grow">{p.title}</span>
                      {p.id === 'app' && <UpdateDot />}
                    </button>
                  ))}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="ms-settings-pane">
        <header className={`ms-settings-title${scrolled ? ' stuck' : ''}`}>
          {hasBack && <IconButton icon="arrow_back" label="Back" filled onClick={phone ? backPhone : back} />}
          <span className="ms-settings-title-small grow ms-ellipsis" aria-hidden={!scrolled}>{open.title}</span>
          <div className="ms-settings-actions" ref={setSlot} />
        </header>
        <div className="ms-settings-body" key={open.id} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > (hasBack ? 64 : 40))}>
          <h2 className={`ms-settings-bigtitle${hasBack ? ' sub' : ''}`}>{open.title}</h2>
          <HeaderSlot.Provider value={slot}>
          <SwapPage.Provider value={swap}>
            {open.custom === 'gear' ? <MyGear />
              : open.custom === 'equalizer' ? <Equalizer />
              : open.custom === 'stats' ? <StatsPage />
              : open.custom === 'storage' ? <Storage />
              : open.custom === 'logs' ? <Logs />
              : open.custom === 'shortcuts' ? <Shortcuts />
              : open.custom === 'about' ? <About />
              : open.custom === 'phone' ? <Phone />
              : open.custom === 'lyrics-priority' ? <PriorityPage kind="lyrics" />
              : open.custom === 'metadata-priority' ? <PriorityPage kind="metadata" />
              : open.custom === 'duplicates' ? <DuplicatesPage />
              : open.custom === 'saved-eq' ? <SavedEqPage />
              : <Sections page={open} ctx={ctx} />}
          </SwapPage.Provider>
          </HeaderSlot.Provider>
        </div>
      </div>
    </div>
  )
}

const matches = (rule: Rule | undefined, ctx: Ctx) => rule !== undefined && (Array.isArray(rule.is) ? rule.is.includes(String(ctx.get(rule.id))) : ctx.get(rule.id) === rule.is)

function Sections({ page, ctx }: { page: Page; ctx: Ctx }) {
  return (
    <>
      {page.sections?.filter((s) => !s.when || matches(s.when, ctx)).map((section: Section, i) => {
        const rows = section.rows.filter((r) => !r.when || matches(r.when, ctx))
        return (
          <section key={i} className="ms-set-section">
            {section.title && <h3>{section.title}</h3>}
            {section.block === 'library-count' && <LibraryCount />}
            {section.block === 'network-empty' && <NetworkEmpty />}
            {section.block === 'library-folders' && <LibraryFolders />}
            {section.block === 'separator-preview' && <SeparatorPreview />}
            {section.block === 'metadata-naming' && <MetadataNamingSection />}
            {section.block === 'metadata-bulk' && <BulkMetaRows />}
            {section.block === 'app-update' && <AppUpdateRow />}
            {rows.length > 0 && (
              <div className="ms-set-group">
                {rows.map((row) => <SettingRow key={row.label} row={row} ctx={ctx} />)}
              </div>
            )}
            {section.block === 'data-network' && <DataNetworkSection />}
            {section.block === 'style-preview' && <StylePreview theme={String(ctx.get('theme'))} glass={ctx.get('style') === 'Game show'} />}
            {section.card && (
              <div className="ms-set-card">
                <Icon name={section.card.icon} size={20} />
                <p>{section.card.title && <b>{section.card.title}</b>}{section.card.text}</p>
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

function StylePreview({ theme, glass }: { theme: string; glass: boolean }) {
  const light = theme === 'Light'
  return (
    <div className={`ms-style-preview${light ? ' light' : ''}${glass ? ' glass gameshow' : ''}`} aria-hidden="true">
      <i className="blob a" />
      <i className="blob b" />
      <div className="ms-style-card">
        <div className="art"><Icon name="music_note" fill size={48} /></div>
        <div className="grow">
          <i className="bar a" />
          <i className="bar b" />
          <div className="controls">
            <Icon name="skip_previous" fill size={24} />
            <span className="play"><Icon name="play_arrow" fill size={22} /></span>
            <Icon name="skip_next" fill size={24} />
          </div>
        </div>
      </div>
      <span className="pill">{light ? 'Light' : 'Dark'}</span>
    </div>
  )
}

/** Real artist tags from the library that hold a separator mark, and what Library makes of each with the current choice. */
function SeparatorPreview() {
  const { data } = useShell()
  const separators = useArtistSeparators()
  const examples = useMemo(() => {
    const marks = SEPARATORS.map((m) => m.mark)
    const tags = [...new Set(data.tracks.map((t) => t.artist))].filter((a) => marks.some((m) => a.includes(m)))
    // one of each mark first, so every switch has something to show
    const picked = marks.flatMap((m) => tags.filter((a) => a.includes(m)).slice(0, 2))
    return [...new Set(picked)].slice(0, 8)
  }, [data.tracks])
  if (!examples.length) return null
  return (
    <>
      <h3>Preview from your library</h3>
      <div className="ms-set-group">
        {examples.map((tag) => {
          const parts = splitArtists(tag, separators)
          return (
            <div key={tag} className="ms-set-row">
              <Icon name={parts.length > 1 ? 'group' : 'person'} />
              <span className="grow ms-set-text">{tag}<small>{parts.length > 1 ? `${parts.length} artists: ${parts.join(' · ')}` : 'One artist'}</small></span>
            </div>
          )
        })}
      </div>
    </>
  )
}


function Label({ row }: { row: Row }) {
  return <span className="ms-set-label">{row.label}{row.badge && <em className="ms-set-badge">{row.badge}</em>}</span>
}

function SettingRow({ row, ctx }: { row: Row; ctx: Ctx }) {
  const { showToast } = useShell()
  const [choosing, setChoosing] = useState(false)
  const fontPicker = useRef<HTMLInputElement>(null)
  const restorePicker = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(false)
  const icon = row.icon && <Icon name={row.icon} />
  const text = (sub: string | undefined, sub2?: string) => (
    <span className="grow ms-set-text"><Label row={row} />{sub && <small>{sub}</small>}{sub2 && <small>{sub2}</small>}</span>
  )

  switch (row.kind) {
    case 'toggle': {
      const disabled = matches(row.disabledWhen, ctx)
      const on = !disabled && Boolean(ctx.get(row.id))
      const sub = !on && row.off ? row.off : row.sub
      return (
        <label className={`ms-set-row toggle clickable${disabled ? ' dim' : ''}`} style={disabled ? { pointerEvents: 'none' } : undefined}>
          {icon}
          {text(sub, row.sub2)}
          <input type="checkbox" role="switch" className="ms-switch" checked={on} disabled={disabled} onChange={(e) => ctx.set(row.id, e.target.checked)} />
        </label>
      )
    }
    case 'nav':
      return (
        <button type="button" className="ms-set-row clickable" onClick={() => {
          if (row.to) ctx.enter(row.to)
          else showToast(`${row.label} is here for layout only`)
        }}>
          {icon}
          {text(row.sub)}
          <Icon name="chevron_right" size={20} />
        </button>
      )
    case 'swatches': {
      const now = String(ctx.get('seed') ?? SEED_COLORS[0])
      return (
        <div className="ms-swatches" role="radiogroup" aria-label={row.label}>
          {SEED_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={c === now} aria-label={c} className={`ms-swatch${c === now ? ' on' : ''}`} style={{ background: c }} onClick={() => ctx.set('seed', c)}>
              {c === now && <Icon name="check" size={22} />}
            </button>
          ))}
        </div>
      )
    }
    case 'font': {
      const name = String(ctx.get('customfont') ?? '')
      return (
        <>
          <button type="button" className="ms-set-row clickable" onClick={() => { if (name) void removeCustomFont(); else fontPicker.current?.click() }}>
            {icon}
            {text(name || row.sub)}
            <Icon name={name ? 'close' : 'add'} size={24} />
          </button>
          <input
            ref={fontPicker}
            type="file"
            hidden
            accept=".ttf,.otf"
            aria-label={row.label}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) importCustomFont(file).then(() => showToast(`Using ${file.name}`), (err: Error) => showToast(err.message))
            }}
          />
        </>
      )
    }
    case 'action':
      return (
        <>
        <button type="button" className={`ms-set-row clickable${row.danger ? ' danger' : ''}`} onClick={() => {
          if (row.label === 'Create backup file') { void downloadBackup().then(() => showToast('Backup saved to your downloads')) }
          else if (row.label === 'Choose backup file') restorePicker.current?.click()
          else if (row.label === 'Scan Library' || row.label === 'Force Full Scan') void scan(row.label === 'Force Full Scan').then(() => showToast('Scanning your folders'), () => showToast("The scan couldn't start"))
          else if (row.label === 'Refresh metadata') void triggerMetadataRefresh().catch(() => showToast("Metadata refresh couldn't start"))
          else if (ACTIONS[row.label]) setChoosing(true)
          else showToast(`${row.label} isn't working yet`)
        }}>
          {icon}
          {text(ACTIONS[row.label]?.sub() ?? row.sub)}
          {!row.plain && <Icon name={row.trail ?? 'chevron_right'} size={row.trail ? 24 : 20} />}
          {row.label === 'Choose backup file' && (
            <input
              ref={restorePicker}
              type="file"
              hidden
              accept=".json"
              aria-label={row.label}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                file.text().then(async (text) => {
                  await restoreBackup(parseBackup(text))
                  window.location.reload()
                }).catch((err: Error) => showToast(err.message))
              }}
            />
          )}
        </button>
        {choosing && ACTIONS[row.label] && (
          <Dialog
            title={`${row.label}?`}
            onClose={() => setChoosing(false)}
            footer={(
              <>
                <button type="button" className="ms-btn text" onClick={() => setChoosing(false)}>Cancel</button>
                <button type="button" className="ms-btn text" onClick={() => { ACTIONS[row.label].run(showToast); setChoosing(false) }}>{ACTIONS[row.label].button}</button>
              </>
            )}
          >
            <p className="ms-confirm-text">{ACTIONS[row.label].confirm}</p>
          </Dialog>
        )}
        </>
      )
    case 'choice': {
      const value = String(ctx.get(row.id))
      return (
        <>
          <button type="button" className="ms-set-row clickable" aria-haspopup="dialog" onClick={() => setChoosing(true)}>
            {icon}
            {text(row.format ? row.format(value) : value)}
            <Icon name="chevron_right" size={20} />
          </button>
          {choosing && (
            <Dialog title={row.label} onClose={() => setChoosing(false)}>
              <div className="ms-choices" role="radiogroup" aria-label={row.label}>
                {row.options.map((o) => (
                  <button type="button" key={o} role="radio" aria-checked={o === value} className={o === value ? 'on' : ''} onClick={() => { ctx.set(row.id, o); setChoosing(false) }}>
                    <span className="grow">{row.format ? row.format(o) : o}</span>
                    {o === value && <Icon name="check" size={20} />}
                  </button>
                ))}
              </div>
            </Dialog>
          )}
        </>
      )
    }
    case 'pick': {
      const on = ctx.get(row.id) === row.label
      const circle = row.mark === 'circle'
      return (
        <button type="button" role="radio" aria-checked={on} className={`ms-set-row clickable${circle ? ' pick' : ''}${on && circle ? ' on' : ''}`} onClick={() => ctx.set(row.id, row.label)}>
          {icon}
          {text(row.sub)}
          {on ? (
            <span className="ms-pick-mark on"><Icon name={circle ? 'check_circle' : 'check'} fill={circle} size={circle ? 26 : 24} /></span>
          ) : circle ? (
            <span className="ms-pick-mark off"><Icon name="radio_button_unchecked" size={26} /></span>
          ) : (
            <Icon name="chevron_right" size={20} />
          )}
        </button>
      )
    }
    case 'segment': {
      const disabled = matches(row.disabledWhen, ctx)
      const value = String(ctx.get(row.id))
      const sub = row.options.find((o) => o.label === value)?.sub ?? row.sub
      return (
        <div className={`ms-set-row column segment${row.icon ? ' has-icon' : ''}${disabled ? ' dim' : ''}`} style={disabled ? { pointerEvents: 'none' } : undefined}>
          {!row.hideLabel && <div className="ms-set-line">{icon}{sub ? text(sub) :<span className="grow ms-set-head">{row.label}</span>}</div>}
          <div className="ms-segment-small big" role="radiogroup" aria-label={row.label}>
            {row.options.map((o) => (
              <button
                type="button"
                key={o.label}
                role="radio"
                disabled={disabled}
                aria-checked={o.label === value}
                className={o.label === value ? 'on' : ''}
                onClick={() => !disabled && ctx.set(row.id, o.label)}
              >
                {o.icon && <Icon name={o.icon} size={18} fill={o.label === value} />}{o.label}
              </button>
            ))}
          </div>
          {row.note && <small className="ms-set-note"><Icon name="info" size={16} /> {row.note}</small>}
        </div>
      )
    }
    case 'tiles': {
      const value = String(ctx.get(row.id))
      const sub = row.subFor ? row.subFor(value) : row.sub
      return (
        <div className="ms-set-row column tiles">
          {!row.tall && <div className="ms-set-tiles-head">{row.label}{sub && <small className={row.subFor ? 'accent' : ''}>{sub}</small>}</div>}
          <div className={`ms-set-tile-grid${row.tall ? ' tall' : ''}`} role="radiogroup" aria-label={row.label}>
            {row.options.map((o) => (
              <button type="button" key={o.label} role="radio" aria-checked={o.label === value} className={o.label === value ? 'on' : ''} onClick={() => ctx.set(row.id, o.label)}>
                {o.icon && <Icon name={o.icon} fill size={row.tall ? 26 : 20} />}
                <span className="ms-ellipsis">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )
    }
    case 'chips': {
      const value = String(ctx.get(row.id))
      return (
        <div className="ms-set-row column inline-control">
          <span className="ms-set-minihead">{row.label}</span>
          <div className="ms-chips" role="radiogroup" aria-label={row.label}>
            {row.options.map((o) => <button type="button" key={o} role="radio" aria-checked={o === value} className={`ms-chip big${o === value ? ' on' : ''}`} onClick={() => ctx.set(row.id, o)}>{o}</button>)}
          </div>
        </div>
      )
    }
    case 'slider': {
      const value = Number(ctx.get(row.id))
      const start = DEFAULTS[row.id] as number
      const pct = ((value - row.min) / (row.max - row.min)) * 100
      const dots = row.ticks ? { backgroundSize: `calc(100% / ${row.ticks}) 100%` } : undefined
      return (
        <div className="ms-set-row column slider">
          <div className="ms-set-line">
            <span className="grow ms-set-minihead">{row.label}</span>
            <span className="ms-value">{row.format(value)}</span>
            {row.resettable && <IconButton icon="restart_alt" label={`Reset ${row.label}`} small onClick={() => ctx.set(row.id, start)} />}
          </div>
          {row.sub && <small className="ms-slider-sub">{row.sub}</small>}
          {row.preview && <p className="ms-lyric-preview" style={{ fontSize: `${24 * value}px` }}>{row.preview}</p>}
          <div className="ms-set-slider">
            <Slider thick label={row.label} min={row.min} max={row.max} step={row.step} value={value} onChange={(v) => ctx.set(row.id, v)} />
            {dots && <i className="ms-ticks on" style={{ ...dots, clipPath: `inset(0 ${100 - pct}% 0 0)` }} />}
            {dots && <i className="ms-ticks" style={{ ...dots, clipPath: `inset(0 0 0 ${pct}%)` }} />}
          </div>
          {row.note && <small className="ms-slider-note">{row.note}</small>}
        </div>
      )
    }
    case 'bubble':
      return <div className="ms-set-bubble">{row.label}</div>
    case 'info':
      return <div className="ms-set-row">{icon}{text(row.sub)}{row.value && <span className="ms-value">{row.value}</span>}</div>
    case 'expander':
      return (
        <>
          <button type="button" className="ms-set-row clickable" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {icon}
            {text(row.summary(ctx.get))}
            <Icon name={expanded ? 'expand_less' : 'expand_more'} />
          </button>
          {expanded && row.children.map((child) => <SettingRow key={child.label} row={child} ctx={ctx} />)}
        </>
      )
  }
}

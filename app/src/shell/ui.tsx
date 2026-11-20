import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { onPhoneBack } from './phoneBack'
import { createPortal } from 'react-dom'
import { coverUrl } from './library'
import { useExitCopy } from './motion'

export function Icon({ name, fill, size }: { name: string; fill?: boolean; size?: number }) {
  return (
    <span
      className="material-symbols-rounded ms-icon"
      aria-hidden="true"
      style={{ fontSize: size, fontVariationSettings: fill ? "'FILL' 1" : undefined }}
    >
      {name}
    </span>
  )
}

export function IconButton({ icon, label, onClick, small, filled, active, className }: {
  icon: string
  label: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  small?: boolean
  filled?: boolean
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`ms-iconbtn${small ? ' small' : ''}${filled ? ' filled' : ''}${active ? ' active' : ''}${icon === 'favorite' ? ' liked' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} fill={icon === 'favorite'} size={small ? 20 : 22} />
    </button>
  )
}

/** Covers that failed to load after retry (a phone song with no art): shown as the plain tile from then on. */
const missingCovers = new Set<string>()

interface PlaceholderProps {
  alt?: string
  className?: string
  genre?: string
  speciality?: string
  title?: string
}

const STANDARD_GENRES = [
  'pop',
  'rock',
  'hip-hop',
  'rap',
  'electronic',
  'club',
  'indie',
  'r&b',
  'dance',
  'trap',
  'house',
  'ambient',
  'lo-fi',
  'synth',
  'metal',
  'jazz',
  'acoustic',
]

/** Title words that name a genre outright. Whole words only: "trap" or "house" in a title usually aren't the genre. */
const TITLE_GENRES: [RegExp, string][] = [
  [/\blo-?fi\b/, 'lo-fi'],
  // Vocaloid rips name their singer in the title ("THE END OF HATSUNE MIKU", "[IA] A Tale of Six Trillion Years")
  [/\b(?:hatsune miku|kagamine (?:rin|len)|megurine luka|kasane teto|gumi)\b|\[ia\]/, 'vocaloid'],
  [/\b(?:phonk)\b/, 'phonk'],
  [/\b(?:synthwave|vaporwave)\b/, 'synthwave'],
  [/\b(?:symphony|sonata|concerto|nocturne|étude|etude)\b/, 'classical'],
  [/\bpiano\b/, 'piano'],
  [/\bacoustic\b/, 'acoustic'],
  [/\bjazz\b/, 'jazz'],
]

/**
 * A short genre label for covers without artwork (plan §76 G): the genre tag (the library already fills in the online
 * details and the artist's usual genre, library.ts), else a genre word in the title, else '' — never an invented one.
 * The old hash fallback put random genres on untagged songs ("metal" on Vocaloid).
 */
export function resolveGenre(genre?: string, _speciality?: string, title?: string, alt?: string): string {
  if (genre && genre.trim()) {
    // accents folded: "Électronique" reads as electronique (and matches electro*)
    const raw = genre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    if (/\bhip[- ]?hop\b/.test(raw)) return 'hip-hop'
    if (/\br(?:&|n|and )b\b/.test(raw)) return 'r&b'
    if (/\blo-?fi\b/.test(raw)) return 'lo-fi'
    for (const g of STANDARD_GENRES) {
      if (new RegExp(`\\b${g.replace(/[&-]/g, '\\$&')}\\b`).test(raw)) return g
    }
    const first = raw.split(/[/,;|]/)[0]?.trim() || raw
    // a long tag ("cinematic classical") shows its first word, not a cut-off "cinematic cl"
    return first.length <= 14 ? first : first.split(/\s+/)[0].slice(0, 14)
  }
  const hay = `${title || ''} ${alt || ''}`.toLowerCase()
  return TITLE_GENRES.find(([word]) => word.test(hay))?.[1] ?? ''
}

export interface AudiophilePaletteItem {
  id: string
  name: string
  bg: string
  text: string
  category: string
  genres: string
  benchmark: string
  description: string
}

export const AUDIOPHILE_PALETTE: AudiophilePaletteItem[] = [
  {
    id: 'bass',
    name: 'Crimson Red',
    bg: '#e11d48',
    text: '#ffffff',
    category: 'Sub-Bass & Bass Impact',
    genres: 'Rap, Trap, Hip-Hop, Drill, Phonk, Club',
    benchmark: 'Low-end extension (20–60 Hz), sub-bass rumble, dynamic driver slam, speed, and bass bleed prevention.',
    description: 'Used by audiophiles to test how deep and tight low frequencies hit without muddying the midrange vocals.',
  },
  {
    id: 'speed',
    name: 'Lime Green',
    bg: '#8ace00',
    text: '#000000',
    category: 'Transient Speed & Complex Layering',
    genres: 'Rock, Metal, Punk, Hardcore, Breakcore, Grunge, Prog',
    benchmark: 'Driver speed, fast transient attack/decay, electric guitar separation, and harshness control in busy passages.',
    description: 'Heavy guitar distortions and rapid drum rolls stress-test driver recovery and instrument separation.',
  },
  {
    id: 'vocals',
    name: 'Warm Coral',
    bg: '#f97316',
    text: '#000000',
    category: 'Midrange Purity & Vocal Intimacy',
    genres: 'Pop, R&B, Soul, Indie, Folk, Ballad, Singer-Songwriter',
    benchmark: 'Ear-gain curve (1–3 kHz), pinna compensation, male/female vocal forwardness, and natural, uncolored vocal timbre.',
    description: 'Tests for warm, natural vocal delivery without sibilance, shoutiness, or hollow boxiness in the midrange.',
  },
  {
    id: 'treble',
    name: 'Electric Cyan',
    bg: '#06b6d4',
    text: '#000000',
    category: 'Treble Sparkle & High-Frequency Air',
    genres: 'Synthwave, EDM, Dance, House, Techno, Hyperpop, City Pop',
    benchmark: 'Upper treble extension (8–16 kHz), micro-detail resolution, shimmer, and sibilance control on snappy electronic transients.',
    description: 'Crisp electronic synths and hi-hats reveal whether an IEM has airy, sparkling extension or harsh, fatiguing peaks.',
  },
  {
    id: 'stage',
    name: 'Ultraviolet Purple',
    bg: '#8b5cf6',
    text: '#ffffff',
    category: 'Soundstage & Spatial Separation',
    genres: 'Ambient, Soundtracks, OST, Cinematic Orchestral, Trance',
    benchmark: 'Horizontal soundstage width, depth, ambient reverb decay, and holographic 3D instrumental positioning.',
    description: 'Tests whether the sound feels trapped inside your head or expands outwards into a deep, immersive concert hall.',
  },
  {
    id: 'acoustic',
    name: 'Emerald Green',
    bg: '#10b981',
    text: '#000000',
    category: 'Acoustic Timbre & Natural Decay',
    genres: 'Classical, Jazz, Acoustic, Piano, Instrumental, Blues',
    benchmark: 'Natural acoustic decay of wooden instrument bodies, cello/violin resonance, brass warmth, and realistic harmonics.',
    description: 'Tests if live unamplified instruments sound authentic and true to life with correct organic resonance.',
  },
  {
    id: 'chill',
    name: 'Royal Blue',
    bg: '#3b82f6',
    text: '#ffffff',
    category: 'Analog Warmth & Relaxed Listening',
    genres: 'Lo-Fi, Chillhop, Downtempo',
    benchmark: 'Warm analog roll-off, vinyl crackle texture, and smooth, fatigue-free tuning for long sessions.',
    description: 'Tests smooth frequency roll-off and warm bass response designed for extended, relaxed listening without fatigue.',
  },
]

/**
 * Genre → speciality (plan §76 G), first rule that matches wins, whole words only (the old substring checks put
 * "post-rock" under soundtracks via "ost" and "midnight" under vocals via "mid"). More specific rules come first:
 * "drum & bass" is speed, not bass; "synthpop" is treble, not vocals; "pop rap" is bass.
 */
const SPECIALTY_RULES: [RegExp, AudiophilePaletteItem['id']][] = [
  [/\b(?:lo-?fi|chill(?:hop|wave|out)?|downtempo|trip[- ]?hop|jazz[- ]?hop|bedroom pop)\b/, 'chill'],
  [/\b(?:ambient|soundtracks?|ost|score|cinematic|orchestral|orchestra|films?|video games?|games?|vgm|new age|trance|post-rock|shoegaze)\b/, 'stage'],
  [/\b(?:classical|jazz|acoustic|piano|instrumental|opera|blues|bossa nova|swing|bluegrass|unplugged|baroque)\b/, 'acoustic'],
  [/\b(?:metal\w*|rock|punk|hardcore|grunge|breakcore|prog\w*|emo|screamo|djent|alternative|post-hardcore|drum (?:and|&|n) bass|dnb|speedcore)\b/, 'speed'],
  [/\b(?:hip-hop|rap|trap|drill|phonk|club|grime|dubstep|bass|reggaeton|dancehall|afrobeats?|crunk)\b/, 'bass'],
  [/\b(?:edm|electronic|electro\w*|house|techno|dance|disco|synth\w*|hyperpop|future bass|eurobeat|city pop|nightcore)\b/, 'treble'],
  [/\b(?:pop|r&b|rnb|soul|indie|folk|ballads?|singer-songwriter|country|gospel|vocal\w*|vocaloid|utaite|j-?pop|k-?pop|anime|enka|kayokyoku|a cappella)\b/, 'vocals'],
]
/** Speciality words the curated song lists use ("Bass & Energy", "Busy & Complex", ...). */
const SPECIALITY_WORDS: [RegExp, AudiophilePaletteItem['id']][] = [
  [/\b(?:bass|energy|slam)\b/, 'bass'],
  [/\b(?:busy|complex|speed)\b/, 'speed'],
  [/\b(?:vocals?|mid|midrange|presence)\b/, 'vocals'],
  [/\b(?:treble|detail|sparkle|air)\b/, 'treble'],
  [/\b(?:stage|separation|width)\b/, 'stage'],
  [/\b(?:acoustic|timbre|unplugged)\b/, 'acoustic'],
]
/** No genre and no speciality anywhere: a neutral cover instead of a colour that would claim something. */
export const UNKNOWN_COVER = { bg: '#52525b', text: '#ffffff' }

export function getSpecialtyColor(speciality?: string, resolvedGenre?: string): { bg: string; text: string; item?: AudiophilePaletteItem } {
  const spec = (speciality || '').toLowerCase()
  const genre = (resolvedGenre || '').toLowerCase()
  const id = SPECIALITY_WORDS.find(([w]) => w.test(spec))?.[1] ?? SPECIALTY_RULES.find(([w]) => w.test(genre))?.[1]
  const item = AUDIOPHILE_PALETTE.find((p) => p.id === id)
  return item ? { bg: item.bg, text: item.text, item } : UNKNOWN_COVER
}

/** The genre cover as a 512 px image, for the media notification and lock screen when a song has no art. */
export function placeholderCoverImage(genre?: string, speciality?: string, title?: string): string {
  const genreLabel = resolveGenre(genre, speciality, title).toLowerCase()
  const { bg, text, item } = getSpecialtyColor(speciality, genreLabel)
  const label = genreLabel || item?.id || 'music'
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const g = canvas.getContext('2d')
  if (!g) return ''
  g.fillStyle = bg
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = text
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  let size = label.length <= 4 ? 150 : label.length <= 7 ? 116 : 88
  do {
    g.font = `800 ${size}px ${family}`
    size -= 6
  } while (g.measureText(label).width > 440 && size > 30)
  g.fillText(label, 256, 262)
  return canvas.toDataURL('image/jpeg', 0.9)
}

export function PlaceholderCover({ alt = '', className = '', genre, speciality, title: _title }: PlaceholderProps) {
  const isParty = typeof document !== 'undefined' && document.documentElement.getAttribute('data-style') === 'gameshow'
  const genreLabel = resolveGenre(genre, speciality, _title, alt).toLowerCase()
  const { bg, text, item } = getSpecialtyColor(speciality, genreLabel)
  // no genre: the speciality's short name ("bass", "vocals"), or a plain "music" on the grey unknown cover
  const label = genreLabel || item?.id || 'music'

  const isHero = /ms-(np-cover|cover-disc|np-fullart|song-cover|album-cover|detail-cover)/.test(className)
  const isThumb = /ms-(thumb|mini-art|pmini-art|player-art|sr-art|stats-cover|dupe-cover|order-cover)/.test(className)

  // Responsive font scaling:
  // - Hero / Big music mode: bold, giant (44-76px)
  // - Small list thumbnails: neat, compact (8-11px)
  // - Preview cards (library/home/folders): perfectly balanced and fully readable without cutoff (10-18px)
  const fontClamp = isHero
    ? label.length <= 4
      ? 'clamp(44px, 22cqi, 76px)'
      : label.length <= 7
        ? 'clamp(34px, 17cqi, 58px)'
        : 'clamp(26px, 13cqi, 44px)'
    : isThumb
      ? 'clamp(8px, 20cqi, 11px)'
      : label.length <= 4
        ? 'clamp(13px, 16cqi, 18px)'
        : label.length <= 7
          ? 'clamp(11px, 13cqi, 15px)'
          : 'clamp(10px, 11cqi, 13px)'

  const fontLetterSpacing = isHero ? '-0.05em' : isThumb ? '-0.02em' : '-0.03em'
  const fontWeight = isHero || isThumb ? 800 : 700

  return (
    <div
      className={`ms-cover ms-cover-placeholder ${isParty ? 'party' : 'modern'} ${isHero ? 'ms-cover-hero' : isThumb ? 'ms-cover-thumb' : 'ms-cover-card'} ${className}`}
      style={{
        position: 'relative',
        background: bg,
        color: text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: isParty ? '50%' : '14px',
        aspectRatio: '1 / 1',
        flex: 'none',
        containerType: 'inline-size',
        boxShadow: isParty ? '0 4px 12px rgba(0, 0, 0, 0.4), inset 0 0 0 2px rgba(0,0,0,0.18)' : '0 2px 8px rgba(0, 0, 0, 0.22)',
        padding: isHero ? '0 14px' : isThumb ? '0 2px' : '0 6px',
        userSelect: 'none',
        overflow: 'hidden',
      }}
      title={`${label} · ${speciality || 'Music'}`}
    >
      <span
        className="ms-cover-genre-label"
        style={{
          position: 'relative',
          zIndex: 3,
          display: 'inline-block',
          maxWidth: isHero ? '82%' : '90%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: "Arial, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
          fontWeight,
          fontSize: fontClamp,
          letterSpacing: fontLetterSpacing,
          lineHeight: 1,
          textTransform: 'lowercase',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export function Cover({
  id,
  alt = '',
  className = '',
  genre,
  speciality,
  title,
}: {
  id: string
  alt?: string
  className?: string
  genre?: string
  speciality?: string
  title?: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setAttempt(0)
    setFailed(false)
  }, [id])
  if (!id || failed || (!id.startsWith('pc_') && missingCovers.has(id))) {
    return <PlaceholderCover alt={alt} className={className} genre={genre} speciality={speciality} title={title} />
  }
  const base = coverUrl(id)
  const src = attempt > 0 ? `${base}${base.includes('?') ? '&' : '?'}retry=${attempt}` : base
  return (
    <img
      className={`ms-cover ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (attempt < 2) {
          window.setTimeout(() => setAttempt((a) => a + 1), 600 * (attempt + 1))
        } else {
          if (!id.startsWith('pc_')) missingCovers.add(id)
          setFailed(true)
        }
      }}
    />
  )
}

/** The round button on a cover: plays this, and shows pause while this is what's playing. */
export function PlayCircle({ title, active, playing, loading, onStart, onToggle }: {
  title: string
  active: boolean
  playing: boolean
  loading: boolean
  onStart: () => void
  onToggle: () => void
}) {
  const showPause = active && playing
  return (
    <button
      type="button"
      className={`ms-card-play${active ? ' active' : ''}`}
      aria-label={`${showPause ? 'Pause' : 'Play'} ${title}`}
      onClick={(e) => { e.stopPropagation(); if (active) onToggle(); else onStart() }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {active && loading ? <span className="ms-spinner" /> : <Icon name={showPause ? 'pause' : 'play_arrow'} fill size={24} />}
    </button>
  )
}

/**
 * Right-click with a mouse, or a hold on a touch screen, both call onHold(x, y), once. Android's WebView ends a
 * ~400 ms hold with pointercancel + contextmenu (measured on the Xiaomi 14), so contextmenu is what opens it there;
 * the 500 ms timer covers touch browsers that don't send one. The click that ends a hold is swallowed. Spread per
 * element: `const press = useLongPress()` then `<div {...press((x, y) => …)}>`. A scroll cancels the hold.
 */
export function useLongPress() {
  const timer = useRef(0)
  const held = useRef(false)
  const touch = useRef(false)
  const stop = () => window.clearTimeout(timer.current)
  return (onHold: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      touch.current = e.pointerType === 'touch'
      held.current = false
      stop()
      if (!touch.current) return
      const { clientX: x, clientY: y } = e
      timer.current = window.setTimeout(() => {
        if (held.current) return
        held.current = true
        navigator.vibrate?.(10)
        onHold(x, y)
      }, 500)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onClickCapture: (e: React.MouseEvent) => {
      if (!held.current) return
      held.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      stop()
      if (touch.current) {
        if (held.current) return
        held.current = true
        navigator.vibrate?.(10)
      }
      onHold(e.clientX, e.clientY)
    },
  })
}

export interface MenuItem {
  label: string
  icon?: string
  checked?: boolean
  divider?: boolean
  danger?: boolean
  /** A small section label, not a choice. */
  heading?: boolean
  onSelect?: () => void
}

/** A popup menu at a screen point, kept inside the window. Esc or a click outside closes it. */
export function Menu({ x, y, items, onClose, compact }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /** Dense pointer rows, with the checked row as a tinted pill. */
  compact?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, '--origin': 'top' } as React.CSSProperties & { left: number; top: number })
  useExitCopy(scrim, 83)

  // the first row takes focus on open, which is what lights it up on the reference
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.ms-menu-item')?.focus({ preventScroll: true }) }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // measured while it's scaling open, so use the layout size rather than the animated box
    const height = el.offsetHeight
    const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top,
      '--origin': top < y ? 'bottom' : 'top',
    } as React.CSSProperties & { left: number; top: number })
  }, [x, y])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  // Android's back gesture closes the menu before it moves the page
  useEffect(() => onPhoneBack(() => { onClose(); return true }), [onClose])

  // drawn on the page body: a card with content-visibility clips anything fixed inside it, so a menu opened from a
  // song card was invisible until its closing copy (already on the body) flashed
  return createPortal(
    <div className="ms-menu-scrim" ref={scrim} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div className={`ms-menu${compact ? ' compact' : ''}`} role="menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
        {items.map((item, i) => item.heading ? (
          <div key={`h${i}`} className="ms-menu-heading" role="presentation">{item.label}</div>
        ) : (
          <button
            type="button"
            key={`${i}-${item.label}`}
            role="menuitem"
            className={`ms-menu-item${item.checked ? ' checked' : ''}${item.divider ? ' divider' : ''}${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect?.()
            }}
          >
            {item.icon && <Icon name={item.icon} size={20} />}
            <span>{item.label}</span>
            {item.checked && <Icon name="check" size={20} />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

export function Dialog({ title, onClose, children, footer, wide, headerAction }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  headerAction?: ReactNode
}) {
  const scrim = useRef<HTMLDivElement>(null)
  useExitCopy(scrim, 150)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  useEffect(() => onPhoneBack(() => { onClose(); return true }), [onClose])
  // on the page body, for the same reason as Menu
  return createPortal(
    <div className="ms-scrim" ref={scrim} onClick={onClose}>
      <div className={`ms-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="ms-dialog-head">
          <h2>{title}</h2>
          {headerAction ?? (
            <button
              type="button"
              className="ms-btn text small"
              onClick={onClose}
              aria-label="Close"
              style={{ minWidth: 32, padding: '4px 8px', borderRadius: '50%' }}
            >
              <Icon name="close" size={20} />
            </button>
          )}
        </header>
        <div className="ms-dialog-body">{children}</div>
        {footer && <footer className="ms-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ms-chip${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  )
}

/** Page title bar: back on the left, centred title, actions on the right. */
export function TopBar({ title, back, actions }: { title?: string; back?: () => void; actions?: ReactNode }) {
  return (
    <div className="ms-topbar">
      <div className="ms-topbar-side">{back && <IconButton icon="arrow_back" label="Back" filled onClick={back} />}</div>
      <div className="ms-topbar-title">{title}</div>
      <div className="ms-topbar-side end">{actions}</div>
    </div>
  )
}

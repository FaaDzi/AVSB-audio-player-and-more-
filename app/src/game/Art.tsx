/**
 * Custom Jackbox-style SVG illustrations and vector components.
 * Zero generic Unicode emojis — everything is drawn with thick comic outlines,
 * tilted angles, and flat vibrant colors matching the IEM Dream Bracket GDD.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sfx } from '../audio/sfx'
import type { FlavourId } from '../prefs/types'
import { playFireWipe, wipeStyleFor } from './fireWipe'
import { VsSpeedLines } from './VsSpeedLines'
import {
  FIRE_WING_GOLD,
  FIRE_WING_WHITE,
  LASER_CRESCENT_CYAN,
  LASER_CRESCENT_WHITE,
  WATER_CURL_DARK,
  WATER_CURL_LIGHT,
} from './transitionArtPaths'

export type GearKind = 'iems' | 'tws' | 'headphones'
export type GearMode = GearKind | 'split'

function readGearDataset(): { gear: GearMode; gearA: GearKind; gearB: GearKind } {
  if (typeof document === 'undefined') {
    return { gear: 'iems', gearA: 'iems', gearB: 'iems' }
  }
  const d = document.documentElement.dataset
  const raw = d.gear
  const toKind = (v?: string): GearKind => (v === 'tws' || v === 'headphones' ? v : 'iems')
  if (raw === 'split') {
    return {
      gear: 'split',
      gearA: toKind(d.gearA),
      gearB: toKind(d.gearB),
    }
  }
  const k = toKind(raw)
  return { gear: k, gearA: k, gearB: k }
}

/** Reactive hook that tracks <html data-gear / data-gear-a / data-gear-b> set by App.tsx. */
export function useGearTheme() {
  const [state, setState] = useState(readGearDataset)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const sync = () => setState(readGearDataset())
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-gear', 'data-gear-a', 'data-gear-b'],
    })
    return () => obs.disconnect()
  }, [])
  return state
}

/** "DJ Tips" — a pair of cartoon silicone ear tips holding a broadcast microphone (GDD Section 9). */
export function DjTipsSvg(props: { mood?: 'normal' | 'hype' | 'roast' | 'crown'; size?: number }) {
  const size = props.size ?? 72
  const mood = props.mood ?? 'normal'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" className="dj-tips-svg">
      {/* Left Ear Tip (Teal Dome) */}
      <g transform="rotate(-10 34 55)">
        <path
          d="M14 58 C14 34, 52 34, 52 58 C52 67, 45 72, 33 72 C21 72, 14 67, 14 58 Z"
          fill="#00F0B5"
          stroke="#110B18"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        {/* Stem */}
        <rect x="25" y="69" width="16" height="14" rx="4" fill="#1E182B" stroke="#110B18" strokeWidth="4" />
        {/* Bore hole */}
        <ellipse cx="33" cy="39" rx="7" ry="3.5" fill="#110B18" />
        {/* Eyes */}
        <circle cx="26" cy="54" r="5" fill="#FFF" stroke="#110B18" strokeWidth="3" />
        <circle cx="27" cy="54" r="2.2" fill="#110B18" />
        <circle cx="40" cy="54" r="5" fill="#FFF" stroke="#110B18" strokeWidth="3" />
        <circle cx="41" cy="54" r="2.2" fill="#110B18" />
        {/* Eyebrows based on mood */}
        {mood === 'roast' ? (
          <>
            <path d="M21 46 L30 49" stroke="#110B18" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M45 46 L36 49" stroke="#110B18" strokeWidth="3.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M21 47 Q26 44 30 47" stroke="#110B18" strokeWidth="3" strokeLinecap="round" />
            <path d="M36 47 Q40 44 45 47" stroke="#110B18" strokeWidth="3" strokeLinecap="round" />
          </>
        )}
        {/* Mouth */}
        {mood === 'hype' || mood === 'crown' ? (
          <path d="M27 61 Q33 68 39 61 Z" fill="#FF2A85" stroke="#110B18" strokeWidth="2.8" />
        ) : (
          <path d="M28 62 Q33 66 38 62" stroke="#110B18" strokeWidth="3" strokeLinecap="round" />
        )}
      </g>

      {/* Right Ear Tip (Hot Pink Dome) */}
      <g transform="rotate(9 68 58)">
        <path
          d="M48 60 C48 36, 86 36, 86 60 C86 69, 79 74, 67 74 C55 74, 48 69, 48 60 Z"
          fill="#FF2A85"
          stroke="#110B18"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <rect x="59" y="71" width="16" height="14" rx="4" fill="#1E182B" stroke="#110B18" strokeWidth="4" />
        <ellipse cx="67" cy="41" rx="7" ry="3.5" fill="#110B18" />
        {/* Shades / Eyes */}
        <circle cx="60" cy="56" r="5" fill="#FFF" stroke="#110B18" strokeWidth="3" />
        <circle cx="60" cy="56" r="2.2" fill="#110B18" />
        <circle cx="74" cy="56" r="5" fill="#FFF" stroke="#110B18" strokeWidth="3" />
        <circle cx="74" cy="56" r="2.2" fill="#110B18" />
        <path d="M61 64 Q67 69 73 64" stroke="#110B18" strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* Crown when mood === 'crown' */}
      {mood === 'crown' && (
        <path
          d="M20 28 L25 14 L34 22 L44 11 L53 22 L62 14 L65 28 Z"
          fill="#FFE600"
          stroke="#110B18"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      )}

      {/* Broadcast Microphone held in front */}
      <g transform="rotate(-18 52 78)">
        <rect x="46" y="70" width="10" height="22" rx="4" fill="#3B334A" stroke="#110B18" strokeWidth="3.5" />
        <circle cx="51" cy="65" r="9" fill="#FFE600" stroke="#110B18" strokeWidth="3.5" />
        <path d="M44 65 H58 M51 57 V73" stroke="#110B18" strokeWidth="2" />
      </g>
    </svg>
  )
}

/** Giant Cartoon Record Player that spins in the Main Menu background (GDD Section 3). */
export function SpinningTurntableSvg() {
  return (
    <svg className="turntable-bg-svg" viewBox="0 0 500 500" fill="none" aria-hidden="true">
      {/* Turntable Plinth (Tilted Cartoon Box) */}
      <rect
        x="35"
        y="40"
        width="430"
        height="420"
        rx="36"
        transform="rotate(-3 250 250)"
        fill="#24173D"
        stroke="#0D0814"
        strokeWidth="12"
      />
      <rect
        x="50"
        y="52"
        width="400"
        height="395"
        rx="28"
        transform="rotate(-3 250 250)"
        fill="#311F54"
        stroke="#0D0814"
        strokeWidth="6"
      />

      {/* Spinning Vinyl Disc */}
      <g className="vinyl-spin-group">
        <circle cx="235" cy="248" r="168" fill="#120E1A" stroke="#0D0814" strokeWidth="10" />
        {/* Grooves */}
        <circle cx="235" cy="248" r="142" stroke="#292138" strokeWidth="3" strokeDasharray="35 18" />
        <circle cx="235" cy="248" r="116" stroke="#292138" strokeWidth="3" strokeDasharray="24 14" />
        <circle cx="235" cy="248" r="90" stroke="#292138" strokeWidth="3" strokeDasharray="40 20" />
        {/* Vinyl Sheen */}
        <path d="M235 248 L120 125 A168 168 0 0 1 180 88 Z" fill="rgba(255,255,255,0.06)" />
        <path d="M235 248 L350 370 A168 168 0 0 1 290 408 Z" fill="rgba(255,255,255,0.06)" />
        {/* Center Label */}
        <circle cx="235" cy="248" r="54" fill="#FF2A85" stroke="#0D0814" strokeWidth="8" />
        <path d="M195 235 Q235 210 275 235" stroke="#FFE600" strokeWidth="6" strokeLinecap="round" />
        <circle cx="235" cy="248" r="12" fill="#FFE600" stroke="#0D0814" strokeWidth="6" />
      </g>

      {/* Pitch Slider & Knobs */}
      <circle cx="88" cy="396" r="18" fill="#00F0B5" stroke="#0D0814" strokeWidth="6" />
      <circle cx="136" cy="400" r="14" fill="#FFE600" stroke="#0D0814" strokeWidth="6" />

      {/* Cartoon Tonearm */}
      <g className="tonearm-wobble">
        <circle cx="405" cy="112" r="32" fill="#00F0B5" stroke="#0D0814" strokeWidth="8" />
        <circle cx="405" cy="112" r="14" fill="#120E1A" stroke="#0D0814" strokeWidth="5" />
        <path
          d="M405 112 L385 280 L330 330"
          stroke="#FFE600"
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="308"
          y="318"
          width="34"
          height="22"
          rx="5"
          transform="rotate(-38 325 329)"
          fill="#FF2A85"
          stroke="#0D0814"
          strokeWidth="6"
        />
      </g>
    </svg>
  )
}

/** Paper Clip SVG for the 7-clip progress strip along the top of the Questionnaire (GDD Section 4). */
export function PaperClipSvg(props: { active: boolean; done: boolean; index: number }) {
  const color = props.active ? '#FFE600' : props.done ? '#00F0B5' : '#8C829E'
  return (
    <div className={`paperclip-item ${props.active ? 'active' : ''} ${props.done ? 'done' : ''}`} title={`Question ${props.index + 1} of 7`}>
      <svg width="28" height="52" viewBox="0 0 28 52" fill="none" aria-hidden="true">
        <path
          d="M8 38 V14 C8 7 20 7 20 14 V40 C20 46 6 46 6 40 V18 C6 14 14 14 14 18 V35"
          stroke="#110B18"
          strokeWidth="6.5"
          strokeLinecap="round"
        />
        <path
          d="M8 38 V14 C8 7 20 7 20 14 V40 C20 46 6 46 6 40 V18 C6 14 14 14 14 18 V35"
          stroke={color}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="paperclip-num">{props.index + 1}</span>
    </div>
  )
}

/** Five illustrated flavour cards for Sheet 6 of the Paper Questionnaire (GDD Section 4). */
export function FlavourIllustration(props: { flavour: FlavourId }) {
  switch (props.flavour) {
    case 'bass':
      return (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" aria-hidden="true">
          {/* Giant Sub-Woofer Cone with Shockwaves */}
          <circle cx="32" cy="27" r="21" fill="#FF2A85" stroke="#110B18" strokeWidth="4" />
          <circle cx="32" cy="27" r="12" fill="#FFE600" stroke="#110B18" strokeWidth="3.5" />
          <circle cx="32" cy="27" r="5" fill="#110B18" />
          <path d="M6 14 Q2 27 6 40" stroke="#00F0B5" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M58 14 Q62 27 58 40" stroke="#00F0B5" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      )
    case 'warm':
      return (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" aria-hidden="true">
          {/* Glowing Vacuum Tube / Warm Mug Wave */}
          <path d="M10 34 C20 20, 44 20, 54 34" stroke="#FF9F1C" strokeWidth="6" strokeLinecap="round" />
          <path d="M14 42 C24 30, 40 30, 50 42" stroke="#FFE600" strokeWidth="5" strokeLinecap="round" />
          <circle cx="32" cy="18" r="9" fill="#FF9F1C" stroke="#110B18" strokeWidth="3.5" />
        </svg>
      )
    case 'neutral':
      return (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" aria-hidden="true">
          {/* Precision Studio Balance Scale / Flat Target Line */}
          <rect x="8" y="14" width="48" height="26" rx="6" fill="#1E182B" stroke="#110B18" strokeWidth="3.5" />
          <path d="M14 27 H50" stroke="#00F0B5" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="32" cy="27" r="5" fill="#FFE600" stroke="#110B18" strokeWidth="3" />
        </svg>
      )
    case 'bright':
      return (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" aria-hidden="true">
          {/* Electric Spark / Prism Starburst */}
          <path
            d="M32 5 L38 20 L54 18 L42 29 L48 45 L32 36 L16 45 L22 29 L10 18 L26 20 Z"
            fill="#00E5FF"
            stroke="#110B18"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <circle cx="32" cy="27" r="5" fill="#FFF" />
        </svg>
      )
    case 'vshape':
      return (
        <svg width="64" height="54" viewBox="0 0 64 54" fill="none" aria-hidden="true">
          {/* Bold V-Curve Rollercoaster */}
          <path
            d="M8 12 L32 42 L56 12"
            stroke="#FFE600"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 12 L32 42 L56 12"
            stroke="#FF2A85"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
  }
}

/** Mystery Contender Silhouette for Blind Match Cards — adapts to IEMs, TWS earbuds, and Over-Ear Headphones. */
export function MysteryContenderSvg(props: { side: 'A' | 'B'; size?: number; gear?: GearKind }) {
  const theme = useGearTheme()
  const kind = props.gear ?? (props.side === 'A' ? theme.gearA : theme.gearB)
  // the corner's colour follows the bracket's palette (styles/gear.css)
  const accent = props.side === 'A' ? 'var(--corner-a, #00F0B5)' : 'var(--corner-b, #FF2A85)'
  const sz = props.size ?? 110
  return (
    <svg width={sz} height={sz} viewBox="0 0 120 120" fill="none" aria-hidden="true" className={`mystery-contender-svg gear-${kind}`}>
      {/* Organic Wobbly Backplate */}
      <path
        d="M22 30 C35 12, 88 10, 98 32 C110 55, 104 92, 84 102 C62 112, 26 108, 18 86 C10 64, 12 45, 22 30 Z"
        style={{ fill: 'var(--bg-card, #191229)', stroke: accent }}
        strokeWidth="5"
      />
      {kind === 'headphones' ? (
        <g>
          {/* Over-Ear Headband Arch */}
          <path
            d="M32 58 C32 26, 88 26, 88 58"
            style={{ stroke: accent }}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M32 58 C32 26, 88 26, 88 58"
            stroke="#110B18"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.35"
          />
          {/* Left & Right Cushioned Earcups */}
          <rect
            x="22"
            y="52"
            width="20"
            height="34"
            rx="10"
            transform="rotate(-8 32 69)"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.5"
          />
          <rect
            x="78"
            y="52"
            width="20"
            height="34"
            rx="10"
            transform="rotate(8 88 69)"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.5"
          />
          {/* Central Mystery Coin Badge */}
          <circle cx="60" cy="68" r="19" style={{ fill: accent }} stroke="#110B18" strokeWidth="4.5" />
          <text
            x="60"
            y="78"
            textAnchor="middle"
            fill="#110B18"
            fontFamily="Fredoka, sans-serif"
            fontWeight="900"
            fontSize="30"
          >
            ?
          </text>
        </g>
      ) : kind === 'tws' ? (
        <g>
          {/* Wireless Signal Waves */}
          <path
            d="M84 30 C92 36, 94 48, 88 56"
            style={{ stroke: accent }}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M92 24 C102 33, 105 50, 96 62"
            style={{ stroke: accent }}
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.65"
          />
          {/* Charging Stem */}
          <rect
            x="42"
            y="64"
            width="15"
            height="30"
            rx="7.5"
            transform="rotate(18 49 79)"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.5"
          />
          {/* Acoustic Ear-Tip Dome */}
          <ellipse
            cx="77"
            cy="55"
            rx="10"
            ry="12"
            transform="rotate(-12 77 55)"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.5"
          />
          {/* TWS Earbud Pod Head */}
          <path
            d="M34 50 C34 31, 74 29, 76 50 C78 67, 62 76, 46 74 C36 72, 34 62, 34 50 Z"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.8"
          />
          <text
            x="55"
            y="63"
            textAnchor="middle"
            fill="#110B18"
            fontFamily="Fredoka, sans-serif"
            fontWeight="900"
            fontSize="31"
          >
            ?
          </text>
        </g>
      ) : (
        <g>
          {/* Braided Ear-Hook Wire Arc */}
          <path
            d="M46 32 C38 18, 66 14, 76 26"
            style={{ stroke: accent }}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          {/* Acoustic Nozzle & Silicone Tip */}
          <path
            d="M74 58 L90 66 C94 68, 92 78, 86 78 L70 72 Z"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="4.5"
            strokeLinejoin="round"
          />
          {/* Custom IEM Shell Silhouette */}
          <path
            d="M34 46 C34 26, 76 24, 82 48 C86 66, 70 88, 52 86 C36 84, 34 66, 34 46 Z"
            style={{ fill: accent }}
            stroke="#110B18"
            strokeWidth="5"
          />
          {/* Question Mark */}
          <text
            x="58"
            y="68"
            textAnchor="middle"
            fill="#110B18"
            fontFamily="Fredoka, sans-serif"
            fontWeight="900"
            fontSize="35"
          >
            ?
          </text>
        </g>
      )}
    </svg>
  )
}

/**
 * Transition-Matched VS Emblem for Tale of the Tape, Quick Match & 1v1 Clash.
 * Uses the exact traced 2D cel-shaded vector contours from public/fx (fire-2, laser-2, water-1/2).
 */
export function FlameVsBadgeSvg(props: { size?: number; gear?: GearMode }) {
  const theme = useGearTheme()
  const mode = props.gear ?? theme.gear
  const sz = props.size ?? 88

  return (
    <svg width={sz} height={sz} viewBox="0 0 140 140" fill="none" aria-hidden="true" className={`flame-vs-svg gear-${mode}`}>
      {mode === 'tws' ? (
        <g>
          {/* High-Voltage Cyan Plasma Core Halo */}
          <circle cx="70" cy="70" r="54" fill="rgba(0, 180, 255, 0.25)" />
          <circle cx="70" cy="70" r="38" fill="#04182E" stroke="#3EE6FF" strokeWidth="3.5" />
          {/* Diagonal Laser Slash Rays */}
          <path d="M6 20 L62 60 L50 68 L134 120 L78 80 L90 72 Z" fill="#3EE6FF" />
          <path d="M132 22 L80 62 L90 70 L8 118 L60 78 L50 70 Z" fill="#A8FF3E" opacity="0.9" />
          {/* Traced Plasma Crescent Arcs from fx/laser-2.webm (f7) */}
          <g transform="translate(2, 16) scale(0.105)">
            <path d={LASER_CRESCENT_CYAN} fill="#00D2FF" fillRule="evenodd" />
            <path d={LASER_CRESCENT_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
          <g transform="translate(138, 124) scale(-0.105, -0.105)">
            <path d={LASER_CRESCENT_CYAN} fill="#3EE6FF" fillRule="evenodd" />
            <path d={LASER_CRESCENT_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
        </g>
      ) : mode === 'headphones' ? (
        <g>
          {/* Molten Acoustic Wave Halo */}
          <circle cx="70" cy="70" r="54" fill="rgba(244, 137, 36, 0.24)" />
          <circle cx="70" cy="70" r="40" fill="#230D04" stroke="#DA731E" strokeWidth="3.5" />
          {/* Traced Curling Liquid Wave Crest from fx/water-1.webm (f5) — Upper Left */}
          <g transform="translate(6, 8) scale(0.112)">
            <path d={WATER_CURL_DARK} fill="#DA731E" fillRule="evenodd" />
            <path d={WATER_CURL_LIGHT} fill="#F48924" fillRule="evenodd" />
          </g>
          {/* Traced Curling Liquid Wave Crest — Lower Right Vortex */}
          <g transform="translate(134, 132) scale(-0.112, -0.112)">
            <path d={WATER_CURL_DARK} fill="#DA731E" fillRule="evenodd" />
            <path d={WATER_CURL_LIGHT} fill="#F48924" fillRule="evenodd" />
          </g>
          <circle cx="70" cy="70" r="28" fill="#F48924" stroke="#180802" strokeWidth="3.5" />
        </g>
      ) : mode === 'split' ? (
        <g>
          <circle cx="70" cy="70" r="42" fill="#160B28" stroke="#110B18" strokeWidth="4" />
          {/* Left Wing: Corner A */}
          <g transform="translate(4, 10) scale(0.115)">
            <path d={FIRE_WING_GOLD} style={{ fill: 'var(--corner-a, #00F0B5)' }} fillRule="evenodd" />
            <path d={FIRE_WING_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
          {/* Right Wing: Corner B */}
          <g transform="translate(136, 130) scale(-0.115, -0.115)">
            <path d={FIRE_WING_GOLD} style={{ fill: 'var(--corner-b, #FF2A85)' }} fillRule="evenodd" />
            <path d={FIRE_WING_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
        </g>
      ) : (
        <g>
          {/* IEM Cel-Shaded Golden-Amber & White Anime Fire Vortex (Traced from fx/fire-2.webm f5) */}
          <circle cx="70" cy="70" r="54" fill="rgba(244, 186, 51, 0.24)" />
          <circle cx="70" cy="70" r="39" fill="#240E05" stroke="#F4BA33" strokeWidth="3.5" />
          {/* Upper-Left Sweeping Anime Fire Wing (fx/fire-2.webm f5) */}
          <g className="flame-tongue-outer" transform="translate(4, 8) scale(0.118)">
            <path d={FIRE_WING_GOLD} fill="#F4BA33" fillRule="evenodd" />
            <path d={FIRE_WING_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
          {/* Lower-Right Sweeping Anime Fire Wing (180° Vortex Twin) */}
          <g className="flame-tongue-mid" transform="translate(136, 132) scale(-0.118, -0.118)">
            <path d={FIRE_WING_GOLD} fill="#F4BA33" fillRule="evenodd" />
            <path d={FIRE_WING_WHITE} fill="#FFFFFF" fillRule="evenodd" />
          </g>
        </g>
      )}
      {/* Tilted 3D VS Text */}
      <g transform="rotate(-7 70 74)">
        <text
          x="74"
          y="87"
          textAnchor="middle"
          fill="#110B18"
          stroke="#110B18"
          strokeWidth="6"
          strokeLinejoin="round"
          fontFamily="Fredoka, sans-serif"
          fontWeight="900"
          fontSize="44"
        >
          VS
        </text>
        <text
          x="69"
          y="83"
          textAnchor="middle"
          fill="#FFFFFF"
          stroke="#110B18"
          strokeWidth="4"
          strokeLinejoin="round"
          fontFamily="Fredoka, sans-serif"
          fontWeight="900"
          fontSize="44"
        >
          VS
        </text>
      </g>
    </svg>
  )
}

/** Cartoon Championship Trophy Crown for the Grand Final Pedestal in BracketView */
export function TrophyPedestalSvg(props: { size?: number }) {
  const sz = props.size ?? 68
  return (
    <svg width={sz} height={sz} viewBox="0 0 100 100" fill="none" aria-hidden="true" className="trophy-pedestal-svg">
      {/* Glowing Starburst Behind Cup */}
      <circle cx="50" cy="46" r="38" fill="rgba(255, 230, 0, 0.16)" />
      {/* Handles */}
      <path
        d="M26 30 C10 30, 12 54, 28 54"
        stroke="#FFE600"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M74 30 C90 30, 88 54, 72 54"
        stroke="#FFE600"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Cup Body */}
      <path
        d="M24 22 H76 L68 58 C66 68, 34 68, 32 58 Z"
        fill="#FFE600"
        stroke="#110B18"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      {/* Stem & Base */}
      <rect x="44" y="64" width="12" height="14" fill="#FF9F1C" stroke="#110B18" strokeWidth="4" />
      <rect x="28" y="76" width="44" height="14" rx="5" fill="#2A1B47" stroke="#110B18" strokeWidth="4.5" />
      {/* Crown Star on Cup */}
      <path
        d="M50 30 L53 39 L62 39 L55 44 L58 53 L50 47 L42 53 L45 44 L38 39 L47 39 Z"
        fill="#FF2A85"
        stroke="#110B18"
        strokeWidth="2.5"
      />
    </svg>
  )
}

/** Fluid Energy Crest placed on the active NEXT UP match box in the bracket — adapts to gear kind. */
export function MatchFlameCrestSvg() {
  const { gear } = useGearTheme()
  const outer = gear === 'tws' ? '#00B4FF' : gear === 'headphones' ? '#D96B0C' : '#FF7A00'
  const mid = gear === 'tws' ? '#3EE6FF' : gear === 'headphones' ? '#FF8C1D' : '#FBB62D'
  const core = gear === 'tws' ? '#FFFFFF' : gear === 'headphones' ? '#FFD23F' : '#FFFFFF'
  return (
    <svg className="mbox-flame-crest" viewBox="0 0 240 28" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 28 C12 10, 28 2, 42 18 C54 4, 76 0, 92 18 C108 2, 132 0, 148 18 C164 2, 188 4, 202 18 C216 4, 230 10, 240 28 Z"
        fill={outer}
      />
      <path
        d="M8 28 C20 14, 36 6, 52 22 C68 8, 88 4, 106 22 C122 6, 144 6, 160 22 C176 8, 196 8, 212 22 C222 12, 230 16, 236 28 Z"
        fill={mid}
      />
      <path
        d="M18 28 C30 18, 44 12, 58 25 C76 12, 94 10, 112 25 C130 10, 148 12, 166 25 C182 14, 198 14, 218 28 Z"
        fill={core}
      />
    </svg>
  )
}

/**
 * Full-Screen Bracket-to-1v1 Clash Screen.
 * Left Contender slams into the top-left corner, Right Contender slams into the bottom-right corner,
 * transition-matched fluid energy (fire / laser / molten wave) surges across the diagonal seam,
 * and the gear-specific 3D VS badge commands center stage.
 */
export function VsFlameTransition(props: {
  leftTitle: string
  leftSub: string
  rightTitle: string
  rightSub: string
  roundLabel: string
  stakesLabel?: string
  /** Settles when the match's first song is decoded: until then the intro is the loading screen. */
  prepare?: Promise<unknown>
  onDone: () => void
}) {
  const { gear, gearA, gearB } = useGearTheme()
  /** The intro is drawn once the fire-bomb wipe covers the screen it replaces. */
  const [shown, setShown] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [entered, setEntered] = useState(false)
  const [ready, setReady] = useState(!props.prepare)
  /** Tapped while the song was still loading: start as soon as it's ready. */
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let alive = true
    props.prepare?.finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    playFireWipe(
      () => {
        setShown(true)
        sfx.playFlameClash(0.8)
      },
      0,
      wipeStyleFor(),
    )
  }, [])

  const go = () => {
    setExiting(true)
    sfx.playFlameIgnite(0.85)
    // the match screen takes over under the second burst; it starts part-way in so the tap bites at once
    playFireWipe(() => props.onDone(), 0.3, wipeStyleFor())
  }

  const proceed = () => {
    if (exiting || !shown) return
    if (ready) go()
    else setPending(true)
  }

  useEffect(() => {
    if (ready && pending && !exiting) go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pending])

  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setEntered(true), 650)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        proceed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, exiting, ready])

  // until the burst covers the old screen: an invisible layer that only stops double clicks
  const node = !shown ? (
    <div className="vs-flame-transition-overlay hidden" aria-hidden="true" />
  ) : (
    <div
      className={`vs-flame-transition-overlay gear-${gear} ${exiting ? 'exiting' : ''} ${!entered ? 'entering' : ''}`}
      onClick={proceed}
      role="button"
      tabIndex={0}
      title="Click anywhere or press Enter to start the listening duel"
    >
      {/* Speed lines in each kind's colours; a cross-kind match splits on the diagonal */}
      <VsSpeedLines gearA={gearA} gearB={gearB} />

      {/* Upper-Left Fighter Banner (Corner A) */}
      <div className="vs-clash-half left-half">
        <div className="vs-fighter-banner left-fighter">
          <MysteryContenderSvg side="A" gear={gearA} size={104} />
          <div className="vs-fighter-text">
            <span className="vs-corner-tag teal">{props.leftSub}</span>
            <h2 className="vs-fighter-title">{props.leftTitle}</h2>
          </div>
        </div>
      </div>

      {/* Lower-Right Fighter Banner (Corner B) */}
      <div className="vs-clash-half right-half">
        <div className="vs-fighter-banner right-fighter">
          <div className="vs-fighter-text right-align">
            <span className="vs-corner-tag pink">{props.rightSub}</span>
            <h2 className="vs-fighter-title">{props.rightTitle}</h2>
          </div>
          <MysteryContenderSvg side="B" gear={gearB} size={104} />
        </div>
      </div>

      {/* Floating Energy Sparks rising from the surge */}
      <div className="vs-ember-field" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={`vs-ember-particle ember-${(i % 5) + 1}`} />
        ))}
      </div>

      {/* Center Stage Slam: Round Kicker + Giant Transition-Matched VS Emblem */}
      <div className="vs-clash-centerpiece">
        <div className="vs-clash-round-pill">{props.roundLabel}</div>
        <div className="vs-clash-emblem-wrap">
          <div className="vs-impact-halo" aria-hidden="true" />
          <FlameVsBadgeSvg size={168} gear={gear} />
        </div>
      </div>

      {/* Bottom-Anchored Action Prompt */}
      <div className="vs-clash-action-hint">
        <span className={`vs-hint-badge ${ready ? '' : 'loading'}`} aria-live="polite">
          {ready ? 'TAP ANYWHERE TO BEGIN' : pending ? 'STARTING AS SOON AS IT LOADS…' : 'LOADING THE TRACK…'}
        </span>
        <span className="vs-hint-sub">{props.stakesLabel ?? 'BLIND 1V1 AUDIO DUEL'}</span>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}




// Compact Circle Profile Indicator:
// Replaces bulky text overflow chips in Now Playing and Player Bar.
// Transparent circle = Raw pure gear sound (no filter, no EQ).
// Colored dot + arc = Reference Target or Imitating Audio Gear with strength %.
// Click: opens scrollable AudioProfileSheet.
// Right-click (PC) / Long-press (Android): 'Copy this EQ', % tuning, or Raw toggle.
import { useState, useRef, useMemo } from 'react'
import { Menu, type MenuItem } from '../ui'
import { useShell } from '../context'
import { useGear } from './gear'
import { useSound } from './soundState'
import { applyProfileItem, setProfileItemStrength, useGearProfile } from './gearProfiles'
import { copyCurrentAimToEq } from './copyEq'
import { AudioProfileSheet } from './AudioProfileSheet'

export function GearCircleIndicator({ size = 32 }: { size?: number }) {
  const { showToast, go, setNowPlaying } = useShell()
  const gear = useGear()
  const sound = useSound()
  const profile = useGearProfile(gear.active)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const pressTimer = useRef<number | null>(null)

  const activeItem = useMemo(() => {
    if (!profile.activeItemId || sound.aim.kind === 'off' || sound.bypass) return null
    return profile.items.find((i) => i.id === profile.activeItemId) ?? null
  }, [profile, sound.aim, sound.bypass])

  const strength = activeItem ? activeItem.strength : 100
  const isRaw = !activeItem

  const handleCopyEq = async () => {
    if (!activeItem) return
    const res = await copyCurrentAimToEq()
    if (res.success) {
      showToast(`Copied ${activeItem.name} (${strength}%) to ${res.presetName}`)
      setMenu(null)
      setNowPlaying(false)
      go({ page: 'settings', section: 'equalizer' })
    } else {
      showToast(res.error || 'Failed to copy EQ')
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      pressTimer.current = window.setTimeout(() => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setMenu({ x: rect.left, y: rect.bottom + 6 })
      }, 500)
    }
  }

  const handlePointerUp = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  // SVG circular arc calculations
  const radius = size / 2 - 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (strength / 100) * circumference

  const menuItems: MenuItem[] = []
  if (activeItem) {
    menuItems.push(
      {
        label: `Active: ${activeItem.name} (${strength}%)`,
        heading: true,
      },
      {
        label: 'Copy this EQ',
        icon: 'content_copy',
        onSelect: handleCopyEq,
      },
      {
        label: 'Set strength to 78%',
        icon: 'tune',
        onSelect: () => {
          setProfileItemStrength(activeItem.id, 78, gear.active)
          showToast(`Set to 78%`)
        },
      },
      {
        label: 'Set strength to 100%',
        icon: 'tune',
        onSelect: () => {
          setProfileItemStrength(activeItem.id, 100, gear.active)
          showToast(`Set to 100%`)
        },
      },
      {
        label: 'Switch to Raw Sound',
        icon: 'hearing_disabled',
        onSelect: () => {
          applyProfileItem(null, gear.active)
          showToast('Switched to Raw Gear sound')
        },
      },
      {
        label: 'Audio Profiles & Targets…',
        icon: 'palette',
        onSelect: () => setSheetOpen(true),
      },
      {
        label: 'Equalizer Settings…',
        icon: 'equalizer',
        onSelect: () => go({ page: 'settings', section: 'equalizer' }),
      },
    )
  } else {
    menuItems.push(
      {
        label: profile.items.length === 0 ? 'Raw audio with no changes' : 'Raw Audio Gear (Pure sound)',
        heading: true,
      },
      {
        label: 'Choose Target or Device to Test…',
        icon: 'palette',
        onSelect: () => setSheetOpen(true),
      },
      {
        label: 'Equalizer & Target Preferences…',
        icon: 'equalizer',
        onSelect: () => go({ page: 'settings', section: 'equalizer' }),
      },
    )
  }

  const tooltipText = isRaw
    ? (profile.items.length === 0
      ? 'Raw audio with no changes · Tap to configure target preferences'
      : 'Raw audio gear (pure sound) · Tap to choose target or device to test')
    : `${activeItem.name} (${strength}%) · Tap to switch or right-click / hold to copy EQ`

  return (
    <>
      <button
        type="button"
        className={`ms-gear-circle-btn${isRaw ? ' raw' : ' active'}`}
        style={{ width: size, height: size }}
        aria-label={isRaw ? (profile.items.length === 0 ? 'Raw audio with no changes' : 'Raw audio gear (pure sound)') : `Hearing ${activeItem.name} (${strength}%)`}
        title={tooltipText}
        onClick={() => setSheetOpen(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ms-gear-circle-svg">
          {/* Base track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill={isRaw ? 'transparent' : activeItem?.color ?? 'var(--accent)'}
            stroke={isRaw ? 'var(--text-dim)' : 'transparent'}
            strokeWidth={1.5}
            className="ms-gear-circle-bg"
          />
          {/* Percentage Progress Ring if target is active and < 100% */}
          {!isRaw && strength < 100 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="ms-gear-circle-arc"
            />
          )}
        </svg>
      </button>

      {sheetOpen && <AudioProfileSheet onClose={() => setSheetOpen(false)} />}

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems} />}
    </>
  )
}


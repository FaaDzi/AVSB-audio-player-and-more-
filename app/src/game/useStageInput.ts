import { useEffect } from 'react'
import { sfx } from '../audio/sfx'
import { toggleAppFullscreen } from '../fit/system'

const REDUCE_MOTION_KEY = 'reduce-motion-v1'

export function isReduceMotionEnabled(): boolean {
  try {
    const v = localStorage.getItem(REDUCE_MOTION_KEY)
    if (v !== null) return v === '1'
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  } catch {
    return false
  }
}

export function setReduceMotionEnabled(on: boolean) {
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('reduce-motion', on)
  }
}

function getNavigableButtons(): HTMLElement[] {
  const modal = document.querySelector<HTMLElement>('.paper-modal-card, .bracket-modal-card')
  const scope =
    modal ??
    document.querySelector<HTMLElement>('.stage-main') ??
    document.querySelector<HTMLElement>('.jackbox-main-menu') ??
    document.body

  const nodes = Array.from(
    scope.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), label.game-btn-primary, summary',
    ),
  )

  return nodes.filter((el) => {
    if (el.offsetParent === null) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 8 && rect.height > 8
  })
}

function getNumberShortcutTargets(): HTMLElement[] {
  const modal = document.querySelector<HTMLElement>('.paper-modal-card')
  if (modal) {
    return Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled)'))
  }
  const selectors = [
    '.menu-sticker-list .menu-sticker-btn:not(:disabled)',
    '.paper-options-grid button:not(:disabled)',
    '.flavour-cards-grid button:not(:disabled)',
    '.paper-feelings-grid button:not(:disabled)',
    '.size-cards-grid button:not(:disabled)',
    '.who-picks-grid button:not(:disabled)',
    '.et-chips button:not(:disabled)',
    '.settings-tab-bar button:not(:disabled)',
  ]
  for (const sel of selectors) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.offsetParent !== null,
    )
    if (found.length > 0) return found
  }
  return []
}

function highlightElement(el: HTMLElement) {
  document.querySelectorAll('[data-kb-focus="true"]').forEach((prev) => {
    prev.removeAttribute('data-kb-focus')
  })
  el.setAttribute('data-kb-focus', 'true')
  el.focus({ preventScroll: false })
  sfx.playPop(0.3)
}

function moveFocusByDirection(dir: 'up' | 'down' | 'left' | 'right') {
  const items = getNavigableButtons()
  if (items.length === 0) return

  const current =
    (document.querySelector<HTMLElement>('[data-kb-focus="true"]') ??
      (document.activeElement as HTMLElement | null)) ||
    null

  if (!current || !items.includes(current)) {
    highlightElement(items[0])
    return
  }

  const curRect = current.getBoundingClientRect()
  const cx = curRect.left + curRect.width / 2
  const cy = curRect.top + curRect.height / 2

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const cand of items) {
    if (cand === current) continue
    const r = cand.getBoundingClientRect()
    const tx = r.left + r.width / 2
    const ty = r.top + r.height / 2
    const dx = tx - cx
    const dy = ty - cy

    if (dir === 'right' && dx <= 6) continue
    if (dir === 'left' && dx >= -6) continue
    if (dir === 'down' && dy <= 6) continue
    if (dir === 'up' && dy >= -6) continue

    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    const score = primary + secondary * 2.4

    if (score < bestScore) {
      bestScore = score
      best = cand
    }
  }

  if (best) {
    highlightElement(best)
  } else {
    // Fallback to linear wrap-around
    const idx = items.indexOf(current)
    const delta = dir === 'down' || dir === 'right' ? 1 : -1
    const nextIdx = (idx + delta + items.length) % items.length
    highlightElement(items[nextIdx])
  }
}

/**
 * Global stage input hook enabling full Keyboard (Arrows, Enter, Esc, 1-9, F11, Backspace Undo)
 * and Gamepad / Controller navigation across all screens.
 */
export function useStageInput(screen: string, onEscape: () => void) {
  useEffect(() => {
    document.body.classList.toggle('reduce-motion', isReduceMotionEnabled())
  }, [])

  // Clear stale focus highlight on screen change and focus default primary item
  useEffect(() => {
    document.querySelectorAll('[data-kb-focus="true"]').forEach((el) => {
      el.removeAttribute('data-kb-focus')
    })
  }, [screen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (e.key === 'F11') {
        e.preventDefault()
        void toggleAppFullscreen()
        return
      }

      if (e.key === 'Escape') {
        if (inInput) {
          target.blur()
          return
        }
        onEscape()
        return
      }

      if (inInput) return
      // the gallery runs its own keys (wheel, type-to-search)
      if (document.querySelector('.gallery-stage')) return

      // Undo shortcut (Backspace or Z) when an undo toast/bar is visible
      if (e.key === 'Backspace' || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) {
        const undoBtn = document.querySelector<HTMLElement>('[data-undo-btn="true"]')
        if (undoBtn) {
          e.preventDefault()
          undoBtn.click()
          return
        }
      }

      // Number keys 1..9 select option cards directly
      if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const numIdx = Number(e.key) - 1
        const targets = getNumberShortcutTargets()
        if (targets[numIdx]) {
          e.preventDefault()
          highlightElement(targets[numIdx])
          targets[numIdx].click()
          return
        }
      }

      // On active match screen while audio is loaded and not yet decided, MatchView handles Left/Right/Space
      const inLiveMatchBooth =
        document.querySelector('.ab-framed-stage') !== null &&
        document.querySelector('.match-reveal-stage') === null

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocusByDirection('up')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocusByDirection('down')
      } else if (e.key === 'ArrowLeft' && !inLiveMatchBooth) {
        e.preventDefault()
        moveFocusByDirection('left')
      } else if (e.key === 'ArrowRight' && !inLiveMatchBooth) {
        e.preventDefault()
        moveFocusByDirection('right')
      } else if (e.key === 'Enter') {
        const focused =
          document.querySelector<HTMLElement>('[data-kb-focus="true"]') ??
          (document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
            ? document.activeElement
            : null)

        if (focused && focused.tagName === 'BUTTON' && !(focused as HTMLButtonElement).disabled) {
          e.preventDefault()
          focused.click()
          return
        }

        // Otherwise click the primary CTA button on screen
        const primaryCta = document.querySelector<HTMLButtonElement>(
          '.paper-stamp-btn:not(:disabled), .game-btn-primary:not(:disabled)',
        )
        if (primaryCta) {
          e.preventDefault()
          primaryCta.click()
        }
      }
    }

    // the mouse takes over from the keyboard: drop the keyboard highlight so only one item looks selected
    const onPointerDown = () => {
      document.querySelectorAll('[data-kb-focus="true"]').forEach((el) => {
        el.removeAttribute('data-kb-focus')
        if (el === document.activeElement) (el as HTMLElement).blur()
      })
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerDown, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerDown)
    }
  }, [onEscape])

  // Gamepad / Controller polling (D-pad, Left Stick, A = Enter, B = Escape)
  useEffect(() => {
    let rafId = 0
    let lastMove = 0
    let prevA = false
    let prevB = false

    const pollGamepad = (now: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : []
      const pad = pads[0] || pads[1] || pads[2] || pads[3]
      if (pad) {
        const axX = pad.axes[0] ?? 0
        const axY = pad.axes[1] ?? 0
        const up = pad.buttons[12]?.pressed || axY < -0.55
        const down = pad.buttons[13]?.pressed || axY > 0.55
        const left = pad.buttons[14]?.pressed || axX < -0.55
        const right = pad.buttons[15]?.pressed || axX > 0.55

        if (now - lastMove > 190) {
          if (up) {
            moveFocusByDirection('up')
            lastMove = now
          } else if (down) {
            moveFocusByDirection('down')
            lastMove = now
          } else if (left) {
            moveFocusByDirection('left')
            lastMove = now
          } else if (right) {
            moveFocusByDirection('right')
            lastMove = now
          }
        }

        const btnA = Boolean(pad.buttons[0]?.pressed)
        const btnB = Boolean(pad.buttons[1]?.pressed)

        if (btnA && !prevA) {
          const focused =
            document.querySelector<HTMLElement>('[data-kb-focus="true"]') ??
            document.querySelector<HTMLElement>(
              '.paper-stamp-btn:not(:disabled), .game-btn-primary:not(:disabled)',
            )
          focused?.click()
        }
        if (btnB && !prevB) {
          onEscape()
        }
        prevA = btnA
        prevB = btnB
      }
      rafId = requestAnimationFrame(pollGamepad)
    }

    rafId = requestAnimationFrame(pollGamepad)
    return () => cancelAnimationFrame(rafId)
  }, [onEscape])
}


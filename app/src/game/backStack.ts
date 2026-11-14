import { useEffect, useRef } from 'react'

/**
 * One-step-back actions. A screen registers "what Back means here" while it's showing
 * (previous questionnaire sheet, previous setup step, match -> bracket, …); the phone's
 * back gesture and the Esc key run the most recent one, and only fall back to the main
 * menu when nothing is registered.
 */
const stack: { current: () => void }[] = []

/** Run the innermost back action; false if there is none. */
export function runBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.current()
  return true
}

/** Register `action` as this screen's Back while `active` is true. */
export function useBackAction(active: boolean, action: () => void) {
  const ref = useRef(action)
  ref.current = action
  useEffect(() => {
    if (!active) return
    const entry = { current: () => ref.current() }
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}

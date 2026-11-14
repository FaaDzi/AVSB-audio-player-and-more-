/**
 * Android's back gesture (§70 B2). Screens that hold their own "back" (Settings' page → list) register a handler; the
 * newest one that takes it wins, and Shell's fallback goes last: close Now Playing, go up the page stack, go Home, then leave.
 */
const backHandlers: (() => boolean)[] = []
export function onPhoneBack(handler: () => boolean) {
  backHandlers.push(handler)
  return () => {
    const i = backHandlers.lastIndexOf(handler)
    if (i >= 0) backHandlers.splice(i, 1)
  }
}
export const runPhoneBack = (fallback: () => void) => [...backHandlers].reverse().some((h) => h()) || fallback()

import { useEffect } from 'react'

/**
 * Tests that need quiet (Settings' tones, hearing check, HRTF picker, "Does it sound like it?",
 * the gallery's tone sweep) hold the music while they play. The gallery fades its song out and
 * pauses; when the last hold is released it resumes from the same spot with a fade-in.
 */
const holds = new Set<symbol>()
const subs = new Set<(held: boolean) => void>()

/** Hold the music; call the returned function to let go (twice is harmless). */
export function holdMusic(): () => void {
  const id = Symbol('hold')
  const was = holds.size > 0
  holds.add(id)
  if (!was) subs.forEach((cb) => cb(true))
  return () => {
    if (!holds.delete(id)) return
    if (!holds.size) subs.forEach((cb) => cb(false))
  }
}

export function musicHeld(): boolean {
  return holds.size > 0
}

/** Called with true when the first hold starts and false when the last one ends. */
export function onMusicHold(cb: (held: boolean) => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

/** Hold the music while `active` (and let go on unmount). */
export function useMusicHold(active: boolean) {
  useEffect(() => (active ? holdMusic() : undefined), [active])
}

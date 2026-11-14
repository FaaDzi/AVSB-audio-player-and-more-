import type { MixEffect } from '../audio/galleryPlayer'

/** The settings behind a transition, read through `get` so the listening page can pass its own. */
export function mixEffectFrom(get: (id: string) => unknown): MixEffect {
  const name = String(get('transition'))
  const pitch = Number(get('mixpitch') ?? 0)
  const rateOf = (semitones: number, speed = 1) => speed * 2 ** (semitones / 12)
  if (name === 'Muffled') return { lowPass: true, echo: false, rate: 1 }
  if (name === 'Echo') return { lowPass: false, echo: true, rate: 1 }
  if (name === 'Pitch') return { lowPass: false, echo: false, rate: rateOf(pitch) }
  if (name === 'Custom') return { lowPass: Boolean(get('mixlowpass')), echo: Boolean(get('mixecho')), rate: rateOf(pitch, Number(get('mixspeed') ?? 1)) }
  return { lowPass: false, echo: false, rate: 1 }
}

/** The overlap: automatic is six seconds or a tenth of the shorter song. A chosen length can take up to half of it. None under 20 seconds. */
export function mixSeconds(outgoing: number, incoming: number, chosen?: number): number {
  const shorter = Math.min(outgoing, incoming)
  if (shorter < 20) return 0
  return chosen === undefined ? Math.min(6, shorter * 0.1) : Math.min(chosen, shorter / 2)
}

// §118: listening presets (Gaming · FPS …, Focus, Street, Plain). Each is the sound it should end up with, written
// as dB away from neutral per band, plus the earbud settings and spatial mode that go with it. The EQ it plays is
// worked out against the gear's own response, so a band the gear already has isn't added again (owner: no blind adds;
// the WH-1000XM4's bass already sits high, so Street adds little or no bass on it).
import type { Biquad } from '../eq/biquad'

export type ListeningId = 'fps' | 'battle-royale' | 'moba' | 'rpg' | 'racing' | 'focus' | 'street' | 'plain'

interface Band { kind: Biquad['kind']; fc: number; q: number; /** dB away from neutral that this preset wants. */ want: number }
export interface ListeningPreset {
  id: ListeningId
  label: string
  group: 'gaming' | 'focus' | 'street' | 'plain'
  /** What it does, in a few words (shown under the name). */
  sound: string
  bands: Band[]
  preamp: number
  /** Noise control is left where the owner set it, except Street (ambient); leaving Street puts it back. */
  earbuds: { noise?: 'ambient-mid'; game?: 0 | 1 }
  spatial?: { mode: 'speakers' } | { mode: 'crossfeed'; xfAmount: number; xfAngle: number; xfCutHz: number }
}

// starting points from the §118 research (gaming guides, noise-masking work, focus studies), to tune by ear
export const LISTENING: ListeningPreset[] = [
  { id: 'fps', label: 'FPS', group: 'gaming', sound: 'footsteps forward, rumble down', preamp: 0,
    bands: [{ kind: 'lowshelf', fc: 120, q: 0.71, want: -4 }, { kind: 'peak', fc: 3000, q: 1.2, want: 4 }, { kind: 'highshelf', fc: 8000, q: 0.71, want: -2 }],
    earbuds: { game: 1 } },
  { id: 'battle-royale', label: 'Battle royale', group: 'gaming', sound: 'vehicles and far shots clearer', preamp: 0,
    bands: [{ kind: 'lowshelf', fc: 100, q: 0.71, want: -2 }, { kind: 'peak', fc: 3500, q: 1, want: 3 }, { kind: 'peak', fc: 5500, q: 1.4, want: 2 }],
    earbuds: { game: 1 } },
  { id: 'moba', label: 'MOBA / strategy', group: 'gaming', sound: 'voices and abilities clear', preamp: 0,
    bands: [{ kind: 'peak', fc: 1000, q: 0.8, want: 2 }, { kind: 'peak', fc: 2000, q: 1, want: 1.5 }, { kind: 'highshelf', fc: 12000, q: 0.71, want: -1 }],
    earbuds: { game: 1 } },
  { id: 'rpg', label: 'RPG / open world', group: 'gaming', sound: 'fuller and wider', preamp: 0,
    bands: [{ kind: 'lowshelf', fc: 80, q: 0.71, want: 3 }, { kind: 'peak', fc: 3000, q: 0.8, want: 1 }, { kind: 'highshelf', fc: 10000, q: 0.71, want: 1.5 }],
    earbuds: { game: 1 }, spatial: { mode: 'speakers' } },
  { id: 'racing', label: 'Racing', group: 'gaming', sound: 'engine and tyres up front', preamp: 0,
    bands: [{ kind: 'peak', fc: 120, q: 0.9, want: 2.5 }, { kind: 'peak', fc: 1500, q: 1, want: 1.5 }, { kind: 'highshelf', fc: 10000, q: 0.71, want: -1 }],
    earbuds: { game: 1 } },
  { id: 'focus', label: 'Focus', group: 'focus', sound: 'music in the background, wide and soft', preamp: -4,
    bands: [{ kind: 'highshelf', fc: 4000, q: 0.71, want: -4 }, { kind: 'peak', fc: 3000, q: 1, want: -2.5 }],
    earbuds: { game: 0 }, spatial: { mode: 'crossfeed', xfAmount: 125, xfAngle: 45, xfCutHz: 750 } },
  { id: 'street', label: 'Street', group: 'street', sound: 'bass the traffic hides, back', preamp: 0,
    bands: [{ kind: 'lowshelf', fc: 150, q: 0.71, want: 4 }, { kind: 'peak', fc: 60, q: 0.8, want: 2 }, { kind: 'peak', fc: 2500, q: 1, want: 1 }],
    earbuds: { noise: 'ambient-mid', game: 0 } },
  { id: 'plain', label: 'Plain', group: 'plain', sound: 'just your gear and its tuning', preamp: 0, bands: [], earbuds: { game: 0 } },
]
export const listening = (id: ListeningId) => LISTENING.find((p) => p.id === id)!
/** The EQ name a preset plays under (Saved EQ and the circle show it). */
export const listeningName = (p: ListeningPreset) => (p.group === 'gaming' ? `Gaming · ${p.label}` : p.label)
export const isListeningName = (name: string) => LISTENING.some((p) => listeningName(p) === name)

/** The span a band works on: a shelf's side of its corner, a peak's ±half its bandwidth (1/q octaves wide). */
function spanOf(b: Band): [number, number] {
  if (b.kind === 'lowshelf') return [20, b.fc * 1.4]
  if (b.kind === 'highshelf') return [b.fc / 1.4, 20000]
  const half = 1 / b.q / 2
  return [b.fc / 2 ** half, b.fc * 2 ** half]
}

/**
 * The filters a preset plays on this gear. `deviation` is the gear as heard now (its measurement plus any Sound
 * correction) minus neutral, in dB on `grid`; null when the gear has no measurement (then half the table values).
 * A boost is only what's missing (never more than wanted, never a cut); a cut likewise.
 */
export function presetFilters(p: ListeningPreset, grid: ArrayLike<number> | null, deviation: ArrayLike<number> | null): Biquad[] {
  return p.bands.map((b) => {
    let gain = b.want / 2
    if (grid && deviation) {
      const [lo, hi] = spanOf(b)
      let sum = 0
      let n = 0
      for (let i = 0; i < grid.length; i++) if (grid[i] >= lo && grid[i] <= hi) { sum += deviation[i]; n++ }
      const has = n ? sum / n : 0
      const need = b.want - has
      gain = b.want >= 0 ? Math.min(b.want, Math.max(0, need)) : Math.max(b.want, Math.min(0, need))
    }
    return { kind: b.kind, fc: b.fc, q: b.q, gain: Math.round(gain * 10) / 10 }
  })
}

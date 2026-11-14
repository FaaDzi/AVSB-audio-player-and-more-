export type Side = 0 | 1

export interface MatchState {
  bestOf: number
  /** Winner of each round played so far. */
  rounds: Side[]
  wins: [number, number]
  winner: Side | null
}

export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1

export function newMatch(bestOf: number): MatchState {
  if (bestOf < 1 || bestOf % 2 === 0) throw new Error(`bestOf must be odd, got ${bestOf}`)
  return { bestOf, rounds: [], wins: [0, 0], winner: null }
}

export function recordRound(m: MatchState, winner: Side): MatchState {
  if (m.winner !== null) throw new Error('Match already decided')
  const wins: [number, number] = [...m.wins]
  wins[winner]++
  return {
    ...m,
    rounds: [...m.rounds, winner],
    wins,
    winner: wins[winner] >= winsNeeded(m.bestOf) ? winner : null,
  }
}

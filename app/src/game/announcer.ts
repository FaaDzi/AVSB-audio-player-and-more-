/**
 * "DJ Tips" — Jackbox-style cartoon ear-tips announcer & commentary engine (GDD Section 9).
 * Short, punchy, funny lines with zero generic Unicode emojis.
 */

import type { Iem } from '../audio/data'
import { FLAVOUR_INFO } from '../prefs/scoring'
import type { Preferences } from '../prefs/types'

export type QuipMood = 'hype' | 'snark' | 'upset' | 'warn' | 'chill' | 'crown'

export interface HostQuip {
  text: string
  mood: QuipMood
  badge?: string
}

export function getSheetQuip(sheet: number, prefs: Preferences, currentName: string | null): HostQuip {
  switch (sheet) {
    case 0:
      return {
        text: 'Welcome to the show! First things first: what kind of gear is fighting tonight?',
        mood: 'hype',
      }
    case 1:
      if (prefs.listeningOn === 'speakers' || prefs.listeningOn === 'earbuds') {
        return {
          badge: 'HEADS UP',
          text: 'Open-air speakers and loose earbuds lose sub-bass fast. Grab a sealed pair of IEMs if you have one handy!',
          mood: 'warn',
        }
      }
      return {
        text: currentName
          ? `${currentName} locked in! We tune the simulation to it.`
          : 'Tell us what is in your ears so we can calibrate the simulation. Same kind as the bracket? It fights to defend its title!',
        mood: 'chill',
      }
    case 2:
      return {
        text: 'Be honest! Does your current gear rumble too hard, sound like a tin can, or do you actually love it?',
        mood: 'snark',
      }
    case 3:
      if (prefs.volume === 'high') {
        return {
          badge: 'EAR SAFETY CHECK',
          text: 'Loud listener spotted! Keep the volume comfortable during matches so your ears stay fresh for all 14 bouts.',
          mood: 'warn',
        }
      }
      return {
        text: 'Our ears hear bass and treble differently depending on volume. Where does your volume knob live?',
        mood: 'chill',
      }
    case 4:
      return {
        text: 'How much damage are we doing to the wallet? We might sneak in one Stretch Pick just above your ceiling.',
        mood: 'snark',
      }
    case 5: {
      const fl = FLAVOUR_INFO[prefs.flavour ?? 'neutral']
      return {
        text: `${fl.label}: ${fl.tagline.toLowerCase()}. We will also slip one Dark Horse into the bracket to test your honesty!`,
        mood: 'hype',
      }
    }
    default:
      return {
        badge: 'FINAL QUESTION',
        text: 'Pick up to three genres for the match playlist, then watch this stack of paper fly into the sky!',
        mood: 'hype',
      }
  }
}

export interface MatchOutcomeContext {
  winner: Iem
  loser: Iem
  winnerSeed?: number | null
  loserSeed?: number | null
  winnerPrice?: number | null
  loserPrice?: number | null
  wins: [number, number]
  winnerSide: 0 | 1
  currentIemId?: string | null
  isGrandFinal?: boolean
}

export interface MatchOutcomeVerdict {
  quip: HostQuip
  stickers: { label: string; color: 'yellow' | 'pink' | 'cyan' | 'green' }[]
  isUpset: boolean
}

export function analyzeMatchOutcome(ctx: MatchOutcomeContext): MatchOutcomeVerdict {
  const {
    winner,
    loser,
    winnerSeed,
    loserSeed,
    winnerPrice,
    loserPrice,
    wins,
    winnerSide,
    currentIemId,
    isGrandFinal,
  } = ctx

  const winScore = wins[winnerSide]
  const loseScore = wins[1 - winnerSide]
  const isSweep = loseScore === 0 && winScore >= 2
  const isClutch = winScore >= 2 && winScore - loseScore === 1

  const stickers: { label: string; color: 'yellow' | 'pink' | 'cyan' | 'green' }[] = []
  let isUpset = false

  const priceRatio =
    winnerPrice && loserPrice && winnerPrice > 0 && loserPrice > 0 ? loserPrice / winnerPrice : 1
  const isGiantKiller = priceRatio >= 1.8 && (loserPrice ?? 0) - (winnerPrice ?? 0) >= 60
  const isSeedUpset =
    winnerSeed != null && loserSeed != null && winnerSeed - loserSeed >= 2

  if (isGiantKiller && winnerPrice && loserPrice) {
    isUpset = true
    stickers.push({
      label: `GIANT KILLER ($${Math.round(winnerPrice)} BEAT $${Math.round(loserPrice)})`,
      color: 'pink',
    })
  } else if (isSeedUpset) {
    isUpset = true
    stickers.push({
      label: `UPSET! SEED #${winnerSeed} TOPPLED SEED #${loserSeed}`,
      color: 'pink',
    })
  }

  if (isSweep) {
    stickers.push({ label: `CLEAN SWEEP (${winScore}-${loseScore})`, color: 'cyan' })
  } else if (isClutch) {
    stickers.push({ label: `PHOTO FINISH (${winScore}-${loseScore})`, color: 'yellow' })
  }

  if (currentIemId && winner.id === currentIemId) {
    stickers.push({ label: 'DEFENDING CHAMP HELD SERVE', color: 'green' })
  } else if (currentIemId && loser.id === currentIemId) {
    isUpset = true
    stickers.push({ label: 'YOUR DAILY DRIVER TOOK AN L', color: 'pink' })
  }

  if (isGrandFinal) {
    return {
      isUpset,
      stickers,
      quip: {
        badge: 'GRAND FINAL VERDICT',
        text: `${winner.name} takes the crown ${winScore}-${loseScore} over ${loser.name}!`,
        mood: 'crown',
      },
    }
  }

  if (currentIemId && loser.id === currentIemId) {
    return {
      isUpset: true,
      stickers,
      quip: {
        badge: 'BETRAYAL IN THE BOOTH',
        text: `Plot twist! You just voted against your own ${loser.name} in a blind test. ${winner.name} stole the match ${winScore}-${loseScore}!`,
        mood: 'upset',
      },
    }
  }

  if (currentIemId && winner.id === currentIemId) {
    return {
      isUpset,
      stickers,
      quip: {
        badge: 'SEED #1 DEFENDS',
        text: `Even with the blindfold on, your ears recognized home! Your ${winner.name} advances ${winScore}-${loseScore}.`,
        mood: 'crown',
      },
    }
  }

  if (isGiantKiller && winnerPrice && loserPrice) {
    return {
      isUpset: true,
      stickers,
      quip: {
        badge: 'WALLET BREAKER UPSET',
        text: `Sound the air horn! The $${Math.round(winnerPrice)} ${winner.name} just knocked down the $${Math.round(loserPrice)} ${loser.name} (${winScore}-${loseScore})!`,
        mood: 'upset',
      },
    }
  }

  if (isSeedUpset) {
    return {
      isUpset: true,
      stickers,
      quip: {
        badge: 'BRACKET BUSTER',
        text: `Seed #${winnerSeed} ${winner.name} upsets Seed #${loserSeed} ${loser.name} (${winScore}-${loseScore})!`,
        mood: 'upset',
      },
    }
  }

  if (isSweep) {
    return {
      isUpset,
      stickers,
      quip: {
        badge: 'FLAWLESS VICTORY',
        text: `${winner.name} did not drop a single song — sweeping ${loser.name} ${winScore}-${loseScore}.`,
        mood: 'hype',
      },
    }
  }

  return {
    isUpset,
    stickers,
    quip: {
      badge: 'MATCH DECIDED',
      text: `${winner.name} edges out ${loser.name} (${winScore}-${loseScore}) and moves on in the bracket!`,
      mood: 'hype',
    },
  }
}

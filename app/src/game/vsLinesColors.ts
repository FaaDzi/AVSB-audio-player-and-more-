/** Colours of the VS speed lines per kind (§64), used by VsSpeedLines.tsx. */
export type LinesKind = 'iems' | 'tws' | 'headphones'

/** [background, streaks] per kind: IEM yellow, headphones blue, TWS red. */
export const KIND_LINES: Record<LinesKind, [string, string]> = {
  iems: ['#ffe27a', '#b86e00'],
  headphones: ['#9fd0ff', '#1d4fb2'],
  tws: ['#ffa89c', '#b3122c'],
}

/** feComponentTransfer table values for one channel: grey 0 → background, grey 1 → streak. */
/** The new UI's Game show style keeps the old app's kind colours: IEM purple, headphones orange, TWS cyan (§65). */
export const KIND_LINES_GAMESHOW: Record<LinesKind, [string, string]> = {
  iems: ['#dcc6ff', '#5b2fa8'],
  headphones: ['#ffc995', '#a8500a'],
  tws: ['#aef4ff', '#0d7a91'],
}

/** The palette for the style in use: Game show in the new UI, else the Clean colours (the old app has no style). */
export function kindLines(gameshow: boolean): Record<LinesKind, [string, string]> {
  return gameshow ? KIND_LINES_GAMESHOW : KIND_LINES
}

export function channelTable(kind: LinesKind, channel: 0 | 1 | 2, gameshow = false): string {
  const at = (hex: string) => parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255
  const [bg, streak] = kindLines(gameshow)[kind]
  return `${at(bg).toFixed(3)} ${at(streak).toFixed(3)}`
}

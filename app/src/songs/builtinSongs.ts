/**
 * Canonical 10 permanent built-in songs bundled into the Android APK and Windows EXE.
 * Spans all 6 acoustic categories (bass, vocals, treble, acoustic, stage, busy)
 * with at least 2 tracks per category across primary and secondary specialities.
 */
export const BUILTIN_SONG_STEMS: readonly string[] = [
  '001 - Otis McDonald - Scarlet Fire',
  '004 - Billie Eilish - bad guy',
  '007 - Massive Attack - Teardrop',
  '027 - Radiohead - Paranoid Android',
  '041 - Adele - Someone Like You',
  '060 - Steely Dan - Aja',
  '062 - The Dave Brubeck Quartet - Take Five',
  '107 - Eagles - Hotel California (live)',
  '108 - Tracy Chapman - Fast Car',
  '117 - Yosi Horikawa - Bubbles',
] as const

export const BUILTIN_SONG_SET: ReadonlySet<string> = new Set(BUILTIN_SONG_STEMS)

export function isBuiltinStem(stemOrName: string): boolean {
  const stem = stemOrName.replace(/\.[^.]+$/, '')
  return BUILTIN_SONG_SET.has(stem)
}

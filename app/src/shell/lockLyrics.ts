// §92 lyrics on the lock screen: while a song with timed lyrics plays, the notification's second line is the line
// being sung (Android draws that screen, so it takes the system's look). Lyrics come from the file or from those
// found online earlier; this never searches by itself (the lyrics view does).
import { useEffect, useState } from 'react'
import { livePosition } from './engine'
import type { Track } from './library'
import { activeLine, parseLyrics, type LyricLine } from './lyrics'
import { savedOnlineLyrics, songLyricsOffset } from './onlineLyrics'
import { getSetting } from './settings/store'
import { isAndroid } from '../platform'

const timed = (lines: LyricLine[]) => (lines.some((l) => l.at !== null) ? lines : [])

export function useLockScreenLyric(current: Track | null, playing: boolean): string {
  const [lines, setLines] = useState<LyricLine[]>([])
  const [line, setLine] = useState('')
  const on = isAndroid() && getSetting('locklyrics') !== false

  useEffect(() => {
    setLines([])
    setLine('')
    if (!current || !on) return
    let live = true
    const saved = () => timed(parseLyrics(savedOnlineLyrics(current.id) ?? ''))
    if (!current.lyrics) {
      setLines(saved())
      return
    }
    fetch(`/shell-host/lyrics?id=${current.id}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => { if (live) setLines(timed(parseLyrics(text)).length ? timed(parseLyrics(text)) : saved()) })
      .catch(() => { if (live) setLines(saved()) })
    return () => { live = false }
  }, [current, on])

  useEffect(() => {
    if (!playing || !lines.length || !current) return
    const offset = Number(getSetting('lyricoffset') ?? 0) + songLyricsOffset(current.id)
    // only a changed line re-posts the notification, so Android never throttles it
    const id = window.setInterval(() => {
      const i = activeLine(lines, livePosition() + offset)
      setLine(i >= 0 ? lines[i].text.trim() : '')
    }, 300)
    return () => window.clearInterval(id)
  }, [lines, playing, current])

  return line
}

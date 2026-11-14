import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cover, Icon, IconButton, Menu } from './ui'
import { useShell } from './context'
import { activeLine, censorProfanity, gapBefore, parseLyrics, uncensorProfanity, type LyricLine } from './lyrics'
import { easeOutCubic, lyricScrollAt, useLeaving } from './motion'
import { livePosition, onPositionShown } from './engine'
import { lyricsProviderOn, lyricsRanked, saveOnlineLyrics, savedOnlineLyrics, searchOnline, searchVersions, setSongLyricsOffset, songLyricsOffset } from './onlineLyrics'
import { isJapaneseSong, romajiFor } from './romaji'
import { getSetting, useSettings } from './settings/store'

type Panel = NonNullable<ReturnType<typeof useShell>['panel']>

/** The docked right-hand panel next to whatever page is open. Its width grows and pushes the page aside. */
export function Inspector({ panel, closing }: { panel: Panel; closing: boolean }) {
  const { setPanel } = useShell()
  return (
    <div className={`ms-inspector-slot${closing ? ' closing' : ''}`}>
      <aside className="ms-inspector" aria-label={panel === 'queue' ? 'Up next' : 'Lyrics'}>
        <header className="ms-inspector-head">
          <h2>{panel === 'queue' ? 'Up next' : 'Lyrics'}</h2>
          <IconButton icon="close" label="Close" onClick={() => setPanel(null)} />
        </header>
        <PanelSwap panel={panel} />
      </aside>
    </div>
  )
}

/** Lyrics or the queue, cross-fading when one replaces the other. */
export function PanelSwap({ panel }: { panel: Panel }) {
  const leaving = useLeaving(panel, 180)
  const view = (p: Panel) => (p === 'queue' ? <QueueList /> : <LyricsView />)
  return (
    <div className="ms-swapbox">
      {leaving && <div className="ms-swap fading-out" key={leaving} inert>{view(leaving)}</div>}
      <div className={`ms-swap${leaving ? ' fading-in' : ''}`} key={panel}>{view(panel)}</div>
    </div>
  )
}

export function QueueList() {
  const { queue, data, current, play, setQueue, repeat, setRepeat, shuffle, setShuffle, autoplay, setAutoplay, shuffleLibrary } = useShell()
  const list = queue.length ? queue : data.tracks
  const dragFrom = useRef<number | null>(null)
  const nextRepeat = { off: 'all', all: 'one', one: 'off' } as const

  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setQueue(next)
  }

  return (
    <div className="ms-queue">
      <div className="ms-queue-modes">
        <IconButton icon="all_inclusive" label={`Autoplay ${autoplay ? 'on' : 'off'}`} active={autoplay} onClick={() => setAutoplay(!autoplay)} />
        <IconButton icon={repeat === 'one' ? 'repeat_one' : 'repeat'} label={`Repeat ${repeat}`} active={repeat !== 'off'} onClick={() => setRepeat(nextRepeat[repeat])} />
        <IconButton icon="shuffle" label={`Shuffle ${shuffle ? 'on' : 'off'}`} active={shuffle} onClick={() => setShuffle(!shuffle)} />
      </div>
      <button type="button" className="ms-shuffle-all" onClick={shuffleLibrary}><Icon name="shuffle" size={20} /> Shuffle library</button>
      <div className="ms-queue-list">
        {list.slice(0, 300).map((t, i) => (
          <div
            className={`ms-queue-row${current?.id === t.id ? ' on' : ''}`}
            key={t.id}
            draggable
            onDragStart={() => { dragFrom.current = i }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i) }}
          >
            <button type="button" className="ms-queue-play" onClick={() => play(t, list)}>
              <Cover id={t.cover} className={current?.id === t.id ? 'round' : ''} />
              <span className="grow">
                <span className="ms-queue-title">{t.title}</span>
                <span className="ms-queue-sub">{t.artist || 'Unknown Artist'}</span>
              </span>
            </button>
            <span className="ms-drag" title="Drag to reorder"><Icon name="drag_handle" /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Songs already looked up this session, so one with no lyrics online isn't asked about again and again. */
const lookedUp = new Set<string>()

/**
 * Reads the lyrics saved in the file's tags, and follows the position when they carry timestamps.
 * Kept light while it plays (plan Phase 5): it doesn't re-render with the position, the frame loop only runs while a
 * synced song plays, the profanity filter runs once per song, and only the active line's words are touched per frame.
 */
export function LyricsView() {
  const { current, playing, setPosition, showToast } = useShell()
  useSettings()
  const [searching, setSearching] = useState(false)
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const [romaji, setRomaji] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const seekedAt = useRef(-Infinity)
  const [active, setActive] = useState(-1)
  // scrolling by hand: every other line gets the same soft fade so the sung one still stands out (plan §76 D)
  const [browsing, setBrowsing] = useState(false)
  const userScrolled = useRef(-Infinity)
  const stopScroll = useRef<() => void>(() => {})
  /** The online version showing, if the lyrics came from online (what "Try another version" moves on from). */
  const onlineText = useRef<string | null>(null)
  const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(null)
  const [songOffset, setSongOffset] = useState(0)
  useEffect(() => setSongOffset(current ? songLyricsOffset(current.id) : 0), [current])

  // lyrics in the file always come first, then any found online earlier, then an online lookup
  const showing = useRef(current?.id)
  showing.current = current?.id
  useEffect(() => {
    if (!current) return
    let live = true
    const withoutFileLyrics = () => {
      const saved = savedOnlineLyrics(current.id)
      setLines(saved ? parseLyrics(saved) : [])
      onlineText.current = saved
      // saved before versions were ranked (§76 C): look once more, quietly, and switch if a better version turns up
      if (saved && !lyricsRanked(current.id) && lyricsProviderOn() && !lookedUp.has(current.id)) {
        lookedUp.add(current.id)
        const asked = current.id
        searchOnline(current)
          .then((text) => {
            if (text && text !== saved && showing.current === asked) {
              onlineText.current = text
              setLines(parseLyrics(text))
            }
          })
          .catch(() => {})
      }
      if (!saved && getSetting('autolyrics') && lyricsProviderOn() && !lookedUp.has(current.id)) {
        lookedUp.add(current.id)
        setSearching(true)
        // judged by which song is showing when it answers: an effect re-run must not throw away the only lookup
        const asked = current.id
        searchOnline(current)
          .then((text) => {
            if (text && showing.current === asked) {
              onlineText.current = text
              setLines(parseLyrics(text))
            }
          })
          .catch(() => {})
          .finally(() => { if (showing.current === asked) setSearching(false) })
      }
    }
    onlineText.current = null
    setLines(null)
    if (!current.lyrics) {
      withoutFileLyrics()
      return () => { live = false }
    }
    // the host can answer 404 (Android: the tag isn't cached on the phone): treat that like a file without lyrics
    fetch(`/shell-host/lyrics?id=${current.id}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (!live) return
        const parsed = parseLyrics(text)
        if (parsed.length) setLines(parsed)
        else withoutFileLyrics()
      })
      .catch(() => { if (live) withoutFileLyrics() })
    return () => { live = false }
  }, [current])

  const shown = lines
  const hasSync = Boolean(shown && shown.length > 0 && shown.some((l) => l.at !== null))
  const wordSync = getSetting('lyrword') !== false
  const multiPerson = getSetting('lyrmulti') !== false
  const wantRomaji = getSetting('lyrroman') !== false
  const censorExplicit = getSetting('censor_lyrics') !== false
  // positive timing shows lyrics later, for audio that reaches the ears late
  const offset = Number(getSetting('lyricoffset') ?? 0) + songOffset
  const providerOn = lyricsProviderOn()

  const nudge = (by: number | null) => {
    if (!current) return
    const next = by === null ? 0 : Math.round((songOffset + by) * 10) / 10
    setSongLyricsOffset(current.id, next)
    setSongOffset(next)
    showToast(next === 0 ? 'Lyrics timing reset' : `Lyrics ${Math.abs(next).toFixed(1)} s ${next > 0 ? 'later' : 'earlier'} for this song`)
  }
  const otherVersion = () => {
    if (!current || searching) return
    const song = current
    setSearching(true)
    searchVersions(song)
      .then((versions) => {
        if (showing.current !== song.id) return
        if (versions.length < 2) {
          showToast(versions.length ? 'This is the only version online' : 'No lyrics found online')
          return
        }
        const at = versions.indexOf(onlineText.current ?? '')
        const next = versions[(at + 1) % versions.length]
        saveOnlineLyrics(song.id, next)
        onlineText.current = next
        setLines(parseLyrics(next))
        showToast(`Version ${((at + 1) % versions.length) + 1} of ${versions.length}`)
      })
      .catch(() => showToast('Could not reach the lyrics service'))
      .finally(() => setSearching(false))
  }

  // the filtered text and the instrumental gaps, worked out once per song (not per render or frame)
  const rows = useMemo(() => {
    const clean = (t: string) => (censorExplicit ? censorProfanity(t) : uncensorProfanity(t))
    return (shown ?? []).map((line, i) => ({
      text: clean(line.text) || '♪',
      background: line.background ? clean(line.background) : '',
      words: line.words?.map((w) => clean(w.text)),
      gap: gapBefore(shown ?? [], i),
    }))
  }, [shown, censorExplicit])

  // romaji under each line of a Japanese song, worked out on this computer
  useEffect(() => {
    setRomaji([])
    const texts = (shown ?? []).map((l) => l.text)
    if (!wantRomaji || !isJapaneseSong(texts)) return
    let live = true
    romajiFor(texts).then((r) => { if (live) setRomaji(r) }).catch(() => {})
    return () => { live = false }
  }, [shown, wantRomaji])

  // the screen stays on while lyrics are open, if that setting is on
  const keepAwake = Boolean(getSetting('keepscreen'))
  useEffect(() => {
    if (!keepAwake || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    void navigator.wakeLock.request('screen').then((l) => { if (gone) void l.release(); else lock = l }).catch(() => {})
    return () => { gone = true; void lock?.release() }
  }, [keepAwake])

  const search = () => {
    if (!current || searching) return
    setSearching(true)
    searchOnline(current)
      .then((text) => {
        if (text) {
          onlineText.current = text
          setLines(parseLyrics(text))
        } else showToast('No lyrics found online')
      })
      .catch(() => showToast('Could not reach the lyrics service'))
      .finally(() => setSearching(false))
  }

  useEffect(() => {
    const list = shown ?? []
    if (!hasSync) return
    let frame = 0
    let lastActive = -2
    let lastNow = NaN
    // the active line's words and the fill each one last got, so a frame only writes what changed
    let words: { el: HTMLElement; start: number; end: number; fill: string }[] = []
    const gaps = box.current
      ? Array.from(box.current.querySelectorAll<HTMLElement>('.ms-lyric-gap'), (el) => ({ el, start: Number(el.dataset.start), end: Number(el.dataset.end), dots: Array.from(el.querySelectorAll<HTMLElement>('i')), running: false }))
      : []
    const paint = () => {
      const now = livePosition() - offset
      if (Math.abs(now - lastNow) > 1.5) seekedAt.current = performance.now()
      lastNow = now
      const index = activeLine(list, now)
      if (index !== lastActive) {
        lastActive = index
        setActive(index)
        words = []
      }
      if (wordSync && list[index]?.words?.length) {
        if (!words.length || !words[0].el.isConnected) {
          // the line re-renders with its word spans after setActive: until then this finds the old line's spans, which
          // leave the page on that re-render, so look again once they have
          words = Array.from(box.current?.querySelectorAll<HTMLElement>('.ms-lyric.on .ms-word') ?? [], (el) => ({ el, start: Number(el.dataset.at), end: Number(el.dataset.end), fill: '' }))
        }
        for (const w of words) {
          const share = w.end > w.start ? (now - w.start) / (w.end - w.start) : now >= w.start ? 1 : 0
          const fill = `${Math.max(-6, Math.min(106, share * 100)).toFixed(0)}%`
          if (fill !== w.fill) {
            w.fill = fill
            w.el.style.setProperty('--f', fill)
          }
        }
      }
      for (const g of gaps) {
        const inside = now >= g.start && now < g.end
        if (inside !== g.running) {
          g.running = inside
          g.el.classList.toggle('running', inside)
          g.el.style.visibility = inside ? 'visible' : 'hidden'
        }
        if (inside) {
          const share = (now - g.start) / (g.end - g.start)
          g.dots.forEach((dot, i) => dot.style.setProperty('--dot', (0.3 + 0.7 * Math.max(0, Math.min(1, share * 3 - i))).toFixed(2)))
        }
      }
    }
    // a frame loop only while the song plays; paused, it repaints when the shown position changes (a seek)
    if (playing) {
      const loop = () => { paint(); frame = requestAnimationFrame(loop) }
      frame = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(frame)
    }
    paint()
    return onPositionShown(paint)
  }, [shown, hasSync, wordSync, offset, playing])

  // one scroll tween per line change (Mornye's spring; a quick glide when seeking). The rows below no longer trail
  // one by one: moving each of them every frame was the layout work that made lyrics stutter.
  const glide = useCallback((seeking: boolean) => {
    const list = box.current
    const line = list?.querySelector<HTMLElement>('.ms-lyric.on')
    if (!list || !line) return
    stopScroll.current()
    const from = list.scrollTop
    const to = Math.max(0, line.offsetTop - list.offsetTop - (list.clientHeight - line.offsetHeight) / 2)
    const distance = to - from
    if (Math.abs(distance) < 1) return
    const span = seeking ? 220 : 800
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const ms = now - start
      list.scrollTop = from + distance * (seeking ? easeOutCubic(Math.min(ms / 220, 1)) : lyricScrollAt(ms))
      if (ms < span) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    stopScroll.current = () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const seeking = performance.now() - seekedAt.current < 300
    if (active < 0 || performance.now() - userScrolled.current < 4000) return
    glide(seeking)
  }, [active, glide])
  useEffect(() => () => stopScroll.current(), [])

  // after the listener scrolls by hand, follow the song again once they've left it alone for 4 seconds
  const resumeTimer = useRef(0)
  const onHandScroll = () => {
    userScrolled.current = performance.now()
    stopScroll.current()
    setBrowsing(true)
    window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => {
      setBrowsing(false)
      glide(false)
    }, 4000)
  }
  useEffect(() => () => window.clearTimeout(resumeTimer.current), [])

  if (!current) return <div className="ms-lyrics-empty"><Icon name="lyrics" size={32} /><p>Nothing is playing</p></div>
  if (shown && !shown.length) {
    return (
      <div className="ms-lyrics-empty">
        <Icon name="lyrics" size={32} />
        <p>No lyrics in this file</p>
        {providerOn ? <button type="button" className="ms-btn tonal" disabled={searching} onClick={search}><Icon name="cloud_download" size={20} /> {searching ? 'Searching…' : 'Search online'}</button> : <p className="ms-lyrics-note">Online lyrics are off in Lyrics Provider Priority</p>}
      </div>
    )
  }
  return (
    <>
    {/* timing and version fixes for this song (§76 C) */}
    {hasSync && (
      <div className="ms-lyrics-tools">
        <IconButton icon="more_vert" label="Lyrics options" small onClick={(e) => setToolsMenu({ x: e.clientX, y: e.clientY })} />
      </div>
    )}
    {toolsMenu && (
      <Menu
        x={toolsMenu.x}
        y={toolsMenu.y}
        onClose={() => setToolsMenu(null)}
        items={[
          ...(onlineText.current && providerOn ? [{ label: searching ? 'Looking…' : 'Wrong timing? Try another version', icon: 'swap_horiz', divider: true, onSelect: otherVersion }] : []),
          { label: 'Lyrics earlier (−0.5 s)', icon: 'fast_rewind', onSelect: () => nudge(-0.5) },
          { label: 'Lyrics later (+0.5 s)', icon: 'fast_forward', onSelect: () => nudge(0.5) },
          ...(songOffset !== 0 ? [{ label: `Reset timing (now ${songOffset > 0 ? '+' : ''}${songOffset.toFixed(1)} s)`, icon: 'restart_alt', onSelect: () => nudge(null) }] : []),
        ]}
      />
    )}
    {/* a finger moving on any line (or the wheel, or the scrollbar) is a hand scroll: the glide stops at once so it
        never fights the finger. A tap that doesn't move still seeks to its line and keeps following. */}
    <div className={`ms-lyrics${browsing ? ' browsing' : ''}`} ref={box} onWheel={onHandScroll} onTouchMove={onHandScroll} onPointerDown={(e) => { if (e.target === box.current) onHandScroll() }}>
      {shown && shown.length > 0 && !hasSync && (
        <div className="ms-lyrics-unsynced-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', marginBottom: 12, borderRadius: 16, background: 'rgb(var(--ink) / 0.08)', fontSize: 13 }}>
          <span>Plain text (no timing tags)</span>
          {providerOn && (
            <button
              type="button"
              className="ms-btn text small"
              disabled={searching}
              onClick={search}
              style={{ padding: '4px 8px', height: 28, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon name="sync" size={14} /> {searching ? 'Searching…' : 'Find synced online'}
            </button>
          )}
        </div>
      )}
      {shown?.map((line, i) => {
        const row = rows[i]
        if (!row) return null
        return (
          <Fragment key={i}>
            {row.gap && <div className="ms-lyric-gap" data-start={row.gap.start} data-end={row.gap.end} aria-hidden="true"><i /><i /><i /></div>}
            <button
              type="button"
              className={`ms-lyric${i === active ? ' on' : ''}${i < active ? ' past' : ''}${multiPerson && line.voice === 'v2' ? ' end' : ''}`}
              disabled={line.at === null}
              onClick={() => line.at !== null && setPosition(line.at)}
            >
              <span className="ms-lyric-main">
                {wordSync && line.words && row.words && i === active
                  ? line.words.map((w, n) => <span className="ms-word" key={n} data-at={w.at} data-end={w.end ?? (line.words?.[n + 1]?.at ?? w.at + 0.5)}>{row.words?.[n]}</span>)
                  : row.text}
              </span>
              {multiPerson && row.background && <span className="ms-lyric-bg">{row.background}</span>}
              {romaji[i] && <span className="ms-lyric-sub">{romaji[i]}</span>}
            </button>
          </Fragment>
        )
      })}
    </div>
    </>
  )
}

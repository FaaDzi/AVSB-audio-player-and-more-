import { checkDaily, openUpdate } from './updates'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton, placeholderCoverImage } from './ui'
import { sleepStopsAfterThisSong, useSleepTimerRunner } from './sleepTimer'
import { useLockScreenLyric } from './lockLyrics'
import { MiniPlayer } from './MiniPlayer'
import { NowPlaying } from './NowPlaying'
import { PlayerBar } from './PlayerBar'
import { Sidebar } from './Sidebar'
import { PhoneMini, PhoneTabs, runPhoneBack, useKeyboardOpen, usePhone } from './PhoneNav'
import { onPairLink } from './linkClient'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Inspector } from './SidePanels'
import { installRipple, useHeld } from './motion'
import { freshPicks, nextAfterEnd, nextByButton, PlayHistory } from './queue'
import { audioUrl, clearQueuedNext, livePosition, playTrack, seekTo, setEngineEvents, setEngineLibrary, setEngineVolume, setPaused, showPosition } from './engine'
import { featuresOf, startAnalysis } from './analysis'
import { LEARN_AFTER, pickAutoplay } from './autoplay'
import { host } from './host'
import { getListening, recordListen } from './stats'
import { logLine } from './logs'
import { getSetting, setSetting } from './settings/store'
import { libraryStatus, onTracks, refresh, scan, scanIsDue, useLibraryStatus, useMetaBanner } from './localLibrary'
import { FirstRun } from './FirstRun'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { DatabasePage } from './database/DatabasePage'
import { TournamentPage } from './tournament/TournamentPage'
import { TipPage } from './database/EarTips'
import { DevicePage } from './database/DevicePage'
import { SongPage } from './pages/SongPage'
import { AlbumPage, ArtistPage, FolderPage, PlaylistPage } from './pages/DetailPages'
import { SettingsPage } from './settings/SettingsPage'
import { ShellContext, type Repeat, type Route, type SidePanel, type ToastItem } from './context'
import { canPlay, coverUrl, overlayTracks, feedRegisteredNamingSink, setCuratedSongs, type CuratedSong, type LibraryData, type Track } from './library'
import { localEdit, usePlaylistLink } from './playlistLink'
import { moveToBackground, onMediaControls, setMediaActive, setNowPlaying as showOnLockScreen } from '../platform'

function shuffled<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const DESTINATIONS = ['home', 'library', 'tournament', 'database', 'settings']
const destination = (r: Route) => DESTINATIONS.indexOf(r.page === 'album' || r.page === 'artist' || r.page === 'playlist' || r.page === 'song' || r.page === 'folder' ? 'library' : r.page)

function routeKey(r: Route, depth: number): string {
  const detail = r.page === 'library' ? r.tab : r.page === 'settings' ? r.section : r.page === 'playlist' || r.page === 'song' ? r.id : r.page === 'album' ? r.key : r.page === 'artist' ? r.name : r.page === 'folder' ? r.folder : ''
  return `${depth}-${r.page}-${detail ?? ''}`
}

/** next/prev: neighbouring tabs slide. jump: far tabs fade in. push/pop: a detail page's zoom route. */
type PageMotion = 'next' | 'prev' | 'jump' | 'push' | 'pop' | 'none'
const PAGE_MOTION_MS: Record<PageMotion, number> = { next: 250, prev: 250, jump: 0, push: 300, pop: 300, none: 0 }

function pageMotion(from: { route: Route; depth: number }, to: { route: Route; depth: number }): PageMotion {
  const a = destination(from.route)
  const b = destination(to.route)
  if (a !== b) return Math.abs(a - b) === 1 ? (b > a ? 'next' : 'prev') : 'jump'
  if (to.depth < from.depth) return 'pop'
  return from.route.page === to.route.page ? 'none' : 'push'
}

/**
 * Saved playlists. The first time on the PC, the ones the old built-in song list carried, so none are lost in the move.
 * The phone doesn't take them: they're the PC's songs, which the phone doesn't have (an early phone build did; an
 * untouched copy of that is dropped).
 */
async function loadPlaylists(): Promise<LibraryData['playlists']> {
  const onPhone = Capacitor.getPlatform() === 'android'
  const saved = getSetting('playlists')
  if (typeof saved === 'string' && saved) {
    try {
      const lists = JSON.parse(saved) as LibraryData['playlists']
      if (!onPhone) return lists
      const old = await fetch('/shell-fixture/library.json').then((r) => (r.ok ? (r.json() as Promise<LibraryData>) : null)).catch(() => null)
      const seeded = new Set((old?.playlists ?? []).map((p) => JSON.stringify(p)))
      const kept = lists.filter((p) => !seeded.has(JSON.stringify(p)))
      if (kept.length !== lists.length) {
        setSetting('playlists', JSON.stringify(kept))
        logLine('INFO', 'Library', 'Removed the PC song list playlist an early phone build had copied')
      }
      return kept
    } catch { logLine('WARN', 'Library', 'Saved playlists could not be read') }
  }
  if (onPhone) return []
  try {
    const old = await fetch('/shell-fixture/library.json')
    if (old.ok) {
      const { playlists } = (await old.json()) as LibraryData
      setSetting('playlists', JSON.stringify(playlists))
      return playlists
    }
  } catch { /* no old list: a new library starts with none */ }
  return []
}

export function Shell() {
  const [data, setData] = useState<LibraryData | null>(null)
  const [failed, setFailed] = useState('')
  const libraryNow = useLibraryStatus()
  const phone = usePhone()
  const typing = useKeyboardOpen(phone)
  const [expanded, setExpanded] = useState(true)
  const [stack, setStack] = useState<Route[]>([{ page: 'library' }])
  const [current, setCurrent] = useState<Track | null>(null)
  const [queue, setQueue] = useState<Track[]>([])
  const [playing, setPlayingState] = useState(false)
  const [loading, setLoading] = useState(false)
  const [volume, setVolumeState] = useState(() => Number(getSetting('volume') ?? 1))
  const [repeat, setRepeatState] = useState<Repeat>(() => (String(getSetting('repeat') ?? 'off') as Repeat))
  const [shuffle, setShuffleState] = useState(() => Boolean(getSetting('shuffle')))
  const [autoplay, setAutoplayState] = useState(() => getSetting('autoplay') !== false)
  const [panel, setPanel] = useState<SidePanel>(null)
  const [nowPlaying, setNowPlaying] = useState(false)
  const [mini, setMini] = useState(false)

  const handleSetMini = useCallback((action: boolean | ((prev: boolean) => boolean)) => {
    setMini((prev) => {
      const next = typeof action === 'function' ? action(prev) : action
      void host()?.setMiniMode?.(next)
      return next
    })
  }, [])
  const [toast, setToast] = useState<ToastItem | null>(null)
  const metaBanner = useMetaBanner()

  // Local Library: songs come from the chosen folders, and arrive part-way through a scan too
  // §83: a newer release on GitHub gets one toast a day, with the download for this platform
  useEffect(() => {
    void checkDaily().then((u) => { if (u) setToast({ message: `AVSB ${u.version} is out`, action: { label: 'Download', onClick: () => openUpdate(u) } }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    let analysing = false
    const take = (tracks: Track[]) => {
      setEngineLibrary(tracks)
      setData((d) => (d ? { ...d, tracks } : d))
      feedRegisteredNamingSink(tracks)
      if (!analysing && tracks.length && !libraryStatus().scanning && Capacitor.getPlatform() !== 'android') {
        analysing = true
        window.setTimeout(() => startAnalysis(tracks, audioUrl), 1500)
      }
    }
    const stop = onTracks(take)
    // the curated song list: what each of its songs tests, for the cover colours (library.ts withCuratedInfo)
    fetch(`${import.meta.env.BASE_URL}data/songs.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ songs?: CuratedSong[] }>) : null))
      .then((d) => { if (d?.songs?.length) setCuratedSongs(d.songs) })
      .catch(() => { /* no list: covers go by genre alone */ })
    Promise.all([refresh(), loadPlaylists()])
      .then(([tracks, playlists]) => {
        logLine('INFO', 'Library', `Loaded ${tracks.length} tracks`)
        setData({ tracks, playlists })
        take(tracks)
        if (scanIsDue(libraryStatus().folders)) void scan()
      })
      .catch((e: unknown) => setFailed(String(e)))
    return stop
  }, [])

  // playlists are saved; the rest of the library comes from the files
  const playlistsNow = useRef<LibraryData['playlists']>([])
  playlistsNow.current = data?.playlists ?? []
  const replaceData = useCallback((d: LibraryData) => {
    // stamped and sent to the other side (PC ↔ phone, §80 A)
    const playlists = localEdit(playlistsNow.current, d.playlists, d.tracks)
    playlistsNow.current = playlists
    setData({ ...d, playlists })
    setSetting('playlists', JSON.stringify(playlists))
  }, [])
  // a merged copy from the other side: saved as it is
  const savePlaylists = useCallback((playlists: LibraryData['playlists']) => {
    playlistsNow.current = playlists
    setData((d) => (d ? { ...d, playlists } : d))
    setSetting('playlists', JSON.stringify(playlists))
  }, [])
  usePlaylistLink(data, savePlaylists)

  useEffect(() => {
    if (!toast) return
    // one with a button (Undo) stays longer, so there's time to reach it
    const id = window.setTimeout(() => setToast(null), typeof toast !== 'string' && toast.action ? 6000 : 3800)
    return () => window.clearTimeout(id)
  }, [toast])

  const setVolume = useCallback((v: number) => { setVolumeState(v); setEngineVolume(v); setSetting('volume', v) }, [])
  const setRepeat = useCallback((r: Repeat) => { setRepeatState(r); setSetting('repeat', r); clearQueuedNext() }, [])
  const setShuffle = useCallback((s: boolean) => { setShuffleState(s); setSetting('shuffle', s); clearQueuedNext() }, [])
  const setAutoplay = useCallback((a: boolean) => { setAutoplayState(a); setSetting('autoplay', a); clearQueuedNext() }, [])
  const setPosition = useCallback((s: number) => { showPosition(s); seekTo(s) }, [])
  const setPlaying = useCallback((p: boolean) => { setPlayingState(p); setPaused(!p) }, [])

  const currentRef = useRef(current)
  currentRef.current = current
  const history = useRef(new PlayHistory())

  /** What's being listened to now, for the statistics. */
  const listening = useRef<Track | null>(null)
  const autoPicked = useRef('')
  const finishListen = useRef((finished: boolean) => {
    const t = listening.current
    listening.current = null
    if (!t) return
    const heard = finished ? t.sec : livePosition()
    // under a second is someone moving through the list, not a verdict on the song
    if (!finished && heard < 1) return
    recordListen({ id: t.id, heard, length: t.sec, finished, viaAutoplay: autoPicked.current === t.id, learning: Boolean(getSetting('personal')), at: Date.now() })
    if (autoPicked.current === t.id) autoPicked.current = ''
  })

  /** Every song change goes through here, so the screen and the player move together. */
  const startSong = useCallback((t: Track) => {
    if (!canPlay(t)) {
      setToast(t.offline ? `"${t.title}" is in a folder that isn't connected` : `${t.format} files can't be played yet`)
      return
    }
    const bridge = host()
    if (bridge && getSetting('player') === 'External player') {
      void bridge.openSong(t.path).then((opened) => setToast(opened ? `Opened "${t.title}" in your default player` : `Couldn't open "${t.title}"`))
      return
    }
    finishListen.current(false)
    listening.current = t
    currentRef.current = t
    setCurrent(t)
    showPosition(0)
    setPlayingState(true)
    setEngineVolume(Number(getSetting('volume') ?? 1))
    void playTrack(t)
  }, [])

  const play = useCallback((t: Track, list?: Track[]) => {
    const now = currentRef.current
    if (now && now.id !== t.id) history.current.visit(now)
    if (list) setQueue(list)
    startSong(t)
  }, [startSong])

  const step = useCallback((direction: 1 | -1) => {
    const now = currentRef.current
    // songs that can't be played now (a format not supported yet, a drive not plugged in) are passed over
    const list = (queue.length ? queue : data?.tracks ?? []).filter(canPlay)
    if (!now || !list.length) return
    // Previous restarts the song when it's already a few seconds in
    if (direction === -1 && livePosition() > 3) { setPosition(0); return }
    if (direction === -1 && shuffle) {
      const previous = history.current.goBack(now)
      if (previous) startSong(previous)
      else setPosition(0)
      return
    }
    const ahead = direction === 1 ? history.current.goForward(now) : null
    if (ahead) { startSong(ahead); return }
    // shuffle's next is the one already picked (and maybe fetched ahead)
    const picked = direction === 1 && shuffle && repeat !== 'one' ? whatsNext.current() : null
    if (picked) { history.current.visit(now); startSong(picked); return }
    const next = nextByButton(shuffle ? freshPicks(list, now, history.current) : list, now, direction, shuffle)
    history.current.visit(now)
    startSong(next)
  }, [queue, data, shuffle, repeat, setPosition, startSong])

  // Android (plan §70 C3): the notification, lock screen and headset buttons follow the player
  const pauseForSleep = useCallback(() => setPlaying(false), [setPlaying])
  useSleepTimerRunner(current, playing, pauseForSleep)
  const controls = useRef({ setPlaying, step, setPosition })
  controls.current = { setPlaying, step, setPosition }
  useEffect(() => onMediaControls((c) => {
    const k = controls.current
    if (c.action === 'play') k.setPlaying(true)
    else if (c.action === 'pause') k.setPlaying(false)
    else if (c.action === 'next') k.step(1)
    else if (c.action === 'prev') k.step(-1)
    else if (c.action === 'seek' && c.position != null) k.setPosition(c.position)
  }), [])
  // §90 C: a song without art shows its genre cover in the notification and on the lock screen, not the app icon
  const lockLyric = useLockScreenLyric(current, playing)
  const lockScreenArt = useMemo(() => (current ? placeholderCoverImage(current.genre, current.category, current.title) : null), [current])
  useEffect(() => {
    if (!current) return
    setMediaActive(playing)
    showOnLockScreen({ id: current.id, title: current.title, artist: lockLyric || current.artist || 'Unknown Artist', duration: current.sec, position: loading ? 0 : livePosition(), playing, loading, coverUrl: current.cover ? coverUrl(current.cover) : lockScreenArt, fallbackCover: lockScreenArt })
  }, [current, playing, loading, lockScreenArt, lockLyric])

  const whatsNext = useRef<() => Track | null>(() => null)
  // §88 D: "next" is picked once per song and order, so the song fetched ahead is the one that plays (shuffle used to
  // re-roll on every ask)
  const nextPick = useRef<{ key: string; pick: Track | null } | null>(null)
  whatsNext.current = () => {
    const now = currentRef.current
    if (!now) return null
    const ahead = repeat === 'one' ? null : history.current.peekForward()
    if (ahead) return ahead
    const key = [now.id, shuffle, repeat, autoplay, queue.length, queue[0]?.id, queue[queue.length - 1]?.id, data?.tracks.length].join('|')
    if (nextPick.current?.key === key) return nextPick.current.pick
    const library = (data?.tracks ?? []).filter(canPlay)
    const list = (queue.length ? queue : library).filter(canPlay)
    const pick = nextAfterEnd(shuffle ? freshPicks(list, now, history.current) : list, now, { repeat, shuffle, autoplay }, library, Math.random, (others) => {
      const heard = getListening()
      const pick = pickAutoplay(others, now, { features: featuresOf, learned: heard.learned, personal: Boolean(getSetting('personal')) && heard.autoplayed >= LEARN_AFTER })
      autoPicked.current = pick.id
      return pick
    })
    nextPick.current = { key, pick }
    return pick
  }
  /** A song took over by itself: the history records it like any other move. */
  const arrived = useRef((next: Track) => {
    finishListen.current(true)
    listening.current = next
    const now = currentRef.current
    if (now && now.id !== next.id) {
      if (history.current.peekForward()?.id === next.id) history.current.goForward(now)
      else history.current.visit(now)
    }
    currentRef.current = next
    setCurrent(next)
    showPosition(0)
  })

  // the engine outlives renders, so it reads the latest state through refs
  useEffect(() => {
    setEngineEvents({
      onLoading: setLoading,
      nextForGapless: () => (sleepStopsAfterThisSong() ? null : whatsNext.current()),
      onAdvance: (t) => arrived.current(t),
      onEnded: () => {
        const next = whatsNext.current()
        if (!next) {
          finishListen.current(true)
          setPlayingState(false)
          showPosition(0)
          return
        }
        arrived.current(next)
        void playTrack(next)
      },
      onError: (t) => {
        setPlayingState(false)
        setToast(`Couldn't play "${t.title}"`)
      },
    })
  }, [])

  const shuffleLibrary = useCallback(() => {
    const list = shuffled(overlayTracks(data?.tracks ?? []))
    if (!list.length) return
    play(list[0], list)
  }, [data, play])

  const push = useCallback((r: Route) => {
    setNowPlaying(false)
    setStack((s) => [...s, r])
  }, [])
  const go = useCallback((r: Route) => {
    setNowPlaying(false)
    setStack([r])
  }, [])
  const openPlaylist = useCallback((id: string) => push({ page: 'playlist', id }), [push])

  const value = useMemo(() => ({
    data: data ?? { tracks: [], playlists: [] },
    current, playing, loading, volume, queue, repeat, shuffle, autoplay, panel, nowPlaying,
    play, step, setPlaying, setPosition, setVolume, setQueue, setRepeat, setShuffle, setAutoplay, setPanel, setNowPlaying, setMini: handleSetMini,
    shuffleLibrary, showToast: setToast, push, go, openPlaylist, replaceData,
  }), [data, current, playing, loading, volume, queue, repeat, shuffle, autoplay, panel, nowPlaying, play, step, shuffleLibrary, push, go, openPlaylist, setPlaying, setPosition, setVolume, setRepeat, setShuffle, setAutoplay, replaceData, handleSetMini])

  const route = stack[stack.length - 1]
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))

  // a PC's pairing link opened from outside the app: straight to Settings → Connect to a PC, which pairs with it
  useEffect(() => onPairLink(() => go({ page: 'settings', section: 'phone' })), [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ;(window as unknown as { __goRoute?: (r: Route) => void }).__goRoute = go
  }, [go])

  // Android's back gesture: Panel (lyrics/queue), then Now Playing, then page stack, then Home, then background/exit
  const backState = useRef({ nowPlaying, panel, depth: stack.length, home: route.page === 'home', playing })
  backState.current = { nowPlaying, panel, depth: stack.length, home: route.page === 'home', playing }
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    const fallback = () => {
      const b = backState.current
      if (b.panel) { setPanel(null); return }
      if (b.nowPlaying) { setNowPlaying(false); setPanel(null); return }
      if (b.depth > 1) back()
      else if (!b.home) go({ page: 'home' })
      else if (b.playing) moveToBackground()
      else void CapApp.exitApp()
    }
    const listener = CapApp.addListener('backButton', () => {
      // a menu or dialog closes first; then panel/Now Playing, which covers every page's own back
      // (§94 D: this used to return here, so back did nothing while a menu or dialog was open; the newest handler is
      // the popup's own, which closes it)
      const popup = document.querySelector('.ms-menu-scrim:not(.ms-exit), .ms-scrim:not(.ms-exit)')
      if (popup) {
        runPhoneBack(() => {})
        return
      }
      if (backState.current.panel) {
        setPanel(null)
      } else if (backState.current.nowPlaying) {
        setNowPlaying(false)
        setPanel(null)
      } else {
        runPhoneBack(fallback)
      }
    })
    return () => void listener.then((l) => l.remove())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mornye's shortcuts (keyboard_shortcuts_page.dart)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        if (mini) handleSetMini(false)
        else if (nowPlaying) setNowPlaying(false)
        else if (!document.querySelector('.ms-menu-scrim:not(.ms-exit), .ms-scrim:not(.ms-exit), .ms-select-bar')) setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
        return
      }
      if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        if (current) setPlaying(!playing)
        return
      }
      if (!e.ctrlKey) return
      const nudge = (d: number) => setVolume(Math.min(1, Math.max(0, volume + d)))
      const pages: Record<string, Route> = { '1': { page: 'home' }, '2': { page: 'library' }, '3': { page: 'tournament' }, '4': { page: 'database' }, '5': { page: 'settings' }, ',': { page: 'settings' } }
      if (pages[e.key]) go(pages[e.key])
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowUp') nudge(0.05)
      else if (e.key === 'ArrowDown') nudge(-0.05)
      else if (e.key === '[') setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))
      else if (e.shiftKey && e.key.toLowerCase() === 'l') setPanel((p) => (p === 'lyrics' ? null : 'lyrics'))
      else if (e.shiftKey && e.key.toLowerCase() === 'u') setPanel((p) => (p === 'queue' ? null : 'queue'))
      else if (e.shiftKey && e.key.toLowerCase() === 'm') { if (current) handleSetMini((m) => !m) }
      else if (e.key === 'f') document.querySelector<HTMLInputElement>('.ms-layer.in .ms-search input')?.focus()
      else return
      e.preventDefault()
    }
    // capture: this has to look before an open dialog's own Esc handler closes it
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [current, mini, nowPlaying, go, step, playing, volume, setPlaying, setVolume])

  useEffect(installRipple, [])
  const heldPanel = useHeld(panel, 220)

  // the old page stays mounted under its own key while it animates out
  const stackKeys = stack.map((r, i) => routeKey(r, i + 1))
  const pageKey = stackKeys[stackKeys.length - 1]
  const [shown, setShown] = useState({ key: pageKey, route, depth: stack.length })
  const [motion, setMotion] = useState<PageMotion>('none')
  const [leaving, setLeaving] = useState<{ key: string; route: Route } | null>(null)
  if (shown.key !== pageKey) {
    const to = { key: pageKey, route, depth: stack.length }
    const next = pageMotion(shown, to)
    setShown(to)
    setMotion(next)
    setLeaving(PAGE_MOTION_MS[next] ? { key: shown.key, route: shown.route } : null)
  }
  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => setLeaving(null), PAGE_MOTION_MS[motion])
    return () => window.clearTimeout(id)
  }, [leaving, motion])

  const renderPage = (r: Route) => {
    if (failed) return <div className="ms-empty"><Icon name="error" /><p>The library didn't load ({failed}).</p></div>
    if (!data) {
      return (
        <div className="ms-page ms-page-loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
          <div className="ms-spinner" style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--accent, #6366f1)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ opacity: 0.7, fontSize: 14 }}>Loading library…</p>
        </div>
      )
    }
    switch (r.page) {
      case 'library': return <LibraryPage initialTab={r.tab} />
      case 'playlist': return <PlaylistPage id={r.id} back={back} />
      case 'album': return <AlbumPage albumKey={r.key} back={back} />
      case 'artist': return <ArtistPage name={r.name} back={back} />
      case 'song': return <SongPage id={r.id} back={back} />
      case 'folder': return <FolderPage folder={r.folder} back={back} />
      case 'home': return <HomePage />
      case 'tournament': return <TournamentPage />
      case 'database': return <DatabasePage initialKind={r.kind} />
      case 'device': return <DevicePage id={r.id} back={back} />
      case 'tip': return <TipPage id={r.id} back={back} />
      default: return <SettingsPage initial={r.section} />
    }
  }

  // the first run, or every folder removed: choose one before anything else
  // Android scans its media index at every start: no first run while that's still going
  if (libraryNow.loaded && !libraryNow.folders.length && !libraryNow.scanning) return <FirstRun />

  return (
    <ShellContext.Provider value={value}>
      {mini ? <MiniPlayer /> : (
        <div className={`ms-window${phone ? ' phone' : ''}${typing ? ' typing' : ''}`}>
          <div
            className={`ms-slide-banner${metaBanner ? ' visible' : ''}${metaBanner === 'done' ? ' done' : ''}`}
            role="status"
            aria-live="polite"
          >
            {metaBanner === 'done' ? (
              <>
                <Icon name="check_circle" size={18} fill />
                <span>Metadata refresh complete</span>
              </>
            ) : (
              <>
                <span className="ms-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                <span>Metadata is being refreshed…</span>
              </>
            )}
          </div>
          <div className="ms-body">
            {!phone && <Sidebar expanded={expanded} onToggle={() => setExpanded((e) => !e)} route={route} go={go} />}
            <main className="ms-content">
              {leaving && !stackKeys.includes(leaving.key) && (motion !== 'pop') && <div className={`ms-layer out ${motion}`} key={leaving.key} inert>{renderPage(leaving.route)}</div>}
              {stack.map((r, i) => {
                const key = stackKeys[i]
                if (key === pageKey) return <div className={`ms-layer in ${motion}`} key={key}>{renderPage(r)}</div>
                return <div className={`ms-layer ${leaving?.key === key ? `out ${motion}` : 'under'}`} key={key} inert>{renderPage(r)}</div>
              })}
              {leaving && !stackKeys.includes(leaving.key) && motion === 'pop' && <div className={`ms-layer out ${motion}`} key={leaving.key} inert>{renderPage(leaving.route)}</div>}
            </main>
            {heldPanel && !nowPlaying && <Inspector panel={heldPanel} closing={!panel} />}
          </div>
          {phone ? (
            <>
              <PhoneMini />
              <PhoneTabs route={route} go={go} />
            </>
          ) : <PlayerBar />}
          {nowPlaying && current && <NowPlaying />}
          {toast && (
            <div className="ms-toast" role="status">
              <span>{typeof toast === 'string' ? toast : toast.message}</span>
              {typeof toast !== 'string' && toast.action && (
                <button
                  type="button"
                  className="ms-btn text"
                  style={{ fontWeight: 700, color: 'var(--accent, #a6f2c6)', padding: '2px 8px', marginLeft: 8 }}
                  onClick={() => {
                    toast.action?.onClick()
                    setToast(null)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <IconButton icon="close" label="Dismiss" small onClick={() => setToast(null)} />
            </div>
          )}
        </div>
      )}
    </ShellContext.Provider>
  )
}

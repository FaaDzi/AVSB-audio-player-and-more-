import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Cover, Icon } from '../ui'
import { useShell } from '../context'
import { groupArtists, openLibrarySearch, trackCount, useLibrary, type Track } from '../library'
import { usePhone } from '../PhoneNav'
import { topArtists, topSongs, useListening, type Listening } from '../stats'
import { getSetting, useArtistSeparators, useSettings } from '../settings/store'
import { getCachedArtistPhoto, lookupArtistPhoto, subscribeArtistPhotos } from '../metadata'
import { isRewindDue, markRewindViewed, RewindModal } from './RewindModal'
import { SHELF_PREFIX } from './playlistCover'

const DEFAULT_REFRESH_MS = 3 * 86_400_000
const MIN_SHELF_SONGS = 5
const MAX_SHELF_SONGS = 12

function getShelvesRefreshMs(): number {
  const setting = getSetting('home_shelves_refresh')
  if (setting === '1 Day') return 86_400_000
  if (setting === '1 Week') return 7 * 86_400_000
  return DEFAULT_REFRESH_MS
}

export interface HomeArtistCard {
  name: string
  cover: string
  sub: string
}

export interface HomeShelf {
  id: string
  title: string
  subtitle?: string
  tracks: Track[]
}

/** Deterministic 32-bit hash & PRNG seeded by the 3-day window + shelf key so shelves stay stable for 3 days. */
function hashSeed(seed: number, salt: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function seededShuffle<T>(items: readonly T[], seed: number, salt: string): T[] {
  const out = [...items]
  let state = hashSeed(seed, salt) || 1
  const nextRand = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * §71.H1 — Top: Your Artists.
 * Picks the listener's most-played artists from stats.ts, falling back to artists with the most songs in the collection.
 */
export function pickYourArtists(tracks: Track[], listening: Listening, separators: string[], limit = 14): HomeArtistCard[] {
  const grouped = groupArtists(tracks, separators)
  if (!grouped.length) return []
  const byKey = new Map(grouped.map((g) => [g.name.toLowerCase(), g]))
  const out: HomeArtistCard[] = []
  const seen = new Set<string>()

  for (const top of topArtists(listening, tracks, limit, separators)) {
    const key = top.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const group = byKey.get(key)
    const photo = getCachedArtistPhoto(top.name)
    const cover = photo || group?.cover || ''
    out.push({
      name: group?.name ?? top.name,
      cover,
      sub: top.plays > 0 ? `${top.plays} ${top.plays === 1 ? 'play' : 'plays'}` : trackCount(group?.tracks.length ?? 1),
    })
    if (out.length >= limit) return out
  }

  const bySongCount = [...grouped].sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
  for (const g of bySongCount) {
    const key = g.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const photo = getCachedArtistPhoto(g.name)
    const cover = photo || g.cover || ''
    out.push({
      name: g.name,
      cover,
      sub: trackCount(g.tracks.length),
    })
    if (out.length >= limit) break
  }
  return out
}

const HIGH_ENERGY_RE = /rock|electronic|electro|dance|house|techno|trance|drum|dnb|bass|metal|punk|hip[\s-]?hop|rap|pop|synth|hyperpop|eurobeat|workout|party|club|disco|funk|upbeat|industrial|hardcore/i
const LATE_NIGHT_RE = /ambient|chill|lofi|lo-fi|soundtrack|ost|score|classical|jazz|piano|acoustic|ballad|dream|downtempo|shoegaze|post[\s-]?rock|sleep|night|calm|instrumental|new age|folk|soul/i

/**
 * §71.H3 — 6–7 Dynamic Categorized Shelves (refreshes every 3 days).
 * Driven by real local listening statistics and library metadata, seeded by `Math.floor(now / (3 * 86400_000))`.
 * Every shown shelf has at least 5 songs (when the library has >= 5 songs), backfilling deterministically from
 * the library using the 3-day seed when listening stats are sparse on a fresh install.
 */
export function buildHomeShelves(tracks: Track[], listening: Listening, now = Date.now()): HomeShelf[] {
  if (!tracks.length) return []
  const refreshMs = getShelvesRefreshMs()
  const periodSeed = Math.floor(now / refreshMs)
  const minCount = Math.min(MIN_SHELF_SONGS, tracks.length)

  // Prefer tracks with covers first in backfill pools so shelves look vibrant, while still including all tracks
  const withCoversFirst = (list: Track[]) => [
    ...list.filter((t) => Boolean(t.cover)),
    ...list.filter((t) => !t.cover),
  ]

  const recentlyAdded = [...tracks].sort((a, b) => b.added - a.added || a.title.localeCompare(b.title))
  const unplayedPool = seededShuffle(
    tracks.filter((t) => (listening.songs[t.id]?.plays ?? 0) === 0),
    periodSeed,
    'unplayed-pool',
  )
  const generalPool = seededShuffle(withCoversFirst(tracks), periodSeed, 'general-pool')

  const globalUseCount = new Map<string, number>()
  const markUsed = (list: Track[]) => {
    for (const t of list) globalUseCount.set(t.id, (globalUseCount.get(t.id) ?? 0) + 1)
  }

  const fillShelf = (primary: Track[], salt: string, fallbackPools: Track[][]): Track[] => {
    const picked: Track[] = []
    const ids = new Set<string>()
    const add = (t: Track) => {
      if (ids.has(t.id) || picked.length >= MAX_SHELF_SONGS) return
      ids.add(t.id)
      picked.push(t)
    }
    for (const t of primary) add(t)

    if (picked.length < MAX_SHELF_SONGS) {
      for (const pool of fallbackPools) {
        const rotated = seededShuffle(pool, periodSeed, salt)
        // Prefer tracks not yet used on earlier shelves so all 6-7 shelves stay distinct
        rotated.sort((a, b) => (globalUseCount.get(a.id) ?? 0) - (globalUseCount.get(b.id) ?? 0))
        for (const t of rotated) {
          if (picked.length >= Math.max(minCount, 10)) break
          add(t)
        }
        if (picked.length >= Math.max(minCount, 10)) break
      }
    }
    markUsed(picked)
    return picked
  }

  // 1. Most Listened Songs (all-time top tracks by plays / heard seconds)
  const mostListenedPrimary = topSongs(listening, tracks, MAX_SHELF_SONGS).map((x) => x.track)
  const mostListened = fillShelf(mostListenedPrimary, 'most-listened', [withCoversFirst(recentlyAdded), generalPool])

  // 2. Haven't Listened in a While (played before, lastPlayed > 30 days ago, or older plays)
  const thirtyDaysAgo = now - 30 * 86_400_000
  const stalePlayed = tracks
    .filter((t) => {
      const s = listening.songs[t.id]
      return s && s.plays > 0 && s.last > 0 && s.last < thirtyDaysAgo
    })
    .sort((a, b) => (listening.songs[a.id]?.last ?? 0) - (listening.songs[b.id]?.last ?? 0))
  const olderPlayed = tracks
    .filter((t) => (listening.songs[t.id]?.plays ?? 0) > 0)
    .sort((a, b) => (listening.songs[a.id]?.last ?? 0) - (listening.songs[b.id]?.last ?? 0))
  const olderAdditions = [...tracks].sort((a, b) => a.added - b.added)
  const haventListened = fillShelf(
    [...stalePlayed, ...olderPlayed],
    'havent-listened',
    [seededShuffle(olderAdditions, periodSeed, 'older-additions'), unplayedPool, generalPool],
  )

  // 3. On Repeat Lately (played in the last 14 days / recent heavy rotation)
  const fourteenDaysAgo = now - 14 * 86_400_000
  const recentCounts = new Map<string, number>()
  for (const h of listening.history) {
    if (h.at >= fourteenDaysAgo) recentCounts.set(h.id, (recentCounts.get(h.id) ?? 0) + 1)
  }
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const onRepeatPrimary: Track[] = [...recentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((t): t is Track => Boolean(t))
  const recentLastPlayed = tracks
    .filter((t) => (listening.songs[t.id]?.last ?? 0) >= fourteenDaysAgo)
    .sort((a, b) => (listening.songs[b.id]?.plays ?? 0) - (listening.songs[a.id]?.plays ?? 0))
  const onRepeat = fillShelf(
    [...onRepeatPrimary, ...recentLastPlayed],
    'on-repeat',
    [mostListenedPrimary, generalPool],
  )

  // 4. Driving / High-Energy Music (upbeat genres or high play-through completion rate)
  const energeticMatches = seededShuffle(
    tracks.filter((t) => {
      const s = listening.songs[t.id]
      const highCompletion = s && s.plays >= 2 && s.plays > s.skips * 2
      const energeticMeta = HIGH_ENERGY_RE.test(`${t.genre} ${t.title} ${t.album} ${t.artist}`)
      const punchyTempo = !LATE_NIGHT_RE.test(`${t.genre} ${t.album}`) && t.sec >= 130 && t.sec <= 260 && t.kbps >= 250
      return Boolean(highCompletion || energeticMeta || punchyTempo)
    }),
    periodSeed,
    'high-energy-primary',
  )
  const highEnergy = fillShelf(energeticMatches, 'high-energy', [generalPool])

  // 5. Late-Night Listens (tracks played after 22:00 / before 04:00, or ambient/chill/soundtrack vibes)
  const nightHistoryIds = new Set<string>()
  for (const h of listening.history) {
    const hour = new Date(h.at).getHours()
    if (hour >= 22 || hour < 4) nightHistoryIds.add(h.id)
  }
  const lateNightPrimary = seededShuffle(
    tracks.filter((t) => {
      if (nightHistoryIds.has(t.id)) return true
      if (LATE_NIGHT_RE.test(`${t.genre} ${t.title} ${t.album} ${t.folder}`)) return true
      return t.sec >= 240 && !HIGH_ENERGY_RE.test(t.genre)
    }),
    periodSeed,
    'late-night-primary',
  )
  const lateNight = fillShelf(lateNightPrimary, 'late-night', [generalPool])

  // 6. Recently Added (newest additions to the library, with deterministic 3-day window rotation among top batch)
  const newestBatch = recentlyAdded.slice(0, Math.max(MAX_SHELF_SONGS, 24))
  const recentlyAddedShelf = fillShelf(
    [...newestBatch.slice(0, 6), ...seededShuffle(newestBatch.slice(6), periodSeed, 'recent-tail')],
    'recently-added',
    [recentlyAdded, generalPool],
  )

  // 7. Forgotten Gems / Never Played Yet (0 plays in stats, seeded by the 3-day window)
  const forgottenGems = fillShelf(unplayedPool, 'forgotten-gems', [olderAdditions, generalPool])

  // 8. Vocal & Melodic (ballad, vocaloid, acoustic, vocal-centric tracks)
  const VOCAL_RE = /vocal|ballad|acoustic|pop|melodic|piano|r&b|soul|folk|vocaloid|hatsune|miku|gumi|luka|rin|len|choral/i
  const vocalPrimary = seededShuffle(
    tracks.filter((t) => VOCAL_RE.test(`${t.genre} ${t.title} ${t.artist}`)),
    periodSeed,
    'vocal-primary',
  )
  const vocalMelodic = fillShelf(vocalPrimary, 'vocal-melodic', [generalPool])

  // 9. Audiophile & Acoustic Test (FLAC/WAV/Hi-Res or classical/jazz/acoustic)
  const AUDIOPHILE_RE = /acoustic|classical|jazz|audiophile|orchestral|instrumental|soundtrack/i
  const audiophilePrimary = seededShuffle(
    tracks.filter((t) => (t.bits >= 24 || t.rate >= 88200 || t.format === 'FLAC' || t.format === 'WAV') || AUDIOPHILE_RE.test(`${t.genre} ${t.album}`)),
    periodSeed,
    'audiophile-primary',
  )
  const audiophileTest = fillShelf(audiophilePrimary, 'audiophile-test', [generalPool])

  // 10. Bass & Beat Drive (punchy electronic, synthwave, EDM, hip-hop)
  const BASS_RE = /bass|beat|edm|house|techno|dnb|drum|dubstep|trap|hip[\s-]?hop|synthwave|electronic/i
  const bassPrimary = seededShuffle(
    tracks.filter((t) => BASS_RE.test(`${t.genre} ${t.title}`) || (t.sec >= 120 && t.kbps >= 300)),
    periodSeed,
    'bass-beat-primary',
  )
  const bassBeatDrive = fillShelf(bassPrimary, 'bass-beat', [generalPool])

  // 11. Quick Hits / Bite-Sized (punchy songs under 3 minutes)
  const quickPrimary = seededShuffle(
    tracks.filter((t) => t.sec > 0 && t.sec <= 180),
    periodSeed,
    'quick-hits-primary',
  )
  const quickHits = fillShelf(quickPrimary, 'quick-hits', [generalPool])

  // 12. Long Journeys / Epics (songs over 5 minutes)
  const epicsPrimary = seededShuffle(
    tracks.filter((t) => t.sec >= 300),
    periodSeed,
    'epics-primary',
  )
  const epics = fillShelf(epicsPrimary, 'epics', [generalPool])

  const candidateShelves: HomeShelf[] = [
    { id: 'most-listened', title: 'Most Listened Songs', tracks: mostListened },
    { id: 'on-repeat', title: 'On Repeat Lately', tracks: onRepeat },
    { id: 'havent-listened', title: "Haven't Listened in a While", tracks: haventListened },
    { id: 'high-energy', title: 'Driving / High-Energy Music', tracks: highEnergy },
    { id: 'vocal-melodic', title: 'Vocal & Melodic', tracks: vocalMelodic },
    { id: 'audiophile-test', title: 'Audiophile & Acoustic Test', tracks: audiophileTest },
    { id: 'bass-beat', title: 'Bass & Beat Drive', tracks: bassBeatDrive },
    { id: 'quick-hits', title: 'Quick Hits / Bite-Sized', tracks: quickHits },
    { id: 'epics', title: 'Long Journeys / Epics', tracks: epics },
    { id: 'late-night', title: 'Late-Night Listens', tracks: lateNight },
    { id: 'recently-added', title: 'Recently Added', tracks: recentlyAddedShelf },
    { id: 'forgotten-gems', title: 'Forgotten Gems / Never Played Yet', tracks: forgottenGems },
  ]

  return candidateShelves.filter((s) => s.tracks.length >= minCount).slice(0, 6)
}

export function HomePage() {
  const { play, go, push } = useShell()
  useSettings()
  const tracks = useLibrary()
  const listening = useListening()
  const separators = useArtistSeparators()
  const phone = usePhone()
  const [searchInput, setSearchInput] = useState('')
  const [rewindOpen, setRewindOpen] = useState(false)
  const [rewindDismissed, setRewindDismissed] = useState(false)
  const [, setPhotoVer] = useState(0)

  useEffect(() => {
    return subscribeArtistPhotos(() => setPhotoVer((v) => v + 1))
  }, [])

  const artists = useMemo(
    () => pickYourArtists(tracks, listening, separators),
    [tracks, listening, separators],
  )

  // Look up online photos for top artists missing an avatar
  useEffect(() => {
    for (const a of artists.slice(0, 10)) {
      if (!getCachedArtistPhoto(a.name)) {
        void lookupArtistPhoto(a.name)
      }
    }
  }, [artists])

  const shelves = useMemo(
    () => buildHomeShelves(tracks, listening),
    [tracks, listening],
  )
  const showRewind = useMemo(() => !rewindDismissed && isRewindDue(listening), [listening, rewindDismissed])

  const triggerSearch = (q: string) => {
    openLibrarySearch(q)
    go({ page: 'library' })
  }

  return (
    <div className="ms-scroll">
      <div className="ms-page ms-home">
        <h1 className="ms-h1">Home</h1>
        <form
          className="ms-search"
          onSubmit={(e) => {
            e.preventDefault()
            triggerSearch(searchInput)
          }}
        >
          <Icon name="search" />
          <input
            placeholder="Search songs, artists, albums..."
            aria-label="Search music"
            value={searchInput}
            onChange={(e) => {
              const next = e.target.value
              setSearchInput(next)
              if (next.trim().length > 0) {
                triggerSearch(next)
              }
            }}
          />
          <button
            type="button"
            className="ms-icon-btn small"
            aria-label="Search in library"
            title="Search in library"
            onClick={() => triggerSearch(searchInput)}
          >
            <Icon name="arrow_forward" size={18} />
          </button>
        </form>

        {showRewind && (
          <button
            type="button"
            className="ms-rewind"
            onClick={() => {
              markRewindViewed()
              setRewindDismissed(true)
              setRewindOpen(true)
            }}
          >
            <span className="ms-rewind-badge" style={{ clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' }}>
              <Icon name="auto_awesome" fill size={24} />
            </span>
            <div className="grow">
              <b>Your Rewind is Ready</b>
              <p>Relive your top music, minutes, and stats</p>
            </div>
            <Icon name="chevron_right" />
          </button>
        )}

        {rewindOpen && (
          <RewindModal
            onClose={() => {
              markRewindViewed()
              setRewindDismissed(true)
              setRewindOpen(false)
            }}
          />
        )}

        {artists.length > 0 && (
          <section>
            <h2 className="ms-h2">Your Artists</h2>
            <Shelf>
              {artists.map((a) => (
                <article
                  className="ms-shelf-item round"
                  key={a.name}
                  onClick={() => push({ page: 'artist', name: a.name })}
                >
                  <Cover id={a.cover} alt={a.name} />
                  <div className="ms-card-title">{a.name}</div>
                  <div className="ms-card-sub">{a.sub}</div>
                </article>
              ))}
            </Shelf>
          </section>
        )}

        {shelves.map((shelf) => (
          <ShelfRow key={shelf.id} title={shelf.title} tracks={shelf.tracks} onPlay={(t) => play(t, shelf.tracks)} onOpen={() => push({ page: 'playlist', id: SHELF_PREFIX + shelf.id })} />
        ))}

        {phone && (
          <button type="button" className="ms-home-db" onClick={() => go({ page: 'database' })}>
            <Icon name="database" size={32} />
            <span className="grow"><b>Database</b><small>IEMs, headphones, reviews and measurements</small></span>
            <Icon name="chevron_right" />
          </button>
        )}
      </div>
    </div>
  )
}

function ShelfRow({ title, tracks, onPlay, onOpen }: { title: string; tracks: Track[]; onPlay: (t: Track) => void; onOpen: () => void }) {
  return (
    <section>
      <h2 className="ms-h2"><button type="button" className="ms-h2-link" onClick={onOpen}>{title}<Icon name="chevron_right" size={22} /></button></h2>
      <Shelf>
        {tracks.map((t) => (
          <article className="ms-shelf-item" key={t.id} onClick={() => onPlay(t)}>
            <Cover id={t.cover} alt="" genre={t.genre} speciality={t.category} title={t.title} />
            <div className="ms-card-title">{t.title}</div>
            <div className="ms-card-sub">{t.artist || 'Unknown Artist'}</div>
          </article>
        ))}
      </Shelf>
    </section>
  )
}

/** A sideways row. On PC a mouse can drag it (a drag isn't a click) and ‹ › buttons page it when it runs past the edge. */
function Shelf({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const [ends, setEnds] = useState({ left: false, right: false })
  const update = () => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEnds((e) => (e.left === left && e.right === right ? e : { left, right }))
  }
  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const page = (dir: number) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  return (
    <div className="ms-shelf-wrap">
      <div
        ref={ref}
        className="ms-shelf"
        onScroll={update}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          drag.current = e.pointerType === 'mouse' && e.button === 0 ? { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false } : null
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || !(e.buttons & 1)) return
          const dx = e.clientX - d.x
          if (!d.moved && Math.abs(dx) < 6) return
          if (!d.moved) {
            d.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          e.currentTarget.scrollLeft = d.left - dx
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.stopPropagation()
            e.preventDefault()
          }
          drag.current = null
        }}
      >
        {children}
      </div>
      {ends.left && <button type="button" className="ms-shelf-arrow left" aria-label="Scroll left" onClick={() => page(-1)}><Icon name="chevron_left" /></button>}
      {ends.right && <button type="button" className="ms-shelf-arrow right" aria-label="Scroll right" onClick={() => page(1)}><Icon name="chevron_right" /></button>}
    </div>
  )
}

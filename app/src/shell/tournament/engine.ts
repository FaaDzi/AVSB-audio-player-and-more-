// The tournament's audio side in the new UI (§65): the old match engine (ABPlayer, prepareMatch, deviceReference)
// fed from the Database catalog and the user's own Library instead of the old built-in song list.
import { useEffect, useState } from 'react'
import { frDb, type Iem } from '../../audio/data'
import { ABPlayer } from '../../audio/player'
import { airMode } from '../../audio/filter'
import { trebleDetail } from '../../eq/trebleDetail'
import type { BackSpace } from '../../audio/backSpace'
import { deviceReference, loadRefs, type RefData } from '../../audio/reference'
import type { Catalog } from '../../data/catalog'
import { earGainCurve, loadFit } from '../../fit/fit'
import type { Preferences } from '../../prefs/types'
import { clipCandidates, sliceBuffer } from '../../songs/clip'
import type { HeardBy } from '../../songs/rounds'
import type { RoundAudio } from '../../match/MatchView'
import { audioUrl, findMatchingLocalTrack, roundLowData } from '../engine'
import { canPlay, isPcTrack, type Track } from '../library'
import { onMobileData } from '../linkClient'
import { logLine } from '../logs'
import { likedWeight } from '../favorites'
import { getSetting } from '../settings/store'

let player: ABPlayer | null = null
/** Clip sections found per song this session, so a repeat pick doesn't analyse it again. */
const sectionCache = new Map<string, [number, number][]>()
/** One A/B player for every match, made on first use (it opens an AudioContext). */
export const matchPlayer = () => (player ??= new ABPlayer())

let refs: RefData | null = null
let refsLoading: Promise<RefData> | null = null
/** The averaged measurements, loaded once (useRefs outside React). */
export const loadRefsOnce = () => (refsLoading ??= loadRefs().then((d) => (refs = d), () => (refs = {})))
/** Averaged measurements per model, for simulating the device you listen on. */
export function useRefs(): RefData | null {
  const [r, setR] = useState(refs)
  useEffect(() => {
    if (r) return
    let live = true
    void loadRefsOnce().then((d) => live && setR(d))
    return () => {
      live = false
    }
  }, [r])
  return r
}

/** The device FR every simulation is built against (your device, or the typical curve when none is set). */
export function referenceFor(catalog: Catalog, r: RefData, prefs: Preferences): Float64Array {
  return deviceReference({ all: catalog, baseData: catalog.data, refs: r, prefs, fit: loadFit() })
}

/** A candidate's FR as matches use it: an over-ear heard through in-ears gets your ear-gain correction. */
export function candidateFr(catalog: Catalog, iem: Iem, prefs: Preferences): Float64Array {
  const db = frDb(catalog.data, iem.fr)
  const fit = loadFit()
  const device = prefs.currentId ? catalog.byId.get(prefs.currentId) : undefined
  const inEar = prefs.mode === 'iem' && prefs.listeningOn !== 'headphones' && !device?.id.startsWith('hp-')
  if (!fit.earGainDb || !inEar || !iem.id.startsWith('hp-')) return db
  const bump = earGainCurve(catalog.data.grid, fit.earGainDb)
  return db.map((v, i) => v + bump[i])
}

/**
 * Full treble detail for a match only when both contenders would get it on their own (same kind as your device,
 * measurements agreeing in the treble): eq/trebleDetail.ts, the HD 600 → HE600 lesson. Otherwise the air is held back
 * for both, so neither side is favoured.
 */
export function matchFullTreble(r: RefData, prefs: Preferences, ids: [string, string]): boolean {
  const spread = (id: string | null) => (id ? r[id]?.spread ?? null : null)
  return ids.every((id) => trebleDetail(airMode(), prefs.currentId, id, spread(prefs.currentId), spread(id)) === 'full')
}

/**
 * The sense of space for an entrant (§67): an open or semi-open headphone heard on in-ears or closed-back
 * headphones gets the CanOpener open-back space; everything else stays dry, unless forced on by user settings.
 */
export function backSpaceFor(catalog: Catalog, iem: Iem, prefs: Preferences): BackSpace | null {
  const mode = getSetting('tourney_crossfeed')
  if (mode === 'Off (Pure Monaural EQ)') return null
  if (mode === 'Always On (All matches)') return 'open'

  // Default Auto:
  const device = prefs.currentId ? catalog.byId.get(prefs.currentId) : undefined
  const wearsOpenBack = device?.back === 'open' || device?.back === 'semi-open'
  if (wearsOpenBack) return null // physical headphones are already open
  const entrantIsOpen = iem.id.startsWith('hp-') && (iem.back === 'open' || iem.back === 'semi-open')
  return entrantIsOpen ? 'open' : 'closed'
}

/**
 * Songs for a match's rounds, from the user's Library (`pool`): each round a different song, preferring ones neither
 * entrant has been heard on yet, cut to one of its liveliest 40 s sections, chosen at random. The next round's song decodes while the current one plays.
 */
export function libraryRounds(opts: { pool: Track[]; heardBy: HeardBy; entrants: [string, string]; bestOf?: number }) {
  const ctx = matchPlayer().ctx
  const usable = opts.pool.filter(canPlay)
  const used: Track[] = []
  /** Rounds that were actually played: a prefetched song the match never reached isn't heard (audit). */
  const played = new Set<number>()
  const loading = new Map<number, Promise<RoundAudio>>()
  /** Per round: bytes in so far and the size when known, for "Loading the song… 40%". */
  const progress = new Map<number, { got: number; total: number }>()
  const aborts = new Map<number, AbortController>()

  const pick = (skip: Set<string>): Track => {
    const heard = new Set(opts.entrants.flatMap((id) => opts.heardBy[id] ?? []))
    const fresh = usable.filter((t) => !skip.has(t.id) && !used.includes(t))
    const unheard = fresh.filter((t) => !heard.has(t.id))
    let from = unheard.length ? unheard : fresh.length ? fresh : usable
    // §105 D: on mobile data a song already on the phone starts at once; PC songs only when there's none left
    if (onMobileData()) {
      const here = from.filter((t) => !isPcTrack(t) || findMatchingLocalTrack(t))
      if (here.length) from = here
    }
    const weights = from.map((t) => likedWeight(t.id))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = Math.random() * total
    for (let i = 0; i < from.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return from[i]
    }
    return from[from.length - 1]
  }

  // as in the old app: each song's liveliest sections are found once, and each round plays one of them at random
  const load = async (round: number, song: Track): Promise<RoundAudio> => {
    const t = (isPcTrack(song) && findMatchingLocalTrack(song)) || song
    const low = roundLowData(t)
    const control = new AbortController()
    aborts.set(round, control)
    const began = performance.now()
    const res = await fetch(audioUrl(t, low), { signal: control.signal })
    if (!res.ok) throw new Error(`couldn't read ${t.title}`)
    const bytes = await readAll(res, (got, total) => progress.set(round, { got, total }))
    const mb = (bytes.byteLength / 1e6).toFixed(1) // decoding empties the buffer
    const buf = await ctx.decodeAudioData(bytes)
    logLine('INFO', 'Player', `Tournament round ${round + 1}: "${t.title}" ready after ${Math.round(performance.now() - began)} ms (${isPcTrack(t) ? (low ? 'PC, Low Data' : 'PC') : 'on the phone'}, ${mb} MB)`)
    let sections = sectionCache.get(t.id)
    if (!sections) {
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
      sections = clipCandidates(chans, buf.sampleRate, 'any')
      sectionCache.set(t.id, sections)
    }
    const [start, end] = sections[Math.floor(Math.random() * sections.length)] ?? [0, Math.min(buf.duration, 40)]
    return { buffer: sliceBuffer(ctx, buf, start, end), title: t.title, subtitle: t.artist }
  }

  const roundAt = (round: number, skip: Set<string> = new Set()) => {
    let p = loading.get(round)
    if (!p) {
      if (!usable.length) return Promise.reject(new Error('No playable songs in the chosen list'))
      const t = pick(skip)
      used[round] = t
      p = load(round, t)
      p.catch((e) => logLine('WARN', 'Player', `Tournament round ${round + 1}: "${t.title}" failed (${String(e?.message ?? e)})`))
      loading.set(round, p)
    }
    return p
  }

  return {
    /** Start decoding round 0 (the VS screen is the loading screen). */
    prefetch: () => roundAt(0),
    getRound: (round: number, attempt: number): Promise<RoundAudio> => {
      played.add(round)
      if (attempt > 0) {
        // the song failed or was skipped: pick another for this round
        const bad = used[round]
        loading.delete(round)
        aborts.get(round)?.abort()
        progress.delete(round)
        return roundAt(round, new Set(bad ? [bad.id] : []))
      }
      const p = roundAt(round)
      // Delay next round prefetch by 4s so current round establishes smooth, stutter-free playback first
      // nothing after the last round there can be
      if (round + 1 < (opts.bestOf ?? Infinity)) void p.then(() => {
        window.setTimeout(() => {
          void roundAt(round + 1).catch(() => {})
        }, 4000)
      })
      return p
    },
    /** How far this round's song has downloaded (total 0 when the size isn't known); null before it starts. */
    progress: (round: number): { got: number; total: number } | null => progress.get(round) ?? null,
    /** Record which songs each entrant has now been heard on, so later matches pick others. */
    commit: (heardBy: HeardBy): HeardBy => {
      const ids = used.filter((t, i) => t && played.has(i)).map((t) => t.id)
      const next = { ...heardBy }
      for (const e of opts.entrants) next[e] = [...new Set([...(next[e] ?? []), ...ids])]
      return next
    },
  }
}

/** The whole body, reporting bytes as they arrive (total 0 when the server didn't say: a live Low Data transcode). */
async function readAll(res: Response, onProgress: (got: number, total: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length') ?? 0) || 0
  const reader = res.body?.getReader()
  if (!reader) return res.arrayBuffer()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.byteLength
    onProgress(got, total)
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out.buffer
}

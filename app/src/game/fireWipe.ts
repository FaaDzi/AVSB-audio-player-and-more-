import { sfx, SAMPLES, type SampleName } from '../audio/sfx'
import { isReduceMotionEnabled } from './useStageInput'

/**
 * Full-screen transition wipes (§64): 9 colourful fluid bursts cut from Vecteezy's 4k_colorful_fluid_transition(_2).mov
 * by scripts/make_fluid_clips.py (black keyed to alpha, VP9). Any burst plays for any kind, picked at random and never
 * the same one twice in a row. Each covers the whole window for a moment; whatever changes underneath then is never
 * seen switching. `cover` is when that starts (s), the first frame with the whole screen covered, and `fill` is the
 * burst's average colour there, for the backing layer.
 *
 * The video lives on <body>, outside React, so it keeps playing while the screen under it
 * is replaced (VS intro → match). `ink` keeps the old fire shapes on black, for the screens that use it.
 */
export type WipeStyle = 'fluid' | 'ink'
/** `sound`: the whoosh matched to the burst's timing and feel; it's timed so its peak lands on `cover`. */
type Clip = { src: string; cover: number; fill: string; sound?: SampleName }
const FLUID: Clip[] = [
  { src: 'fx/fluid-1.webm', cover: 0.5, fill: 'rgb(148 204 224)', sound: 'swoosh-020' },
  { src: 'fx/fluid-2.webm', cover: 0.5, fill: 'rgb(240 179 163)', sound: 'swoosh-023' },
  { src: 'fx/fluid-3.webm', cover: 0.62, fill: 'rgb(161 174 231)', sound: 'swoosh-transition' },
  { src: 'fx/fluid-4.webm', cover: 1.04, fill: 'rgb(240 168 186)', sound: 'wind-riser' },
  { src: 'fx/fluid-5.webm', cover: 0.17, fill: 'rgb(234 88 207)', sound: 'swoosh-014' },
  { src: 'fx/fluid-6.webm', cover: 0.25, fill: 'rgb(224 199 186)', sound: 'swoosh-010' },
  { src: 'fx/fluid-7.webm', cover: 0.83, fill: 'rgb(146 200 234)', sound: 'air-swoosh' },
  { src: 'fx/fluid-8.webm', cover: 0.38, fill: 'rgb(166 190 190)', sound: 'swoosh-027' },
  { src: 'fx/fluid-9.webm', cover: 0.92, fill: 'rgb(152 170 216)', sound: 'swoosh-transition' },
]
const CLIPS: Record<WipeStyle, Clip[]> = {
  fluid: FLUID,
  ink: [
    { src: 'fx/fire-1.webm', cover: 0.42, fill: '#000000' },
    { src: 'fx/fire-2.webm', cover: 0.5, fill: '#000000' },
    { src: 'fx/fire-3.webm', cover: 0.36, fill: '#000000' },
  ],
}

/** A random index in [0, count), never `last` when there's a choice. */
export function pickClip(count: number, last: number, rand: () => number = Math.random): number {
  if (count <= 1) return 0
  const i = Math.floor(rand() * (count - (last >= 0 && last < count ? 1 : 0)))
  return last >= 0 && last < count && i >= last ? i + 1 : i
}
/** A clear 1×1 poster: without one, Android draws a grey "play" box until the first frame is up. */
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
/** How long the backing layer takes to fade once the burst clears (ms). */
const FILL_FADE_MS = 200
/** If a clip stalls or can't play, the screen still changes after this long (ms). */
const COVER_TIMEOUT_MS = 2500
/** Longest the burst holds at its cover point waiting for the new screen to paint (ms). */
const HOLD_MAX_MS = 1500
/** Painted frames without a DOM change that count as "the new screen has settled". */
const QUIET_FRAMES = 3
/** Minimum quiet wall-clock time (ms) so 144Hz–240Hz PC monitors don't release in 12ms before layout settles. */
const MIN_QUIET_MS = 48

const last: Record<WipeStyle, number> = { fluid: -1, ink: -1 }
let warmed = false

/** Fetch the clips into the cache ahead of the first wipe (call when a bracket screen opens). */
export function warmFireWipes() {
  if (warmed) return
  warmed = true
  for (const c of Object.values(CLIPS).flat()) void fetch(`${import.meta.env.BASE_URL}${c.src}`).catch(() => {})
  void sfx.warmSamples()
  // the VS screen's speed lines (about 2 MB each)
  for (const f of ['fx/vs-lines-h.webm', 'fx/vs-lines-v.webm']) void fetch(`${import.meta.env.BASE_URL}${f}`).catch(() => {})
}

/** Every kind, and both ends of a cross-kind match, draw from the same random bursts. */
export function wipeStyleFor(): WipeStyle {
  return 'fluid'
}

/**
 * Play the next burst and call `onCover` once it fills the screen (at once with reduce motion
 * on, or when the clip can't play). The burst then clears off whatever `onCover` put there.
 * `skip` (s) starts the clip part-way in, so the burst covers sooner (a tap should feel instant).
 */
export function playFireWipe(onCover: () => void, skip = 0, style: WipeStyle = 'fluid') {
  let covered = false
  const cover = () => {
    if (covered) return
    covered = true
    onCover()
  }
  if (isReduceMotionEnabled()) return cover()

  const set = CLIPS[style]
  last[style] = pickClip(set.length, last[style])
  const clip = set[last[style]]
  const v = document.createElement('video')
  v.className = style === 'ink' ? 'fire-wipe ink' : 'fire-wipe'
  v.src = `${import.meta.env.BASE_URL}${clip.src}`
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.poster = NO_POSTER
  // never skip past the cover point: a short clip would cut before it is seen
  if (skip) v.currentTime = Math.min(skip, clip.cover * 0.6)
  v.setAttribute('aria-hidden', 'true')
  // the backing layer: a flat sheet of the burst's colour under it while the screen swaps, so a late
  // frame, a frame the phone drops, or a new screen still drawing can't show through a gap
  const fill = document.createElement('div')
  fill.className = 'fire-wipe-fill'
  fill.style.background = clip.fill
  fill.setAttribute('aria-hidden', 'true')
  const remove = () => {
    v.remove()
    fill.remove()
  }
  const fail = () => {
    cover()
    remove()
  }
  v.addEventListener('ended', remove)
  v.addEventListener('error', fail)
  const timer = window.setTimeout(cover, COVER_TIMEOUT_MS)

  // At the cover point: hold on a gently moving cover (slow-motion of the covered frames), swap the screen
  // underneath, and clear only once the new screen has settled (no element added or removed for QUIET_FRAMES
  // painted frames AND MIN_QUIET_MS). Some bursts cover fully for just ~2 frames, and screens draw in steps
  // (the VS intro: a shell, then its contents a frame later), so a fixed wait let the later steps be seen
  // arriving through the first gaps.
  const atCover = () => {
    clearTimeout(timer)
    document.body.insertBefore(fill, v)
    try {
      v.playbackRate = 0.15
    } catch {
      /* ignore */
    }
    const holdMin = Math.max(0, clip.cover - 0.08)
    const holdMax = clip.cover + 0.08
    let quiet = 0
    let quietSince = performance.now()
    const seen = new MutationObserver(() => {
      quiet = 0
      quietSince = performance.now()
    })
    // elements coming and going only: animated screens change styles/attributes every frame
    seen.observe(document.body, { subtree: true, childList: true })
    cover()
    const resume = window.setTimeout(() => release(), HOLD_MAX_MS)
    const settle = () => {
      if (released) return
      if (v.currentTime >= holdMax) {
        try {
          v.currentTime = holdMin
        } catch {
          /* ignore */
        }
      }
      if (++quiet >= QUIET_FRAMES && performance.now() - quietSince >= MIN_QUIET_MS) {
        clearTimeout(resume)
        return release()
      }
      requestAnimationFrame(settle)
    }
    requestAnimationFrame(settle)
    release = () => {
      if (released) return
      released = true
      seen.disconnect()
      fill.style.transition = `opacity ${FILL_FADE_MS}ms ease-out`
      fill.style.opacity = '0'
      setTimeout(() => fill.remove(), FILL_FADE_MS + 50)
      try {
        v.playbackRate = 1
      } catch {
        /* ignore */
      }
      if (v.paused) v.play().catch(remove)
    }
  }
  let released = false
  let release = () => {}
  // time the cut off the frame on screen where the browser says which one that is; else poll the
  // clock each frame ('timeupdate' only fires every ~250 ms, too coarse for the cut)
  type FrameCb = (now: number, meta: { mediaTime: number }) => void
  const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCb) => number }).requestVideoFrameCallback?.bind(v)
  const watch = () => {
    if (covered) return clearTimeout(timer)
    if (v.currentTime >= clip.cover) return atCover()
    if (v.isConnected) requestAnimationFrame(watch)
  }
  const onFrame: FrameCb = (_, meta) => {
    if (covered) return clearTimeout(timer)
    if (meta.mediaTime >= clip.cover) return atCover()
    if (v.isConnected) rvfc!(onFrame)
  }
  document.body.appendChild(v)
  v.play().then(() => {
    if (clip.sound) sfx.playSample(clip.sound, 0.7, clip.cover - v.currentTime - SAMPLES[clip.sound].peak)
    if (rvfc) rvfc(onFrame)
    else requestAnimationFrame(watch)
  }, fail)
}

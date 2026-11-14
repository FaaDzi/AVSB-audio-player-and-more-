/**
 * Camera head tracking (plan §32 phases 4–5): the webcam on PC, the front camera on Android with
 * the phone propped up facing you. MediaPipe Face Landmarker gives the face transform, pose.ts
 * turns it into smoothed yaw/pitch/roll. Frames never leave the device and are never drawn or kept.
 */
import type { HeadPose, HeadTracker } from '../spatial/types'
import { loadSpatial, updateSpatial } from '../spatial/settings'
import { clampHeadCm } from '../spatial/headSize'
import type { Detection, Landmarker } from './landmarker'
import { PoseProcessor, headWidthCm, matrixToAngles, median } from './pose'

/** Frames of head-width estimates gathered (facing the screen) before the camera sets your head size. */
const WIDTH_FRAMES = 60

/** getUserMedia frames are unmirrored on desktop Chromium and Android WebView alike. */
const MIRRORED = false
/** Detection rate cap: 30 fps is what the face model and a webcam manage anyway. */
const FRAME_MS = 1000 / 30

export interface CameraTracker extends HeadTracker {
  /** Whether the last processed frame had a face in it. */
  readonly faceVisible: boolean
}

/** A readable message for a getUserMedia failure. */
export function cameraError(e: unknown): Error {
  const name = e instanceof DOMException || e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new Error('Camera permission denied. Allow the camera for this app, then try again.')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return new Error('No camera found.')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new Error('The camera is busy in another app, or turned off in the system privacy settings.')
  }
  return new Error(`Camera unavailable (${e instanceof Error ? e.message : String(e)}).`)
}

const modelBase = () => new URL('mediapipe/', document.baseURI).href

/** Runs detection in a worker; null if the worker can't load the model (then the main thread tries). */
function startWorker(base: string): Promise<Worker | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./camera.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(null)
      return
    }
    const done = (w: Worker | null) => {
      clearTimeout(timer)
      worker.onmessage = null
      worker.onerror = null
      if (!w) worker.terminate()
      resolve(w)
    }
    const timer = setTimeout(() => done(null), 30000)
    worker.onerror = () => done(null)
    worker.onmessage = (e: MessageEvent<{ type: string }>) => done(e.data.type === 'ready' ? worker : null)
    worker.postMessage({ type: 'init', base })
  })
}

export function createCameraTracker(kind: 'webcam' | 'phone-camera'): CameraTracker {
  const listeners = new Set<(p: HeadPose) => void>()
  const proc = new PoseProcessor()
  let gen = 0
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null
  let worker: Worker | null = null
  let lm: Landmarker | null = null
  let busy = false
  let lastSent = 0
  let lastT = 0
  let faceVisible = false
  let cancelFrame: (() => void) | null = null

  const emit = (p: HeadPose) => {
    for (const cb of [...listeners]) cb(p)
  }
  // head size for the virtual speakers, measured once per start unless you've set it yourself (spatial/headSize.ts)
  let widths: number[] = []
  const measure = (d: Detection, yaw: number) => {
    if (widths.length >= WIDTH_FRAMES || loadSpatial().headCmBy === 'you') return
    const w = headWidthCm(d.xs.map((x) => ({ x })), yaw)
    if (w === null) return
    widths.push(w)
    if (widths.length === WIDTH_FRAMES) updateSpatial({ headCm: Math.round(clampHeadCm(median(widths)) * 10) / 10, headCmBy: 'camera' })
  }
  const handle = (d: Detection | null, t: number) => {
    faceVisible = !!d
    if (!d) return emit(proc.lost(t))
    const a = matrixToAngles(d.m, MIRRORED)
    measure(d, a.yaw)
    emit(proc.face(a, t))
  }

  const release = () => {
    cancelFrame?.()
    cancelFrame = null
    stream?.getTracks().forEach((tr) => tr.stop())
    stream = null
    if (video) {
      video.pause()
      video.srcObject = null
      video.remove()
      video = null
    }
    worker?.terminate()
    worker = null
    lm?.close()
    lm = null
    busy = false
    faceVisible = false
  }

  /** One detection per new camera frame, at most 30 a second, never two in flight. */
  const loop = (v: HTMLVideoElement, my: number) => {
    const tick = () => {
      if (my !== gen) return
      schedule()
      const now = performance.now()
      if (busy || now - lastSent < FRAME_MS - 2 || v.readyState < 2) return
      lastSent = now
      const t = Math.max(now, lastT + 1)
      lastT = t
      if (worker) {
        const w = worker
        busy = true
        createImageBitmap(v)
          .then((bitmap) => {
            if (my !== gen) bitmap.close()
            else w.postMessage({ type: 'frame', bitmap, t }, [bitmap])
          })
          .catch(() => {
            busy = false
          })
      } else if (lm) {
        let d: Detection | null = null
        try {
          d = lm.detect(v, t)
        } catch {
          d = null
        }
        handle(d, t)
      }
    }
    const schedule = () => {
      if ('requestVideoFrameCallback' in v) {
        const id = v.requestVideoFrameCallback(tick)
        cancelFrame = () => v.cancelVideoFrameCallback(id)
      } else {
        const id = requestAnimationFrame(tick)
        cancelFrame = () => cancelAnimationFrame(id)
      }
    }
    schedule()
  }

  return {
    kind,
    get faceVisible() {
      return faceVisible
    },

    async start() {
      release()
      widths = []
      const my = ++gen
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera available here.')
      const base = modelBase()
      const model = startWorker(base)
      let s: MediaStream
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        })
      } catch (e) {
        void model.then((w) => w?.terminate())
        throw cameraError(e)
      }
      if (my !== gen) {
        s.getTracks().forEach((tr) => tr.stop())
        void model.then((w) => w?.terminate())
        return
      }
      stream = s
      try {
        const w = await model
        if (my !== gen) {
          w?.terminate()
          return
        }
        if (w) {
          worker = w
          w.onmessage = (e: MessageEvent<{ type: string; t: number; d: Detection | null }>) => {
            if (my !== gen || e.data.type !== 'pose') return
            busy = false
            handle(e.data.d, e.data.t)
          }
          w.onerror = () => {
            busy = false
          }
        } else {
          const { createLandmarker } = await import('./landmarker')
          const l = await createLandmarker(base)
          if (my !== gen) {
            l.close()
            return
          }
          lm = l
        }
        const v = document.createElement('video')
        v.muted = true
        v.playsInline = true
        v.setAttribute('aria-hidden', 'true')
        // in the page (some WebViews don't decode detached videos) but invisible: frames are never shown
        v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
        v.srcObject = s
        document.body.appendChild(v)
        video = v
        await v.play()
        if (my !== gen) return
        loop(v, my)
      } catch (e) {
        if (my === gen) release()
        throw e instanceof Error && e.message.startsWith('Head tracking') ? e : new Error(`Camera failed to start (${e instanceof Error ? e.message : String(e)}).`)
      }
    },

    stop() {
      gen++
      release()
    },

    recenter() {
      proc.recenter()
    },

    onPose(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

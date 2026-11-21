/**
 * Starts and stops camera head tracking from the saved SpatialSettings and feeds the head yaw into
 * every registered SpatialStage (plan §32 phases 4–5). Tracking only runs while headTracking is on,
 * the spatial mode has virtual speakers ('speakers' or 'room') and the app is visible.
 */
import { useSyncExternalStore } from 'react'
import { loadSpatial, onSpatialChange, updateSpatial } from '../spatial/settings'
import type { HeadTracking, SpatialSettings, SpatialStageApi } from '../spatial/types'
import { createCameraTracker, type CameraTracker } from './camera'
import { createBudsTracker, type BudsTracker } from './buds'
import { STILL_DEG } from './budsMath'

/** 360 mode: the front only follows a turn bigger than this (a chair, not a glance at an instrument). */
const BIG_TURN_DEG = 60
import { clampYaw, wrap } from './pose'

export interface HeadTrackState {
  status: 'off' | 'starting' | 'on'
  kind: HeadTracking
  /** Clamped yaw in degrees (+ = turned left), as sent to the stages. */
  yaw: number
  /** A face is in view (false while it is lost and the speakers ease back to the front). */
  face: boolean
  /** Why the last start failed; tracking is switched off when it does. */
  error: string | null
}

type StageList = () => Pick<SpatialStageApi, 'setHeadYaw'>[]

let state: HeadTrackState = { status: 'off', kind: 'off', yaw: 0, face: false, error: null }
const stateListeners = new Set<() => void>()
const providers = new Set<StageList>()
let tracker: CameraTracker | BudsTracker | null = null
let unPose: (() => void) | null = null
let unSpatial: (() => void) | null = null
let beforeStart: ((kind: Exclude<HeadTracking, 'off'>) => Promise<void>) | null = null

function setState(patch: Partial<HeadTrackState>) {
  state = { ...state, ...patch }
  for (const cb of [...stateListeners]) cb()
}

function sendYaw(yaw: number) {
  for (const list of providers) for (const st of list()) st.setHeadYaw(yaw)
}

const wanted = (s: SpatialSettings) =>
  s.headTracking !== 'off' && (s.mode === 'speakers' || s.mode === 'room' || s.mode === '360') && providers.size > 0 && !document.hidden

function stopTracker() {
  unPose?.()
  unPose = null
  tracker?.stop()
  tracker = null
}

function apply(s: SpatialSettings = loadSpatial()) {
  if (!wanted(s)) {
    if (tracker || state.status !== 'off') {
      stopTracker()
      sendYaw(0)
      setState({ status: 'off', kind: 'off', yaw: 0, face: false })
    }
    return
  }
  const kind = s.headTracking as Exclude<HeadTracking, 'off'>
  // 360: only a big turn (a chair) moves the front, so looking toward an instrument keeps it there
  const follow = (t: CameraTracker | BudsTracker | null) => {
    if (t?.kind === 'earbuds') (t as BudsTracker).setFollow(s.frontFollows ? (s.mode === '360' ? BIG_TURN_DEG : STILL_DEG) : null)
  }
  if (tracker && tracker.kind === kind) return follow(tracker)
  stopTracker()
  const t = kind === 'earbuds' ? createBudsTracker() : createCameraTracker(kind)
  follow(t)
  tracker = t
  let lastUi = 0
  unPose = t.onPose((p) => {
    // the camera only follows a face so far (±60°); the earbuds' own sensor goes all the way round
    const yaw = t.kind === 'earbuds' ? wrap(p.yaw) : clampYaw(p.yaw)
    sendYaw(yaw)
    // the readout doesn't need every frame
    if (p.t - lastUi >= 66 || t.faceVisible !== state.face) {
      lastUi = p.t
      setState({ yaw, face: t.faceVisible })
    }
  })
  setState({ status: 'starting', kind, error: null, face: false })
  void (async () => {
    try {
      await beforeStart?.(kind)
      if (tracker !== t) return
      await t.start()
      if (tracker === t) setState({ status: 'on' })
    } catch (e) {
      if (tracker !== t) return
      stopTracker()
      sendYaw(0)
      setState({ status: 'off', kind: 'off', yaw: 0, face: false, error: e instanceof Error ? e.message : String(e) })
      updateSpatial({ headTracking: 'off' })
    }
  })()
}

const onVisibility = () => apply()

/**
 * Keep head tracking running for these stages (call once per player or once with both; the
 * camera is shared). Returns the unsubscribe; tracking stops when the last one unsubscribes.
 */
export function followHeadTracking(stages: StageList): () => void {
  providers.add(stages)
  if (!unSpatial) {
    unSpatial = onSpatialChange(apply)
    document.addEventListener('visibilitychange', onVisibility)
  }
  apply()
  return () => {
    if (!providers.delete(stages)) return
    for (const st of stages()) st.setHeadYaw(0)
    if (!providers.size) {
      unSpatial?.()
      unSpatial = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
    apply()
  }
}

/** Optional step before the camera opens (e.g. the Android runtime camera permission). */
export function setHeadTrackingBeforeStart(fn: ((kind: Exclude<HeadTracking, 'off'>) => Promise<void>) | null) {
  beforeStart = fn
}

/** The running earbuds tracker (for its calibration), or null when tracking isn't from earbuds. */
export function earbudsTracker(): BudsTracker | null {
  return tracker && tracker.kind === 'earbuds' ? (tracker as BudsTracker) : null
}

/** Make the current head direction straight ahead. */
export function recenterHeadTracking() {
  tracker?.recenter()
}

export function getHeadTrackState(): HeadTrackState {
  return state
}

export function onHeadTrackState(cb: () => void): () => void {
  stateListeners.add(cb)
  return () => stateListeners.delete(cb)
}

/** Live tracking state for the settings panel. */
export function useHeadTracking(): HeadTrackState {
  return useSyncExternalStore(onHeadTrackState, getHeadTrackState)
}

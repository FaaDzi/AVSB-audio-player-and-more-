/**
 * Shared contract for the spatial mode (plan §32, phases 2–5). Phase 2 implements the stage,
 * phase 3 adds HRTF choice, phases 4–5 feed head poses into it. Keep this file small and stable.
 *
 * Signal path: both players insert the stage right before their L/R balance split:
 *   ABPlayer:      … convolvers ─ master ─ [SpatialStage] ─ balance ─ destination
 *   GalleryPlayer: … volume/limiter ─ analyser ─ [SpatialStage] ─ balance ─ destination
 * With mode 'off' the stage is a straight wire, so nothing changes for anyone who never turns it on.
 */

/** Off (default), crossfeed only, two virtual speakers at ±30°, or the speakers in a small room. */
export type SpatialMode = 'off' | 'crossfeed' | 'speakers' | 'room'

/**
 * One listener's head-related impulse responses on the horizontal plane (elevation 0), already
 * diffuse-field equalised (so the outer-ear resonance isn't counted twice on top of an IEM target).
 * `ring[i]` is the source at azimuth `i * stepDeg` degrees, counter-clockwise from straight ahead
 * (90 = left), as heard at the left and right ear.
 */
export interface HrirSet {
  id: string
  name: string
  /** Where it comes from and its licence, for the credits line. */
  source: string
  sampleRate: number
  stepDeg: number
  ring: { left: Float32Array; right: Float32Array }[]
}

/** Head orientation in degrees: yaw + = turned left, pitch + = looking up, roll + = tilted right. */
export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
  /** performance.now() when the pose was measured (for latency accounting). */
  t: number
}

/** A source of head poses (webcam, phone sensors, …). Poses are relative to the last recentre. */
export interface HeadTracker {
  readonly kind: 'webcam' | 'phone-camera'
  /** Asks for the camera/sensor if needed; rejects with a readable message when unavailable. */
  start(): Promise<void>
  stop(): void
  /** Make the current direction "straight ahead". */
  recenter(): void
  /** Subscribe to poses; returns the unsubscribe function. */
  onPose(cb: (p: HeadPose) => void): () => void
}

/** The interface the players see. */
export interface SpatialStageApi {
  readonly input: AudioNode
  readonly output: AudioNode
  readonly mode: SpatialMode
  setMode(mode: SpatialMode): void
  setHrir(set: HrirSet): void
  /** The ear-gain correction in front of the virtual speakers (spatial/earCorrection.ts). */
  setEarCorrection?(filters: import('../eq/biquad').Biquad[]): void
  /** Head yaw in degrees (from a HeadTracker); the virtual speakers turn the opposite way so they stay put. */
  setHeadYaw(deg: number): void
  /** Crossfeed amount (%) and speaker angle (°); see SpatialSettings. */
  setCrossfeed?(amountPct: number, angleDeg: number): void
}

/** Camera face tracking: the webcam on PC, the front camera (phone propped up facing you) on Android. */
export type HeadTracking = 'off' | 'webcam' | 'phone-camera'

/** What is saved (localStorage) and stored with each match result while spatial mode is on. */
export interface SpatialSettings {
  mode: SpatialMode
  /** Chosen HRIR set id (phase 3); default = the bundled generic set. */
  hrirId: string
  headTracking: HeadTracking
  /** Head width (cm) the virtual speakers' ITD is scaled to (spatial/headSize.ts); null = average. */
  headCm: number | null
  /** Who set headCm: you (slider) or the camera (measured while head tracking ran). The camera never overrides you. */
  headCmBy: 'you' | 'camera' | null
  /** Crossfeed amount, % of bs2b's default level (0–150; 100 = bs2b default), CanOpener style (§52.5). */
  xfAmount: number
  /** Crossfeed angle: where the imagined speakers stand (30–90°); sets the crossfed path's delay. */
  xfAngle: number
}

// §104 C: head angles from an earbud's game-rotation quaternion. Port of AkbulutMirac/galaxy-buds-headtracker (MIT)
// and the owner's spec §2.3: earbuds sit tilted in the ear, so yaw/pitch come from a "nose" vector built from the
// measured head-lift (pitch) axis and the world's up axis, not from the earbud's own axes.

/** [x, y, z, w] */
export type Quat = readonly [number, number, number, number]
type Vec = readonly [number, number, number]

/** In Samsung's game rotation vector the world X axis is vertical (measured by the reference project). */
export const WORLD_UP: Vec = [1, 0, 0]
/** The head-lift axis in earbud coordinates before it is measured for this pair (reference project's recording). */
export const DEFAULT_LIFT_AXIS: Vec = normalize([0.99, 0, -0.13])

export function normalize(v: readonly number[]): Vec {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

export function normalizeQ(q: readonly number[]): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]

/** q v q⁻¹ (on Galaxy Buds this turns a world vector into earbud coordinates; qConj(q) does the reverse). */
export function rotate(v: Vec, q: Quat): Vec {
  const r = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q))
  return [r[0], r[1], r[2]]
}

const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/**
 * Yaw and pitch in degrees relative to `ref` (+ yaw = turned left, + pitch = up): the nose direction's turn in the
 * horizontal plane and its angle to the horizon. The earbud's tilt in the ear doesn't matter.
 */
export function headAngles(q: Quat, ref: Quat, liftAxis: Vec = DEFAULT_LIFT_AXIS): { yaw: number; pitch: number } {
  const nose = normalize(cross(liftAxis, rotate(WORLD_UP, ref)))
  const start = rotate(nose, qConj(ref))
  const now = rotate(nose, qConj(q))
  const yaw = Math.atan2(start[1] * now[2] - start[2] * now[1], start[1] * now[1] + start[2] * now[2])
  const pitch = Math.asin(Math.max(-1, Math.min(1, now[0])))
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI }
}

/** The axis of the rotation from `ref` to `q`, or null when it turned less than ~15° (the lift wasn't big enough). */
export function liftAxisFrom(ref: Quat, q: Quat): Vec | null {
  let [x, y, z, w] = qMul(q, qConj(ref))
  if (w < 0) [x, y, z, w] = [-x, -y, -z, -w]
  return Math.hypot(x, y, z) > 0.13 ? normalize([x, y, z]) : null
}

/**
 * The "look ahead, then nod" step: started at the straight-ahead pose, it keeps the sample that turned furthest from it
 * (the deepest nod) and gives that rotation's axis, i.e. the ear-to-ear axis as this pair of earbuds sees it.
 */
export class NodCalibration {
  private readonly ref: Quat
  private best: Quat | null = null
  private bestW = 1
  constructor(ref: Quat) {
    this.ref = ref
  }

  add(q: Quat) {
    // |w| of the rotation since the start: the smaller, the bigger the turn
    const w = Math.abs(qMul(q, qConj(this.ref))[3])
    if (w < this.bestW) {
      this.bestW = w
      this.best = q
    }
  }

  /** The measured axis, or null when no sample turned ~15° or more. */
  result(): Vec | null {
    return this.best && liftAxisFrom(this.ref, this.best)
  }
}

/** Spherical interpolation from a to b by t (0..1), the short way round. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
  if (dot < 0) [bx, by, bz, bw, dot] = [-bx, -by, -bz, -bw, -dot]
  if (dot > 0.9995) return normalizeQ([a[0] + t * (bx - a[0]), a[1] + t * (by - a[1]), a[2] + t * (bz - a[2]), a[3] + t * (bw - a[3])])
  const th = Math.acos(dot)
  const s = Math.sin(th)
  const ka = Math.sin((1 - t) * th) / s
  const kb = Math.sin(t * th) / s
  return [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb]
}

/** Facing a new way this long counts as "turned the chair": the front slowly follows (spec §2.3: 5–7 s). */
export const SETTLE_MS = 6000
/** How far the head may wander and still count as holding still. */
export const STILL_DEG = 4
/** Share of the gap closed per second once settled (the front moves over a few seconds, never jumps). */
export const FOLLOW_PER_S = 0.35
/** Bluetooth audio arrives ~150–250 ms late: the speakers lead the head a little so they don't lag behind it. */
export const LEAD_MS = 60
export const MAX_LEAD_DEG = 8

/**
 * Turns earbud quaternions into yaw/pitch for the speakers: reference ("straight ahead"), slow auto-recentre after
 * holding a new direction, and a small look-ahead from the turning speed.
 */
export class BudsPose {
  private ref: Quat | null = null
  private last: Quat | null = null
  private stillSince = 0
  private stillYaw = 0
  private prev: { yaw: number; t: number } | null = null
  private speed = 0
  liftAxis: Vec
  autoRecentre: boolean
  /** From the calibration's left/right step: -1 when this pair reads turns the other way round. */
  yawSign = 1
  /** Only a turn bigger than this, held SETTLE_MS, moves the front (360 mode: big turns only). */
  followMinDeg = STILL_DEG
  constructor(liftAxis: Vec = DEFAULT_LIFT_AXIS, autoRecentre = true) {
    this.liftAxis = liftAxis
    this.autoRecentre = autoRecentre
  }

  recenter() {
    this.ref = this.last
    this.prev = null
    this.speed = 0
  }

  /** The earbuds were put back in: the next sample becomes straight ahead. */
  reset() {
    this.ref = null
    this.prev = null
    this.speed = 0
  }

  get current(): Quat | null {
    return this.last
  }

  get reference(): Quat | null {
    return this.ref
  }

  private angles(q: Quat) {
    const a = headAngles(q, this.ref!, this.liftAxis)
    return { yaw: a.yaw * this.yawSign, pitch: a.pitch }
  }

  update(raw: readonly number[], t: number): { yaw: number; pitch: number } {
    const q = normalizeQ(raw)
    this.last = q
    if (!this.ref) this.ref = q
    let a = this.angles(q)
    if (this.autoRecentre) {
      if (Math.abs(a.yaw - this.stillYaw) > STILL_DEG) {
        this.stillYaw = a.yaw
        this.stillSince = t
      } else if (t - this.stillSince >= SETTLE_MS && Math.abs(a.yaw) > this.followMinDeg) {
        const dt = this.prev ? Math.min(0.2, (t - this.prev.t) / 1000) : 0
        this.ref = slerp(this.ref, q, Math.min(1, FOLLOW_PER_S * dt))
        a = this.angles(q)
        this.stillYaw = a.yaw
      }
    }
    if (this.prev && t > this.prev.t) {
      const v = (a.yaw - this.prev.yaw) / ((t - this.prev.t) / 1000)
      this.speed = this.speed * 0.7 + v * 0.3
    }
    this.prev = { yaw: a.yaw, t }
    // capped: a glitch or a jump must not throw the speakers around
    const lead = Math.max(-MAX_LEAD_DEG, Math.min(MAX_LEAD_DEG, this.speed * (LEAD_MS / 1000)))
    return { yaw: a.yaw + lead, pitch: a.pitch }
  }
}

/** Angle in degrees between two orientations. */
export function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI
}

export type LookStep = 'ahead' | 'up' | 'down' | 'nod' | 'left' | 'right' | 'done' | 'failed'
/** The steps in order, for the progress dots. */
export const LOOK_STEPS = ['ahead', 'up', 'down', 'nod', 'left', 'right'] as const
/** Holding still: moving less than this… */
export const HOLD_DEG = 3
/** …for this long counts as "holding" a position. */
export const HOLD_MS = 1200
/** Up, down, left and right must each be at least this far from straight ahead. */
export const LOOK_MIN_DEG = 15
/** The slow nod lasts this long and must swing at least LOOK_MIN_DEG from top to bottom. */
export const NOD_MS = 3000
/** Time to come back level after "look down" before the nod is measured. */
export const NOD_SETTLE_MS = 600
/** A step that isn't done in this long fails (the person may have stopped). */
export const LOOK_STEP_MS = 15000

/**
 * The owner's calibration (§104 C): look straight ahead, up, down (each held a moment), a slow 3-second nod, then left
 * and right (held). Up→down is a wide, clean turn about the ear-to-ear axis, and knowing which end was "up" gives it its
 * sign, so looking up reads as + pitch however the earbud sits. The nod checks that axis works; left/right check that
 * turning reads as yaw and give its sign (+ = left), so the room never turns the wrong way.
 */
export class LookCalibration {
  step: LookStep = 'ahead'
  /** 0..1: how long the current position has been held (the nod: how much of it is done). */
  hold = 0
  /** Degrees from straight ahead (0 until it is known). */
  angle = 0
  axis: Vec | null = null
  /** +1 when turning left reads as + yaw with this axis, -1 when it's the other way round. */
  yawSign = 1
  ahead: Quat | null = null
  private up: Quat | null = null
  private anchor: Quat | null = null
  private since = 0
  private stepStart = -1
  private nodLow = 0
  private nodHigh = 0

  add(q: Quat, t: number): LookStep {
    if (this.step === 'done' || this.step === 'failed') return this.step
    if (this.stepStart < 0) this.stepStart = t
    if (t - this.stepStart > LOOK_STEP_MS) return (this.step = 'failed')
    this.angle = this.ahead ? angleBetween(q, this.ahead) : 0
    const a = this.axis && this.ahead ? headAngles(q, this.ahead, this.axis) : null
    if (this.step === 'nod') {
      // the first moment is the head coming back up from "look down": not part of the nod
      const into = t - this.stepStart - NOD_SETTLE_MS
      if (into < 0) {
        this.nodLow = this.nodHigh = a!.pitch
        return this.step
      }
      this.nodLow = Math.min(this.nodLow, a!.pitch)
      this.nodHigh = Math.max(this.nodHigh, a!.pitch)
      const swing = Math.min(1, (this.nodHigh - this.nodLow) / LOOK_MIN_DEG)
      this.hold = Math.min(1, into / NOD_MS) * swing
      if (this.hold >= 1) this.next(t, 'left')
      return this.step
    }
    if (!this.anchor || angleBetween(q, this.anchor) > HOLD_DEG) {
      this.anchor = q
      this.since = t
    }
    const far =
      this.step === 'ahead' ? true
      : this.step === 'up' ? this.angle >= LOOK_MIN_DEG
      : this.step === 'down' ? this.angle >= LOOK_MIN_DEG && angleBetween(q, this.up!) >= LOOK_MIN_DEG
      // a turn, not a tilt: mostly yaw, and the second one to the other side
      : Math.abs(a!.yaw) >= LOOK_MIN_DEG && Math.abs(a!.yaw) > Math.abs(a!.pitch) &&
        (this.step === 'left' || Math.sign(a!.yaw) === -this.yawSign)
    this.hold = far ? Math.min(1, (t - this.since) / HOLD_MS) : 0
    if (this.hold < 1) return this.step
    if (this.step === 'ahead') {
      this.ahead = q
      this.next(t, 'up')
    } else if (this.step === 'up') {
      this.up = q
      this.next(t, 'down')
    } else if (this.step === 'down') {
      let axis = liftAxisFrom(this.up!, q)
      if (!axis) return (this.step = 'failed')
      // looking up must read as + pitch
      if (headAngles(this.up!, this.ahead!, axis).pitch < 0) axis = [-axis[0], -axis[1], -axis[2]]
      this.axis = axis
      this.nodLow = this.nodHigh = 0
      this.next(t, 'nod')
    } else if (this.step === 'left') {
      this.yawSign = a!.yaw > 0 ? 1 : -1
      this.next(t, 'right')
    } else {
      this.step = 'done'
    }
    return this.step
  }

  private next(t: number, step: LookStep) {
    this.step = step
    this.stepStart = t
    this.anchor = null
    this.hold = 0
  }
}

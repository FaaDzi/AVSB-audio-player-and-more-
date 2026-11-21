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

  update(raw: readonly number[], t: number): { yaw: number; pitch: number } {
    const q = normalizeQ(raw)
    this.last = q
    if (!this.ref) this.ref = q
    let a = headAngles(q, this.ref, this.liftAxis)
    if (this.autoRecentre) {
      if (Math.abs(a.yaw - this.stillYaw) > STILL_DEG) {
        this.stillYaw = a.yaw
        this.stillSince = t
      } else if (t - this.stillSince >= SETTLE_MS && Math.abs(a.yaw) > STILL_DEG) {
        const dt = this.prev ? Math.min(0.2, (t - this.prev.t) / 1000) : 0
        this.ref = slerp(this.ref, q, Math.min(1, FOLLOW_PER_S * dt))
        a = headAngles(q, this.ref, this.liftAxis)
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

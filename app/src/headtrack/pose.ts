/**
 * Pure head-pose maths for camera tracking (plan §32 phase 4): the MediaPipe face transform →
 * yaw/pitch/roll, One Euro smoothing, recentring, and what to do while the face is lost.
 * No DOM, no MediaPipe, so it is unit tested.
 */
import type { HeadPose } from '../spatial/types'

export type Angles = Pick<HeadPose, 'yaw' | 'pitch' | 'roll'>

const DEG = 180 / Math.PI

/**
 * MediaPipe's facial transformation matrix (4x4, column-major, camera space: x = image right,
 * y = up, z = towards the camera; the canonical face looks down +z) → head angles in degrees,
 * signed per the HeadPose contract: yaw + = turned left, pitch + = looking up, roll + = tilted right.
 *
 * getUserMedia frames are not mirrored (the mirror is only a preview convention), so the subject's
 * left is image right: a left turn swings the nose to +x. Pass `mirrored` for a mirrored frame.
 * Decomposed as R = Ry(yaw) · Rx(−pitch) · Rz(roll).
 */
export function matrixToAngles(data: ArrayLike<number>, mirrored = false): Angles {
  // r(row, col) of the upper-left 3x3, each column normalised (the transform may carry scale)
  const col = (c: number) => {
    const x = data[c * 4]
    const y = data[c * 4 + 1]
    const z = data[c * 4 + 2]
    const n = Math.hypot(x, y, z) || 1
    return [x / n, y / n, z / n]
  }
  const c0 = col(0)
  const c1 = col(1)
  const c2 = col(2)
  // mirroring flips x: R' = M R M with M = diag(−1, 1, 1)
  const s = mirrored ? -1 : 1
  const r02 = s * c2[0]
  const r12 = c2[1]
  const r22 = c2[2]
  const r10 = s * c0[1]
  const r11 = c1[1]
  return {
    yaw: Math.atan2(r02, r22) * DEG,
    pitch: Math.asin(Math.max(-1, Math.min(1, r12))) * DEG,
    roll: Math.atan2(r10, r11) * DEG,
  }
}

/** Column-major 4x4 rotation for the given angles (the inverse of matrixToAngles; for tests). */
export function anglesToMatrix(a: Angles, mirrored = false): number[] {
  const y = a.yaw / DEG
  const b = -a.pitch / DEG
  const c = a.roll / DEG
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(y), Math.sin(y), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)]
  // Ry(a)·Rx(b) = [[ca, sa sb, sa cb], [0, cb, −sb], [−sa, ca sb, ca cb]], then ·Rz(c)
  const m = [
    [ca * cc + sa * sb * sc, -ca * sc + sa * sb * cc, sa * cb],
    [cb * sc, cb * cc, -sb],
    [-sa * cc + ca * sb * sc, sa * sc + ca * sb * cc, ca * cb],
  ]
  const f = mirrored ? [-1, 1, 1] : [1, 1, 1]
  const out = new Array<number>(16).fill(0)
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out[k * 4 + r] = f[r] * m[r][k] * f[k]
  out[15] = 1
  return out
}

/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass whose cutoff rises with speed,
 * so a still head doesn't jitter and a turning head doesn't lag. Times in seconds.
 */
export function oneEuro(minCutoff = 1, beta = 0.05, dCutoff = 1) {
  let prevX: number | null = null
  let prevDx = 0
  let prevT = 0
  const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
  return {
    filter(x: number, t: number): number {
      if (prevX === null || t <= prevT) {
        if (prevX === null) {
          prevX = x
          prevT = t
        }
        return prevX
      }
      const dt = t - prevT
      const dx = (x - prevX) / dt
      const edx = prevDx + alpha(dCutoff, dt) * (dx - prevDx)
      const cutoff = minCutoff + beta * Math.abs(edx)
      const y = prevX + alpha(cutoff, dt) * (x - prevX)
      prevX = y
      prevDx = edx
      prevT = t
      return y
    },
    reset() {
      prevX = null
      prevDx = 0
    },
  }
}

/** Pose minus the recentre offset. */
export function relativeTo(raw: Angles, offset: Angles): Angles {
  return { yaw: wrap(raw.yaw - offset.yaw), pitch: wrap(raw.pitch - offset.pitch), roll: wrap(raw.roll - offset.roll) }
}

/** Into (−180, 180]. */
export function wrap(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d
}

/** Hold the last pose this long after the face is lost, then ease back to straight ahead. */
export const LOST_HOLD_MS = 300
export const LOST_EASE_MS = 700
/** A loss at least this long re-centres on the pose where the face is found again. */
export const AUTO_RECENTRE_MS = 1500
/** After a short loss the output glides from where it was to the tracked pose over this long. */
const REJOIN_MS = 300

const ZERO: Angles = { yaw: 0, pitch: 0, roll: 0 }
const lerp = (a: Angles, b: Angles, k: number): Angles => ({
  yaw: a.yaw + (b.yaw - a.yaw) * k,
  pitch: a.pitch + (b.pitch - a.pitch) * k,
  roll: a.roll + (b.roll - a.roll) * k,
})

/**
 * Raw camera angles → smoothed poses relative to the last recentre. Call face() for every frame
 * with a face and lost() for every frame without one; both return the pose to emit. Times in ms.
 */
export class PoseProcessor {
  private f = { yaw: oneEuro(), pitch: oneEuro(), roll: oneEuro() }
  private offset: Angles = { ...ZERO }
  private smoothed: Angles | null = null
  private last: Angles = { ...ZERO }
  private lostAt: number | null = null
  private lostFrom: Angles = { ...ZERO }
  private rejoin: { from: Angles; t: number } | null = null
  private wantRecentre = false

  face(raw: Angles, t: number): HeadPose {
    if (this.lostAt !== null) {
      for (const k of ['yaw', 'pitch', 'roll'] as const) this.f[k].reset()
      if (t - this.lostAt >= AUTO_RECENTRE_MS) this.wantRecentre = true
      else this.rejoin = { from: this.last, t }
      this.lostAt = null
    }
    const s = { yaw: this.f.yaw.filter(raw.yaw, t / 1000), pitch: this.f.pitch.filter(raw.pitch, t / 1000), roll: this.f.roll.filter(raw.roll, t / 1000) }
    this.smoothed = s
    if (this.wantRecentre) {
      this.offset = { ...s }
      this.wantRecentre = false
      // the eased-out output is ~0 by now, so recentring here doesn't jump
      this.rejoin = { from: this.last, t }
    }
    let out = relativeTo(s, this.offset)
    if (this.rejoin) {
      const k = Math.min(1, (t - this.rejoin.t) / REJOIN_MS)
      out = lerp(this.rejoin.from, out, k)
      if (k >= 1) this.rejoin = null
    }
    this.last = out
    return { ...out, t }
  }

  lost(t: number): HeadPose {
    if (this.lostAt === null) {
      this.lostAt = t
      this.lostFrom = this.last
      this.rejoin = null
    }
    const k = Math.max(0, Math.min(1, (t - this.lostAt - LOST_HOLD_MS) / LOST_EASE_MS))
    const out = lerp(this.lostFrom, ZERO, k * k * (3 - 2 * k))
    this.last = out
    return { ...out, t }
  }

  /** The current direction becomes straight ahead (now, or at the next face if none is tracked). */
  recenter() {
    if (this.smoothed && this.lostAt === null) {
      this.offset = { ...this.smoothed }
      this.rejoin = null
      this.last = { ...ZERO }
    } else {
      this.wantRecentre = true
    }
  }
}

/** The stage only takes yaw within ±60° (beyond that the camera can't see the face anyway). */
export const clampYaw = (deg: number) => Math.max(-60, Math.min(60, deg))

// ---------- head width from the camera ----------

/** The iris is ~11.7 mm across in nearly every adult: the one true size in the picture. */
const IRIS_MM = 11.7
/** Head breadth (ear to ear) is about this much wider than the face between the cheekbone landmarks. */
const HEAD_PER_FACE = 1.1
/** Face oval points at the cheekbones (234 right, 454 left) and the iris ring edges (469/471, 474/476). */
const FACE = [234, 454] as const
const IRISES = [
  [469, 471],
  [474, 476],
] as const

/**
 * Head width (cm) from one frame's face landmarks (normalised x/y; x alone is used, so the image's
 * aspect doesn't matter): face width ÷ iris width × 11.7 mm, scaled from the face to ear-to-ear.
 * Null when the landmarks don't include the irises or the face is turned (the face narrows).
 */
export function headWidthCm(lm: ArrayLike<{ x: number }>, yawDeg: number): number | null {
  if (lm.length < 478 || Math.abs(yawDeg) > 12) return null
  const face = Math.abs(lm[FACE[1]].x - lm[FACE[0]].x)
  const iris = IRISES.map(([a, b]) => Math.abs(lm[b].x - lm[a].x)).reduce((s, v) => s + v, 0) / IRISES.length
  if (!(iris > 0) || !(face > iris * 5)) return null
  return ((face / iris) * IRIS_MM * HEAD_PER_FACE) / 10
}

/** The median of the values (the camera's per-frame estimates jitter; a few frames are off). */
export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

import { describe, expect, it } from 'vitest'
import { AUTO_RECENTRE_MS, LOST_EASE_MS, LOST_HOLD_MS, PoseProcessor, anglesToMatrix, clampYaw, headWidthCm, matrixToAngles, median, oneEuro, relativeTo, wrap } from './pose'

const close = (a: { yaw: number; pitch: number; roll: number }, b: { yaw: number; pitch: number; roll: number }, d = 1e-6) => {
  expect(a.yaw).toBeCloseTo(b.yaw, -Math.log10(d))
  expect(a.pitch).toBeCloseTo(b.pitch, -Math.log10(d))
  expect(a.roll).toBeCloseTo(b.roll, -Math.log10(d))
}

describe('matrixToAngles', () => {
  it('reads identity as straight ahead', () => {
    close(matrixToAngles(anglesToMatrix({ yaw: 0, pitch: 0, roll: 0 })), { yaw: 0, pitch: 0, roll: 0 })
  })

  it('round-trips combined angles', () => {
    for (const a of [
      { yaw: 30, pitch: 0, roll: 0 },
      { yaw: -45, pitch: 10, roll: -5 },
      { yaw: 12, pitch: -20, roll: 15 },
    ]) close(matrixToAngles(anglesToMatrix(a)), a)
  })

  it('a left turn swings the nose to image right (+x) in an unmirrored frame: yaw +', () => {
    // rotation about +y by 30°: the face's forward axis (0,0,1) becomes (sin 30°, 0, cos 30°)
    const t = (30 * Math.PI) / 180
    const m = [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1]
    expect(matrixToAngles(m).yaw).toBeCloseTo(30, 6)
    expect(matrixToAngles(m, true).yaw).toBeCloseTo(-30, 6)
  })

  it('nose up is pitch +; head top towards image left (subject right) is roll +', () => {
    const t = (20 * Math.PI) / 180
    // forward (0,0,1) → (0, sin, cos): looking up
    const up = [1, 0, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, 0, Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1]
    expect(matrixToAngles(up).pitch).toBeCloseTo(20, 6)
    expect(matrixToAngles(up, true).pitch).toBeCloseTo(20, 6)
    // up (0,1,0) → (−sin, cos, 0): rotation about +z
    const tilt = [Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect(matrixToAngles(tilt).roll).toBeCloseTo(20, 6)
    expect(matrixToAngles(tilt, true).roll).toBeCloseTo(-20, 6)
  })

  it('mirroring flips yaw and roll, keeps pitch', () => {
    const a = { yaw: 25, pitch: 8, roll: -6 }
    close(matrixToAngles(anglesToMatrix(a), true), { yaw: -25, pitch: 8, roll: 6 })
    close(matrixToAngles(anglesToMatrix(a, true), true), a)
  })

  it('ignores uniform scale in the transform', () => {
    const m = anglesToMatrix({ yaw: -20, pitch: 5, roll: 3 }).map((v, i) => (i < 12 ? v * 3.7 : v))
    close(matrixToAngles(m), { yaw: -20, pitch: 5, roll: 3 })
  })
})

describe('oneEuro', () => {
  it('passes the first sample and a constant through unchanged', () => {
    const f = oneEuro()
    expect(f.filter(10, 0)).toBe(10)
    for (let i = 1; i < 30; i++) expect(f.filter(10, i / 30)).toBeCloseTo(10, 9)
  })

  it('damps jitter on a still head', () => {
    const f = oneEuro(1, 0.05)
    let maxDev = 0
    for (let i = 0; i < 300; i++) {
      const y = f.filter(i % 2 ? 1 : -1, i / 30)
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(y))
    }
    expect(maxDev).toBeLessThan(0.3)
  })

  it('follows a fast turn with less lag when beta is higher', () => {
    const lagAt = (beta: number) => {
      const f = oneEuro(1, beta)
      let y = 0
      for (let i = 0; i <= 15; i++) y = f.filter(i * 4, i / 30) // 120°/s for 0.5 s
      return 60 - y
    }
    expect(lagAt(0.1)).toBeLessThan(lagAt(0))
    expect(lagAt(0.1)).toBeLessThan(15)
  })

  it('reset starts again from the next sample', () => {
    const f = oneEuro()
    f.filter(0, 0)
    f.filter(0, 0.1)
    f.reset()
    expect(f.filter(40, 0.2)).toBe(40)
  })
})

describe('recentre offset', () => {
  it('subtracts the offset and wraps', () => {
    close(relativeTo({ yaw: 30, pitch: -5, roll: 2 }, { yaw: 10, pitch: -5, roll: 2 }), { yaw: 20, pitch: 0, roll: 0 })
    expect(relativeTo({ yaw: 170, pitch: 0, roll: 0 }, { yaw: -170, pitch: 0, roll: 0 }).yaw).toBeCloseTo(-20, 9)
    expect(wrap(540)).toBe(180)
    expect(wrap(-190)).toBe(170)
  })

  it('recenter() makes the current pose straight ahead', () => {
    const p = new PoseProcessor()
    let t = 0
    for (let i = 0; i < 60; i++) p.face({ yaw: 12, pitch: -4, roll: 1 }, (t += 33))
    expect(p.face({ yaw: 12, pitch: -4, roll: 1 }, (t += 33)).yaw).toBeCloseTo(12, 3)
    p.recenter()
    close(p.face({ yaw: 12, pitch: -4, roll: 1 }, (t += 33)), { yaw: 0, pitch: 0, roll: 0 }, 1e-3)
    let out = 0
    for (let i = 0; i < 60; i++) out = p.face({ yaw: 32, pitch: -4, roll: 1 }, (t += 33)).yaw
    expect(out).toBeCloseTo(20, 2)
  })

  it('recenter() with no face yet applies at the next face', () => {
    const p = new PoseProcessor()
    p.recenter()
    expect(p.face({ yaw: 25, pitch: 0, roll: 0 }, 0).yaw).toBeCloseTo(0, 9)
  })

  it('holds, then eases to straight ahead while the face is lost', () => {
    const p = new PoseProcessor()
    let t = 0
    for (let i = 0; i < 60; i++) p.face({ yaw: 30, pitch: 0, roll: 0 }, (t += 33))
    const lostAt = t + 33
    expect(p.lost(lostAt).yaw).toBeCloseTo(30, 2)
    expect(p.lost(lostAt + LOST_HOLD_MS).yaw).toBeCloseTo(30, 2)
    const mid = p.lost(lostAt + LOST_HOLD_MS + LOST_EASE_MS / 2).yaw
    expect(mid).toBeGreaterThan(5)
    expect(mid).toBeLessThan(25)
    expect(p.lost(lostAt + LOST_HOLD_MS + LOST_EASE_MS).yaw).toBeCloseTo(0, 9)
  })

  it('a long loss re-centres on the pose where the face comes back, without a jump', () => {
    const p = new PoseProcessor()
    let t = 0
    for (let i = 0; i < 30; i++) p.face({ yaw: 0, pitch: 0, roll: 0 }, (t += 33))
    p.lost((t += 33))
    p.lost((t += AUTO_RECENTRE_MS))
    expect(p.face({ yaw: 18, pitch: 0, roll: 0 }, (t += 33)).yaw).toBeCloseTo(0, 6)
    let out = 0
    for (let i = 0; i < 60; i++) out = p.face({ yaw: 28, pitch: 0, roll: 0 }, (t += 33)).yaw
    expect(out).toBeCloseTo(10, 2)
  })

  it('a short loss keeps the offset and glides back to the tracked pose', () => {
    const p = new PoseProcessor()
    let t = 0
    for (let i = 0; i < 60; i++) p.face({ yaw: 20, pitch: 0, roll: 0 }, (t += 33))
    p.lost((t += 33))
    const first = p.face({ yaw: 20, pitch: 0, roll: 0 }, (t += 100)).yaw
    expect(first).toBeCloseTo(20, 2)
    let out = 0
    for (let i = 0; i < 20; i++) out = p.face({ yaw: 20, pitch: 0, roll: 0 }, (t += 33)).yaw
    expect(out).toBeCloseTo(20, 2)
  })
})

describe('clampYaw', () => {
  it('limits to ±60°', () => {
    expect(clampYaw(75)).toBe(60)
    expect(clampYaw(-90)).toBe(-60)
    expect(clampYaw(12)).toBe(12)
  })
})

describe('head width from the camera', () => {
  /** 478 landmarks: cheekbones `face` apart and both irises `iris` wide (normalised x). */
  const frame = (face: number, iris: number) => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5 }))
    lm[234] = { x: 0.5 - face / 2 }
    lm[454] = { x: 0.5 + face / 2 }
    lm[469] = { x: 0.4 }
    lm[471] = { x: 0.4 + iris }
    lm[474] = { x: 0.6 }
    lm[476] = { x: 0.6 + iris }
    return lm
  }
  it('sizes the head from the iris (11.7 mm): an average face reads about 15 cm', () => {
    // a 140 mm face with 11.7 mm irises: 12x the iris, ×1.1 to ear-to-ear
    expect(headWidthCm(frame(0.36, 0.03), 0)).toBeCloseTo(15.4, 1)
  })
  it('skips turned faces and frames without irises', () => {
    expect(headWidthCm(frame(0.36, 0.03), 20)).toBeNull()
    expect(headWidthCm(frame(0.36, 0.03).slice(0, 468), 0)).toBeNull()
  })
  it('takes the median, so a few bad frames do not move it', () => {
    expect(median([15, 15.2, 30, 14.9, 15.1])).toBe(15.1)
  })
})

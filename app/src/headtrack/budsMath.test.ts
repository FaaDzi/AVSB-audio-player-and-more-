import { describe, expect, it } from 'vitest'
import { BudsPose, headAngles, liftAxisFrom, LookCalibration, NodCalibration, normalize, qConj, qMul, rotate, WORLD_UP, type Quat } from './budsMath'
import nods from './fixtures/buds2-nods.json'

const axisAngle = (axis: readonly number[], deg: number): Quat => {
  const [x, y, z] = normalize(axis)
  const h = (deg * Math.PI) / 360
  return [x * Math.sin(h), y * Math.sin(h), z * Math.sin(h), Math.cos(h)]
}
// an earbud sitting tilted in the ear: its axes match nothing on the head
const tilt = axisAngle([0.3, 0.8, -0.5], 37)
// a world axis through both ears (horizontal), as the earbud sees it at rest: what the "nod" calibration measures
const earToEar = [0, 1, 0] as const
const lift = rotate(earToEar, tilt)
// the head turns by H in the world: rotate() maps world → earbud, so the earbud's quaternion becomes tilt · H⁻¹
const turned = (h: Quat) => qMul(tilt, qConj(h))

describe('earbud head angles (§104 C)', () => {
  it('straight ahead is 0, 0', () => {
    const a = headAngles(tilt, tilt, lift)
    expect(a.yaw).toBeCloseTo(0, 6)
    expect(a.pitch).toBeCloseTo(0, 6)
  })

  it('a turn about the vertical gives that yaw, whatever the tilt in the ear', () => {
    const left = headAngles(turned(axisAngle(WORLD_UP, 30)), tilt, lift)
    const right = headAngles(turned(axisAngle(WORLD_UP, -30)), tilt, lift)
    expect(Math.abs(left.yaw)).toBeCloseTo(30, 3)
    expect(right.yaw).toBeCloseTo(-left.yaw, 3)
    expect(Math.abs(left.pitch)).toBeLessThan(0.01)
  })

  it('a nod gives pitch and no yaw', () => {
    const a = headAngles(turned(axisAngle(earToEar, 20)), tilt, lift)
    expect(Math.abs(a.pitch)).toBeCloseTo(20, 3)
    expect(Math.abs(a.yaw)).toBeLessThan(0.01)
  })

  it('the nod calibration finds the ear-to-ear axis, and refuses a nod under ~15°', () => {
    const axis = liftAxisFrom(tilt, turned(axisAngle(earToEar, 25)))!
    const dot = Math.abs(axis[0] * lift[0] + axis[1] * lift[1] + axis[2] * lift[2])
    expect(dot).toBeGreaterThan(0.999)
    expect(liftAxisFrom(tilt, turned(axisAngle(earToEar, 8)))).toBeNull()
  })

  it('holding a new direction slowly becomes the new front (turned the chair)', () => {
    const p = new BudsPose(lift)
    p.update(tilt, 0)
    const away = turned(axisAngle(WORLD_UP, 40))
    let a = p.update(away, 20)
    expect(Math.abs(a.yaw)).toBeGreaterThan(35)
    for (let t = 40; t <= 6000; t += 20) a = p.update(away, t)
    expect(Math.abs(a.yaw)).toBeGreaterThan(35) // not before it has settled
    for (let t = 6020; t <= 20000; t += 20) a = p.update(away, t)
    expect(Math.abs(a.yaw)).toBeLessThan(5)
  })

  it('recenter makes the current direction straight ahead', () => {
    const p = new BudsPose(lift, false)
    p.update(tilt, 0)
    const away = turned(axisAngle(WORLD_UP, 25))
    p.update(away, 20)
    p.recenter()
    expect(Math.abs(p.update(away, 40).yaw)).toBeLessThan(0.5)
  })
})

// §104 C: the owner's own Galaxy Buds2, recorded on a Xiaomi 14: looking ahead, then nodding up and down

describe('nod calibration on a real recording', () => {
  const samples = (nods as { samples: number[][] }).samples
  const q = (s: number[]): Quat => [s[0], s[1], s[2], s[3]]

  it('finds the ear-to-ear axis from the first 3 s of nodding, and then nods read as pitch, not yaw', () => {
    const ref = q(samples[0])
    const cal = new NodCalibration(ref)
    for (const s of samples) if (s[4] - samples[0][4] <= 3000) cal.add(q(s))
    const axis = cal.result()
    expect(axis).not.toBeNull()
    let maxPitch = 0
    let maxYaw = 0
    for (const s of samples) {
      const a = headAngles(q(s), ref, axis!)
      maxPitch = Math.max(maxPitch, Math.abs(a.pitch))
      maxYaw = Math.max(maxYaw, Math.abs(a.yaw))
    }
    expect(maxPitch).toBeGreaterThan(30)
    // nodding isn't turning: the calibrated axis keeps yaw small next to the pitch
    expect(maxYaw).toBeLessThan(maxPitch / 3)
  })

  it('no nod (holding still) saves nothing', () => {
    const ref = q(samples[0])
    const cal = new NodCalibration(ref)
    cal.add(ref)
    expect(cal.result()).toBeNull()
  })
})

describe('look ahead → up → down calibration (§104 C)', () => {
  const feed = (cal: LookCalibration, q: Quat, from: number, ms: number) => {
    for (let t = from; t < from + ms; t += 20) cal.add(q, t)
    return from + ms
  }

  it('measures the ear-to-ear axis with up as + pitch, whatever the tilt', () => {
    const cal = new LookCalibration()
    let t = feed(cal, tilt, 0, 1500)
    expect(cal.step).toBe('up')
    t = feed(cal, turned(axisAngle(earToEar, -12)), t, 400) // on the way up
    t = feed(cal, turned(axisAngle(earToEar, -25)), t, 1500)
    expect(cal.step).toBe('down')
    t = feed(cal, turned(axisAngle(earToEar, 25)), t, 1500)
    expect(cal.step).toBe('nod')
    const up = headAngles(turned(axisAngle(earToEar, -25)), tilt, cal.axis!)
    expect(up.pitch).toBeGreaterThan(20)
    expect(Math.abs(up.yaw)).toBeLessThan(1)
    // a slow 3-second nod
    for (let i = 0; i < 200; i++, t += 20) cal.add(turned(axisAngle(earToEar, 20 * Math.sin(i / 12))), t)
    expect(cal.step).toBe('left')
    t = feed(cal, turned(axisAngle(WORLD_UP, 35)), t, 1500)
    expect(cal.step).toBe('right')
    t = feed(cal, turned(axisAngle(WORLD_UP, -35)), t, 1500)
    expect(cal.step).toBe('done')
    // whichever way this sensor reads turns, left comes out as + yaw
    expect(headAngles(turned(axisAngle(WORLD_UP, 35)), tilt, cal.axis!).yaw * cal.yawSign).toBeGreaterThan(30)
  })

  it("a nod that is too small, or a tilt instead of a turn, does not pass", () => {
    const cal = new LookCalibration()
    let t = feed(cal, tilt, 0, 1500)
    t = feed(cal, turned(axisAngle(earToEar, -25)), t, 1500)
    t = feed(cal, turned(axisAngle(earToEar, 25)), t, 1500)
    for (let i = 0; i < 300; i++, t += 20) cal.add(turned(axisAngle(earToEar, 4 * Math.sin(i / 12))), t)
    expect(cal.step).toBe('nod')
    for (let i = 0; i < 200; i++, t += 20) cal.add(turned(axisAngle(earToEar, 20 * Math.sin(i / 12))), t)
    expect(cal.step).toBe('left')
    // looking up isn't turning left
    t = feed(cal, turned(axisAngle(earToEar, -30)), t, 3000)
    expect(cal.step).toBe('left')
    t = feed(cal, turned(axisAngle(WORLD_UP, 35)), t, 1500)
    // turning to the same side again isn't "right"
    feed(cal, turned(axisAngle(WORLD_UP, 40)), t, 3000)
    expect(cal.step).toBe('right')
  })

  it('looking up only a little, or not holding, doesn\'t count', () => {
    const cal = new LookCalibration()
    let t = feed(cal, tilt, 0, 1500)
    t = feed(cal, turned(axisAngle(earToEar, -8)), t, 3000)
    expect(cal.step).toBe('up')
    // wobbling between two positions never holds
    for (let i = 0; i < 40; i++) t = feed(cal, turned(axisAngle(earToEar, i % 2 ? -20 : -30)), t, 100)
    expect(cal.step).toBe('up')
  })

  it('gives up after 15 s on one step', () => {
    const cal = new LookCalibration()
    const t = feed(cal, tilt, 0, 1500)
    feed(cal, tilt, t, 16000)
    expect(cal.step).toBe('failed')
  })
})

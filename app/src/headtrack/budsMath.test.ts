import { describe, expect, it } from 'vitest'
import { BudsPose, headAngles, liftAxisFrom, normalize, qConj, qMul, rotate, WORLD_UP, type Quat } from './budsMath'

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

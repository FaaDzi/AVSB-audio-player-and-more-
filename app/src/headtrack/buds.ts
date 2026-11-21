// §104 C: head tracking from Galaxy Buds' own motion sensor (Android; native plugin BudsHeadTrackerPlugin.kt).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { HeadPose, HeadTracker } from '../spatial/types'
import { isAndroid } from '../platform'
import { AudioRoute } from '../audio/speakerGuard'
import { BudsPose, LookCalibration, normalize, normalizeQ, type LookStep, type Quat } from './budsMath'
import { logLine } from '../shell/logs'

interface BudsPlugin {
  find(): Promise<{ devices: { name: string; address: string }[] }>
  start(o: { address: string }): Promise<void>
  stop(): Promise<void>
  addListener(e: 'pose', f: (p: { x: number; y: number; z: number; w: number; t: number }) => void): Promise<PluginListenerHandle>
  addListener(e: 'state', f: (s: { state: string; detail: string }) => void): Promise<PluginListenerHandle>
}
const plugin = isAndroid() ? registerPlugin<BudsPlugin>('BudsHeadTracker') : null

export interface Earbuds { name: string; address: string }

/** Galaxy Buds (Buds+ and later) paired with this phone, the ones playing right now first. Empty off Android. */
export async function findEarbuds(): Promise<Earbuds[]> {
  if (!plugin) return []
  const { devices } = await plugin.find()
  const playing = await AudioRoute.output().then((o) => (o.type === 'bluetooth' ? o.name ?? '' : ''), () => '')
  return [...devices].sort((a, b) => Number(b.name === playing) - Number(a.name === playing))
}

const liftKey = (address: string) => `buds-lift-${address}`
/** This pair's calibration: the ear-to-ear axis and which way turns read (an older save is just the axis). */
const savedCal = (address: string) => {
  try {
    const v = JSON.parse(localStorage.getItem(liftKey(address)) ?? 'null') as number[] | { axis: number[]; yawSign: number } | null
    if (Array.isArray(v)) return v.length === 3 ? { axis: normalize(v), yawSign: 1 } : null
    return v && v.axis?.length === 3 ? { axis: normalize(v.axis), yawSign: v.yawSign < 0 ? -1 : 1 } : null
  } catch {
    return null
  }
}

export interface BudsTracker extends HeadTracker {
  readonly earbuds: Earbuds | null
  /** Earbuds in the ears and the stream running (shown like the camera's "face in view"). */
  readonly faceVisible: boolean
  /** This pair's tilt in the ear was measured (the look-ahead-then-nod step); false means the default is in use. */
  readonly calibrated: boolean
  /** Look ahead, up, then down (holding each): measures and saves how this pair sits in the ear. `progress` follows
   * each step live (step, 0..1 held, degrees from straight ahead). */
  calibrate(progress: (p: { step: LookStep; hold: number; angle: number }) => void): Promise<'saved' | 'failed'>
  /** Stop a calibration that is running (Cancel). */
  cancelCalibration(): void
  /** The front follows turns bigger than `minDeg` held for a while; null = never (a fixed room). */
  setFollow(minDeg: number | null): void
  onState(cb: (state: string) => void): () => void
}

export function createBudsTracker(): BudsTracker {
  const pose = new BudsPose()
  const poseCbs = new Set<(p: HeadPose) => void>()
  const stateCbs = new Set<(s: string) => void>()
  const handles: PluginListenerHandle[] = []
  let earbuds: Earbuds | null = null
  let worn = false
  let calibrated = false
  let measuring: { cal: LookCalibration; progress: (p: { step: LookStep; hold: number; angle: number }) => void; done: (r: 'saved' | 'failed') => void } | null = null

  const emitState = (s: string) => stateCbs.forEach((cb) => cb(s))

  return {
    kind: 'earbuds',
    get earbuds() { return earbuds },
    get faceVisible() { return worn },
    get calibrated() { return calibrated },
    async start() {
      if (!plugin) throw new Error('Head tracking from earbuds works on the phone.')
      const found = await findEarbuds()
      if (!found.length) throw new Error('No earbuds with head sensors found. Supported now: Galaxy Buds+ and later.')
      earbuds = found[0]
      logLine('INFO', 'Spatial', `Earbuds head tracking: connecting to ${earbuds.name}`)
      const cal = savedCal(earbuds.address)
      calibrated = Boolean(cal)
      if (cal) {
        pose.liftAxis = cal.axis
        pose.yawSign = cal.yawSign
      }
      handles.push(await plugin.addListener('pose', (p) => {
        worn = true
        const raw: Quat = [p.x, p.y, p.z, p.w]
        if (measuring) {
          const m = measuring
          const step = m.cal.add(normalizeQ(raw), p.t)
          m.progress({ step, hold: m.cal.hold, angle: m.cal.angle })
          if (step === 'done' || step === 'failed') {
            measuring = null
            if (step === 'done' && m.cal.axis && earbuds) {
              pose.liftAxis = m.cal.axis
              pose.yawSign = m.cal.yawSign
              calibrated = true
              // straight ahead is where the calibration started
              pose.reset()
              try { localStorage.setItem(liftKey(earbuds.address), JSON.stringify({ axis: m.cal.axis, yawSign: m.cal.yawSign })) } catch { /* not saved */ }
              m.done('saved')
            } else m.done('failed')
          }
        }
        const a = pose.update(raw, p.t)
        const out: HeadPose = { yaw: a.yaw, pitch: a.pitch, roll: 0, t: performance.now() }
        poseCbs.forEach((cb) => cb(out))
      }))
      handles.push(await plugin.addListener('state', (s) => {
        if (s.state === 'wear-on') { worn = true; pose.reset() }
        if (s.state === 'wear-off' || s.state === 'closed') worn = false
        logLine('INFO', 'Spatial', `Earbuds head tracking: ${s.state}${s.detail ? ` (${s.detail})` : ''}`)
        emitState(s.state)
      }))
      try {
        await plugin.start({ address: earbuds.address })
      } catch (e) {
        this.stop()
        throw new Error(`Couldn't reach ${earbuds.name}'s motion sensor (${e instanceof Error ? e.message : String(e)}). If Samsung's Galaxy Wearable app is open, close it and try again.`)
      }
    },
    stop() {
      void plugin?.stop()
      handles.splice(0).forEach((h) => void h.remove())
      worn = false
    },
    recenter() {
      pose.recenter()
    },
    calibrate(progress) {
      measuring?.done('failed')
      return new Promise((done) => { measuring = { cal: new LookCalibration(), progress, done } })
    },
    setFollow(minDeg) {
      pose.autoRecentre = minDeg !== null
      if (minDeg !== null) pose.followMinDeg = minDeg
    },
    cancelCalibration() {
      const m = measuring
      measuring = null
      m?.done('failed')
    },
    onPose(cb) {
      poseCbs.add(cb)
      return () => poseCbs.delete(cb)
    },
    onState(cb) {
      stateCbs.add(cb)
      return () => stateCbs.delete(cb)
    },
  }
}

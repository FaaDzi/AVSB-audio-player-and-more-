// §104 C: head tracking from Galaxy Buds' own motion sensor (Android; native plugin BudsHeadTrackerPlugin.kt).
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { HeadPose, HeadTracker } from '../spatial/types'
import { isAndroid } from '../platform'
import { AudioRoute } from '../audio/speakerGuard'
import { BudsPose, NodCalibration, normalize, type Quat } from './budsMath'
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
const savedLift = (address: string) => {
  try {
    const v = JSON.parse(localStorage.getItem(liftKey(address)) ?? 'null') as number[] | null
    return v && v.length === 3 ? normalize(v) : null
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
  /** Look straight ahead, then nod within 3 s: measures and saves this pair's tilt. */
  calibrate(): Promise<'saved' | 'too-small'>
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
  let lastT = 0
  let measuring: { until: number; nod: NodCalibration; done: (r: 'saved' | 'too-small') => void } | null = null

  const emitState = (s: string) => stateCbs.forEach((cb) => cb(s))

  return {
    kind: 'earbuds',
    get earbuds() { return earbuds },
    get faceVisible() { return worn },
    get calibrated() { return calibrated },
    async start() {
      if (!plugin) throw new Error('Head tracking from earbuds works on the phone.')
      const found = await findEarbuds()
      if (!found.length) throw new Error("No Galaxy Buds paired with this phone. Other earbuds don't share their head tracking.")
      earbuds = found[0]
      logLine('INFO', 'Spatial', `Earbuds head tracking: connecting to ${earbuds.name}`)
      const lift = savedLift(earbuds.address)
      calibrated = Boolean(lift)
      if (lift) pose.liftAxis = lift
      handles.push(await plugin.addListener('pose', (p) => {
        worn = true
        lastT = p.t
        const raw: Quat = [p.x, p.y, p.z, p.w]
        if (measuring) {
          measuring.nod.add(raw)
          if (p.t >= measuring.until) {
            const best = measuring.nod.result()
            const done = measuring.done
            measuring = null
            if (best && earbuds) {
              pose.liftAxis = best
              calibrated = true
              try { localStorage.setItem(liftKey(earbuds.address), JSON.stringify(best)) } catch { /* not saved */ }
              done('saved')
            } else done('too-small')
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
    calibrate() {
      // the user looks straight ahead now, then nods within 3 s (counted in the plugin's clock)
      pose.recenter()
      const ref = pose.current
      if (!ref) return Promise.resolve('too-small' as const)
      return new Promise((done) => { measuring = { until: lastT + 3000, nod: new NodCalibration(ref), done } })
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

/**
 * Runs the face landmarker off the main thread (detectForVideo blocks for 10–30 ms a frame).
 * In:  { type: 'init', base } then { type: 'frame', bitmap, t } (the bitmap is transferred).
 * Out: { type: 'ready', delegate } | { type: 'error', message } | { type: 'pose', t, d } (d: Detection | null).
 */
import { createLandmarker, type Detection, type Landmarker } from './landmarker'

type In = { type: 'init'; base: string } | { type: 'frame'; bitmap: ImageBitmap; t: number }

const scope = self as unknown as {
  postMessage(msg: unknown): void
  onmessage: ((e: MessageEvent<In>) => void) | null
}

let lm: Landmarker | null = null

scope.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      lm = await createLandmarker(msg.base)
      scope.postMessage({ type: 'ready', delegate: lm.delegate })
    } catch (err) {
      scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  let d: Detection | null = null
  try {
    if (lm) d = lm.detect(msg.bitmap, msg.t)
  } catch {
    d = null
  } finally {
    msg.bitmap.close()
  }
  scope.postMessage({ type: 'pose', t: msg.t, d })
}

/**
 * MediaPipe Face Landmarker, loaded from the app's own files (public/mediapipe/, copied there by
 * vite.config.ts) so it works offline in Electron and the Android WebView. Used by the worker and,
 * if a worker can't run it, by camera.ts on the main thread.
 */
import { FaceLandmarker } from '@mediapipe/tasks-vision'

export interface Landmarker {
  readonly delegate: 'GPU' | 'CPU'
  /** The face transform (4x4, column-major) and landmarks for this frame, or null when there's no face. */
  detect(frame: TexImageSource, t: number): Detection | null
  close(): void
}

/** One frame: the face transform, and the 478 face landmarks (x only: enough to size the head). */
export interface Detection {
  m: number[]
  xs: number[]
}

type Factory = (...args: unknown[]) => unknown

/**
 * `base` is the absolute URL of the mediapipe folder (ending in /). The ES-module WASM build is
 * imported once and handed to MediaPipe as `ModuleFactory` for each attempt, so the CPU retry
 * after a failed GPU start doesn't depend on the module being evaluated twice.
 */
export async function createLandmarker(base: string): Promise<Landmarker> {
  let factory: Factory
  try {
    const mod = (await import(/* @vite-ignore */ `${base}wasm/vision_wasm_module_internal.js`)) as { default: Factory }
    factory = mod.default
  } catch (e) {
    throw new Error(`Head tracking model failed to load (${e instanceof Error ? e.message : String(e)})`)
  }
  const fileset = { wasmLoaderPath: '', wasmBinaryPath: `${base}wasm/vision_wasm_module_internal.wasm` }
  let lastError: unknown
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      ;(globalThis as { ModuleFactory?: Factory }).ModuleFactory = factory
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      })
      return {
        delegate,
        detect(frame, t) {
          const r = lm.detectForVideo(frame, t)
          const m = r.facialTransformationMatrixes?.[0]
          if (!m || m.data.length < 16) return null
          return { m: Array.from(m.data), xs: (r.faceLandmarks?.[0] ?? []).map((p) => p.x) }
        },
        close: () => lm.close(),
      }
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(`Head tracking model failed to load (${lastError instanceof Error ? lastError.message : String(lastError)})`)
}

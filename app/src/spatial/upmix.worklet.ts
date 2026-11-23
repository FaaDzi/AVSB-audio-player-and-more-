// §104 D: the "360" pan split on the audio thread (logic in upmixCore.ts). One stereo input, one output of
// UPMIX_OUTPUTS channels: five pan sources (hard left → hard right) and the left/right ambience.
import { PanSplitter } from './upmixCore'

// the AudioWorkletGlobalScope isn't in TypeScript's DOM types
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

class UpmixProcessor extends AudioWorkletProcessor {
  private sp = new PanSplitter()
  constructor() {
    super()
    // §107 A: the stage says 'reset' each time 360 is plugged back in
    this.port.onmessage = () => this.sp.reset()
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const out = outputs[0]
    if (!input?.length) {
      for (const ch of out) ch.fill(0)
      return true
    }
    this.sp.process(input[0], input[1] ?? input[0], out)
    return true
  }
}

registerProcessor('avsb-upmix', UpmixProcessor)

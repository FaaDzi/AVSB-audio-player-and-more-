// §104 D: "360" upmix without AI. Splits a stereo mix, frequency by frequency (STFT), into five sources by where each
// sound is panned (hard left … hard right) plus left/right ambience (what the two channels don't share: reverb, room,
// wide pads), after Avendano & Jot, "A frequency-domain approach to multichannel upmix" (JAES 2004): the inter-channel
// coherence picks out the ambience, the level difference gives the pan position. The stage then places each source
// around the listener, so turning the head toward the left-panned cymbals brings them in front.

/** Pan sources, hard left → hard right, then ambience left, ambience right. */
export const UPMIX_OUTPUTS = 7
export const PAN_SOURCES = 5
export const FRAME = 1024
export const HOP = 256
/** Per-frame smoothing of the cross-spectra the coherence is measured from (~70 ms at 48 kHz). */
const SMOOTH = 0.8

/** In-place iterative radix-2 FFT on separate real/imaginary arrays; `inverse` scales by 1/n. */
export class Fft {
  readonly n: number
  private rev: Uint32Array
  private cos: Float64Array
  private sin: Float64Array
  constructor(n: number) {
    this.n = n
    const bits = Math.log2(n)
    if (!Number.isInteger(bits)) throw new Error('FFT size must be a power of two')
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((2 * Math.PI * i) / n)
    }
  }

  run(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    const sign = inverse ? 1 : -1
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]
          const s = sign * this.sin[k * step]
          const a = start + k
          const b = a + half
          const tr = re[b] * c - im[b] * s
          const ti = re[b] * s + im[b] * c
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
  }
}

/**
 * Streaming splitter: feed stereo blocks, get UPMIX_OUTPUTS mono streams back, FRAME samples late.
 * sqrt-Hann analysis and synthesis windows at 75 % overlap add back up to a constant, so with the five pan weights
 * at constant power and ambience/direct split at constant power, the outputs hold the input's energy.
 */
export class PanSplitter {
  private fft = new Fft(FRAME)
  private win = new Float64Array(FRAME)
  private bufL = new Float64Array(FRAME)
  private bufR = new Float64Array(FRAME)
  private acc: Float64Array[] = []
  private ready: Float64Array[] = []
  private fill = 0
  private sLL = new Float64Array(FRAME / 2 + 1)
  private sRR = new Float64Array(FRAME / 2 + 1)
  private sLRr = new Float64Array(FRAME / 2 + 1)
  private sLRi = new Float64Array(FRAME / 2 + 1)
  // scratch
  private lr = new Float64Array(FRAME)
  private li = new Float64Array(FRAME)
  private rr = new Float64Array(FRAME)
  private ri = new Float64Array(FRAME)
  private or: Float64Array[] = []
  private oi: Float64Array[] = []

  constructor() {
    for (let i = 0; i < FRAME; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME))
    for (let k = 0; k < UPMIX_OUTPUTS; k++) {
      this.acc.push(new Float64Array(FRAME))
      this.ready.push(new Float64Array(HOP))
      this.or.push(new Float64Array(FRAME))
      this.oi.push(new Float64Array(FRAME))
    }
  }

  /** Processes one block in place of the stereo input; `outs` gets UPMIX_OUTPUTS channels of the same length. */
  process(inL: Float32Array, inR: Float32Array, outs: Float32Array[]) {
    const n = inL.length
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < UPMIX_OUTPUTS; k++) outs[k][i] = this.ready[k][this.fill]
      this.bufL[FRAME - HOP + this.fill] = inL[i]
      this.bufR[FRAME - HOP + this.fill] = inR[i]
      if (++this.fill === HOP) {
        this.fill = 0
        this.frame()
      }
    }
  }

  private frame() {
    const { win, lr, li, rr, ri, fft } = this
    for (let i = 0; i < FRAME; i++) {
      lr[i] = this.bufL[i] * win[i]
      rr[i] = this.bufR[i] * win[i]
      li[i] = 0
      ri[i] = 0
    }
    fft.run(lr, li)
    fft.run(rr, ri)
    for (let k = 0; k < UPMIX_OUTPUTS; k++) {
      this.or[k].fill(0)
      this.oi[k].fill(0)
    }
    const eps = 1e-12
    for (let b = 0; b <= FRAME / 2; b++) {
      const Lr = lr[b], Li = li[b], Rr = rr[b], Ri = ri[b]
      const pL = Lr * Lr + Li * Li
      const pR = Rr * Rr + Ri * Ri
      // smoothed cross-spectra → coherence φ (1 = the same sound in both channels, 0 = unrelated)
      this.sLL[b] = SMOOTH * this.sLL[b] + (1 - SMOOTH) * pL
      this.sRR[b] = SMOOTH * this.sRR[b] + (1 - SMOOTH) * pR
      this.sLRr[b] = SMOOTH * this.sLRr[b] + (1 - SMOOTH) * (Lr * Rr + Li * Ri)
      this.sLRi[b] = SMOOTH * this.sLRi[b] + (1 - SMOOTH) * (Li * Rr - Lr * Ri)
      const both = Math.sqrt(this.sLL[b] * this.sRR[b])
      const phi = Math.hypot(this.sLRr[b], this.sLRi[b]) / (both + eps)
      // a sound in one channel only has no coherence to measure, but it's clearly direct: ambience needs both
      // channels at similar levels and unrelated (balance 1 = equal levels, 0 = one channel silent)
      const balance = (2 * both) / (this.sLL[b] + this.sRR[b] + eps)
      const amb = Math.min(1, Math.max(0, (1 - phi) * balance))
      const direct = Math.sqrt(1 - amb)
      const ambient = Math.sqrt(amb)
      // the direct part as one source: the channels' sum, carrying both channels' energy
      let mr = (Lr + Rr) / 2
      let mi = (Li + Ri) / 2
      const mMag = Math.hypot(mr, mi)
      const g = Math.min(8, Math.sqrt(pL + pR) / (mMag + eps))
      mr *= g * direct
      mi *= g * direct
      // where it sits: -1 hard left … +1 hard right, onto the five sources at constant power
      const aL = Math.sqrt(pL)
      const aR = Math.sqrt(pR)
      const pan = (aR - aL) / (aL + aR + eps)
      const x = ((pan + 1) / 2) * (PAN_SOURCES - 1)
      const lo = Math.min(PAN_SOURCES - 2, Math.floor(x))
      const f = x - lo
      const wLo = Math.sqrt(1 - f)
      const wHi = Math.sqrt(f)
      this.or[lo][b] = mr * wLo
      this.oi[lo][b] = mi * wLo
      this.or[lo + 1][b] = mr * wHi
      this.oi[lo + 1][b] = mi * wHi
      this.or[PAN_SOURCES][b] = Lr * ambient
      this.oi[PAN_SOURCES][b] = Li * ambient
      this.or[PAN_SOURCES + 1][b] = Rr * ambient
      this.oi[PAN_SOURCES + 1][b] = Ri * ambient
    }
    for (let k = 0; k < UPMIX_OUTPUTS; k++) {
      const re = this.or[k]
      const im = this.oi[k]
      // a real signal's spectrum is conjugate-symmetric
      for (let b = 1; b < FRAME / 2; b++) {
        re[FRAME - b] = re[b]
        im[FRAME - b] = -im[b]
      }
      fft.run(re, im, true)
      const acc = this.acc[k]
      // sqrt-Hann² = Hann, which sums to 2 at 75 % overlap
      for (let i = 0; i < FRAME; i++) acc[i] += re[i] * win[i] * 0.5
      this.ready[k].set(acc.subarray(0, HOP))
      acc.copyWithin(0, HOP)
      acc.fill(0, FRAME - HOP)
    }
    this.bufL.copyWithin(0, HOP)
    this.bufR.copyWithin(0, HOP)
  }
}

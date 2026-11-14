/**
 * A USB HID link to a DSP cable or dongle: WebHID in the Windows app (Chromium), a small
 * native plugin on Android (WebView has no WebHID). Both deliver the same reports.
 */
import { registerPlugin } from '@capacitor/core'
import { isAndroid } from '../platform'
import { KT_MICRO_VENDOR } from './ktmicro'

export interface DspTransport {
  vendorId: number
  productId: number
  productName: string
  send(reportId: number, data: Uint8Array): Promise<void>
  /** Subscribe to input reports; returns the unsubscribe. */
  onReport(cb: (reportId: number, data: Uint8Array) => void): () => void
  close(): Promise<void>
}

type HidLike = {
  vendorId: number
  productId: number
  productName: string
  opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  sendReport(id: number, data: BufferSource): Promise<void>
  addEventListener(t: 'inputreport', cb: (e: { reportId: number; data: DataView }) => void): void
  removeEventListener(t: 'inputreport', cb: (e: { reportId: number; data: DataView }) => void): void
}
type HidApi = { requestDevice(o: { filters: { vendorId: number }[] }): Promise<HidLike[]> }

interface DspUsbPlugin {
  connect(o: { vendorId: number }): Promise<{ vendorId: number; productId: number; productName: string }>
  send(o: { reportId: number; data: number[] }): Promise<void>
  disconnect(): Promise<void>
  addListener(e: 'report', cb: (r: { reportId: number; data: number[] }) => void): Promise<{ remove: () => Promise<void> }>
}
const DspUsb = registerPlugin<DspUsbPlugin>('DspUsb')

const hid = () => (navigator as Navigator & { hid?: HidApi }).hid

/** Whether this build can talk to USB DSPs at all. */
export const canUseDsp = () => isAndroid() || !!hid()

/** Ask for a supported DSP (the system's device prompt where there is one); null if none was picked. */
export async function connectDsp(): Promise<DspTransport | null> {
  if (isAndroid()) {
    const info = await DspUsb.connect({ vendorId: KT_MICRO_VENDOR })
    const subs = new Set<(id: number, d: Uint8Array) => void>()
    const listener = await DspUsb.addListener('report', (r) => subs.forEach((cb) => cb(r.reportId, Uint8Array.from(r.data))))
    return {
      ...info,
      send: (reportId, data) => DspUsb.send({ reportId, data: Array.from(data) }),
      onReport: (cb) => (subs.add(cb), () => void subs.delete(cb)),
      close: async () => {
        await listener.remove()
        await DspUsb.disconnect()
      },
    }
  }
  const api = hid()
  if (!api) return null
  const [dev] = await api.requestDevice({ filters: [{ vendorId: KT_MICRO_VENDOR }] })
  if (!dev) return null
  if (!dev.opened) await dev.open()
  return {
    vendorId: dev.vendorId,
    productId: dev.productId,
    productName: dev.productName,
    send: (id, data) => dev.sendReport(id, data as Uint8Array<ArrayBuffer>),
    onReport: (cb) => {
      const h = (e: { reportId: number; data: DataView }) => cb(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength))
      dev.addEventListener('inputreport', h)
      return () => dev.removeEventListener('inputreport', h)
    },
    close: () => dev.close(),
  }
}

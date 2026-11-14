// What shell-main.cjs loads for the phone link: bundled into electron/link.bundle.mjs for the packaged app (qrcode
// inside), with iroh left outside because it's a native module shipped as is (electron-builder.shell.json).
import QRCode from 'qrcode'

export { createLink } from './link.mjs'

/** The pairing link as an SVG QR code, for Settings → Pair a phone. */
export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })

export async function loadIroh() {
  const m = await import('@number0/iroh')
  return m.default ?? m
}

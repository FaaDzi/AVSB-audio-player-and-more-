import { AudioRoute, type AndroidOutput } from '../audio/speakerGuard'
import { isAndroid } from '../platform'
/** Bridge to the Electron main process (absent in a plain browser). */
interface IemAppBridge {
  audioEffects(): Promise<{ name: string; detail: string }[]>
  openSoundSettings(): Promise<void>
  toggleFullscreen?(): Promise<boolean>
  /** Absolute path of a picked file (exe only). */
  pathOfFile?(file: File): string
  /** Audio files under a folder, recursively (exe only). */
  listSongs?(folder: string): Promise<{ path: string; name: string; size: number }[]>
  /** Bytes of one file returned by listSongs (exe only). */
  readSong?(path: string): Promise<Uint8Array>
  /** Audio files in userData cloud-songs directory (exe only). */
  cloudSongsList?(): Promise<{ path: string; name: string; size: number }[]>
  /** Download a song from the shared Drive folder in the main process (exe only; Drive refuses page requests). */
  cloudSongsDownload?(name: string, driveId: string, onBytes?: (loaded: number) => void): Promise<{ path: string; name: string; size: number }>
  /** Delete a downloaded cloud song (exe only). */
  cloudSongsDelete?(name: string): Promise<boolean>
  /** Delete all downloaded cloud songs (exe only). */
  cloudSongsClear?(): Promise<boolean>
  /** Progress on the taskbar icon (0-1, -1 removes it) while songs download (exe only). */
  setProgress?(fraction: number, mode?: 'normal' | 'paused'): void
}

declare global {
  interface Window {
    iemApp?: IemAppBridge
  }
}

export const bridge = (): IemAppBridge | null => window.iemApp ?? null

export async function toggleAppFullscreen(): Promise<boolean> {
  const b = bridge()
  if (b?.toggleFullscreen) return b.toggleFullscreen()
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
      return true
    } else {
      await document.exitFullscreen()
      return false
    }
  } catch {
    return false
  }
}

export interface OutputDevice {
  id: string
  label: string
  /** USB vendor:product id from the Windows label, e.g. "3302:43e6". */
  usb: string | null
}

/**
 * The Android output as the Windows-style device the classifier reads: a Bluetooth device's name
 * gets "(Bluetooth)" so it's taken for one even when the model isn't known; USB keeps its id.
 */
export function androidOutputDevice(o: AndroidOutput): OutputDevice | null {
  if (!o.type) return null
  const name = (o.name ?? '').trim()
  const label =
    o.type === 'bluetooth' ? `${name || 'Headphones'} (Bluetooth)`
    : o.type === 'speaker' ? 'Speaker (phone)'
    : o.type === 'wired' ? `${name || 'Wired headphones'} (3.5 mm)`
    : name || 'USB audio'
  return { id: 'android', label, usb: o.type === 'usb' ? (o.usb ?? null) : null }
}

/** The current default output device as Windows names it ("Default - Headphones (X) (vid:pid)"); on Android, from the native route. */
export async function defaultOutput(): Promise<OutputDevice | null> {
  // Android's WebView lists no named outputs: ask the phone what media plays to
  if (isAndroid()) return AudioRoute.output().then(androidOutputDevice, () => null)
  if (!navigator.mediaDevices?.enumerateDevices) return null
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
  const def = outs.find((d) => d.deviceId === 'default') ?? outs[0]
  if (!def || !def.label) return null // no name available: say nothing rather than guess
  const label = def.label.replace(/^Default - /, '')
  const usb = label.match(/\(([0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i)?.[1].toLowerCase() ?? null
  return { id: def.deviceId, label, usb }
}

/** Calls `cb` whenever an output device is plugged in, removed or changed. */
export function onDeviceChange(cb: () => void): () => void {
  if (isAndroid()) {
    const sub = AudioRoute.addListener('devices', () => cb()).catch(() => null)
    return () => void sub.then((h) => h?.remove())
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', cb)
  return () => navigator.mediaDevices?.removeEventListener?.('devicechange', cb)
}

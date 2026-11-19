import { saveFile } from '../../platform'
import type { Track } from '../library'

/** Route ids for a Home shelf opened as a playlist page (§89 C). */
export const SHELF_PREFIX = 'shelf:'

const SIDE = 400

/** Lets you pick an image and returns it cut to a centred square, as a small JPEG data URL. Null if nothing was picked. */
export function pickSquareImage(): Promise<string | null> {
  return new Promise((done, fail) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return done(null)
      createImageBitmap(file).then((img) => {
        const side = Math.min(img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = Math.min(SIDE, side)
        canvas.getContext('2d')?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
        img.close()
        done(canvas.toDataURL('image/jpeg', 0.82))
      }, fail)
    }
    input.click()
  })
}

/** A playlist as an .m3u8 file: the share sheet on the phone, a download on the PC. */
export async function sharePlaylist(name: string, tracks: Pick<Track, 'title' | 'artist' | 'sec' | 'path'>[]) {
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`]
  for (const t of tracks) lines.push(`#EXTINF:${Math.round(t.sec)},${t.artist ? `${t.artist} - ` : ''}${t.title}`, t.path)
  await saveFile(`${name}.m3u8`, new Blob([lines.join('\n') + '\n'], { type: 'audio/x-mpegurl' }))
}

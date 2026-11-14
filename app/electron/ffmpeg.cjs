const fs = require('node:fs')
const path = require('node:path')

/**
 * Resolves the bundled or developer ffmpeg binary before falling back to system PATH.
 * In packaged AVSB.exe builds, electron-builder places ffmpeg.exe under `process.resourcesPath/ffmpeg/bin/`.
 */
function resolveFfmpegBin(explicit) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = [
    explicit,
    process.env.AVSB_FFMPEG_BIN,
    process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', 'bin', exe) : null,
    path.resolve(__dirname, '..', '..', 'tools', 'ffmpeg', 'bin', exe),
    path.resolve(__dirname, '..', '..', '..', 'tools', 'ffmpeg', 'bin', exe),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return 'ffmpeg'
}

module.exports = { resolveFfmpegBin }

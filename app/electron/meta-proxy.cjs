// Song details lookup, for the new UI's Song page. The page can't call these services itself: Deezer sends no CORS
// header, and MusicBrainz asks every caller to name itself in the User-Agent, which a page can't set. So the page asks
// /shell-host/meta?url=..., and only these addresses are ever fetched. Shared by the dev server and the exe.

const ALLOWED = [
  'https://musicbrainz.org/ws/2/',
  'https://coverartarchive.org/release/',
  'https://coverartarchive.org/release-group/',
  'https://api.deezer.com/',
  'https://cdn-images.dzcdn.net/images/cover/',
  'https://cdn-images.dzcdn.net/images/artist/',
  'https://e-cdns-images.dzcdn.net/images/artist/',
  'https://e-cdns-images.dzcdn.net/images/cover/',
  'https://itunes.apple.com/search',
  'https://is1-ssl.mzstatic.com/',
  'https://is2-ssl.mzstatic.com/',
  'https://is3-ssl.mzstatic.com/',
  'https://is4-ssl.mzstatic.com/',
  'https://is5-ssl.mzstatic.com/',
]
const USER_AGENT = 'MusicPreferences/0.1.0 (desktop music player; song details looked up on request)'
const MAX_BYTES = 8e6

function allowedMetaUrl(text) {
  try {
    const url = new URL(String(text))
    return url.protocol === 'https:' && ALLOWED.some((start) => url.href.startsWith(start)) ? url.href : null
  } catch {
    return null
  }
}

/** Answers { status, type, body } for an allowed address, or null for any other. Redirects (Cover Art Archive's) are followed. */
async function fetchMeta(text, fetchImpl = fetch) {
  const url = allowedMetaUrl(text)
  if (!url) return null
  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, image/*' }, redirect: 'follow' })
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > MAX_BYTES) return { status: 502, type: 'text/plain', body: Buffer.from('too large') }
  return { status: response.status, type: response.headers.get('content-type') || 'application/octet-stream', body }
}

module.exports = { allowedMetaUrl, fetchMeta }

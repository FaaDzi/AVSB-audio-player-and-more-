// One-off probe (not part of the suite: run with PROBE=1): how well Look up details and online lyrics name the songs
// on the owner's phone, mostly YouTube rips. Reads .cache/phone_songs.txt (adb content query of MediaStore).
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { fetchMeta } from '../../electron/meta-proxy.cjs'
import { lookUp } from './metadata'
import { searchOnline } from './onlineLyrics'
import { readingsOf, type Track } from './library'

const run = process.env.PROBE ? describe : describe.skip

run('metadata probe', { timeout: 30 * 60_000 }, () => {
  it('looks up a spread of the phone songs', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/shell-host/meta?url=')) {
        const r = await fetchMeta(decodeURIComponent(url.slice('/shell-host/meta?url='.length)))
        if (!r) return new Response('not found', { status: 404 })
        return new Response(r.body, { status: r.status, headers: { 'content-type': r.type } })
      }
      return realFetch(input, init)
    }) as typeof fetch
    const rows = readFileSync('../.cache/phone_songs.txt', 'utf8').split('\n').filter((l) => l.includes('relative_path=Music/the music/'))
    const songs = rows.map((l, i) => {
      const get = (k: string) => (l.match(new RegExp(`${k}=(.*?), (?:\\w+=|$)`)) ?? [])[1] ?? ''
      const artist = get('artist')
      return { id: `p${i}`, title: get('title'), artist: artist === '<unknown>' ? '' : artist, album: '', sec: Number(get('duration')) / 1000, isrc: '', cover: '' } as unknown as Track
    })
    const step = Math.floor(songs.length / 30)
    const sample = songs.filter((_, i) => i % step === 0).slice(0, 30)
    const lines: string[] = []
    let named = 0, possible = 0, lyrics = 0, covers = 0
    for (const s of sample) {
      const r = await lookUp(s).catch(() => ({ found: null, possible: null, identity: undefined }))
      const lyr = await searchOnline(s).catch(() => null)
      if (r.found) named++
      else if (r.possible) possible++
      if (lyr) lyrics++
      if (r.found?.cover) covers++
      const first = readingsOf(s)[0]
      lines.push(`| ${s.title.replace(/\|/g, '/')} | ${r.identity ? `${r.identity.artist} – ${r.identity.title}` : r.possible ? 'possible only' : '–'} | ${r.found?.values.album ?? r.possible?.values.album ?? ''} | ${r.found?.cover ? 'yes' : ''} | ${lyr ? 'yes' : ''} | ${first.artist ? `${first.artist} / ${first.title}` : first.title} |`)
      console.log(lines[lines.length - 1])
    }
    const head = `Sample: ${sample.length} of ${songs.length} songs in Music/the music\n\nNamed (strong match): ${named}\nPossible only (needs a tap to accept): ${possible}\nCover found: ${covers}\nLyrics found (lrclib): ${lyrics}\n\n| File title | Identified as | Album | Cover | Lyrics | First reading tried |\n|---|---|---|---|---|---|\n`
    writeFileSync('../.cache/metaprobe.md', head + lines.join('\n') + '\n')
    console.log(head)
  })
})

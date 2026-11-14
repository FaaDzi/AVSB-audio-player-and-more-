/**
 * Build the song list from what's actually in songs/originals:
 *   1. pair each file with a hand-labelled manifest song (pinned by data/song_metadata.json,
 *      else the app's fuzzy match), or make a new entry from the hand-written metadata;
 *   2. calibrate the speciality guesser (sound measurements + MusicBrainz tags from
 *      data/song_tags.json) on the hand-labelled songs, leave-one-out so the reported
 *      accuracy is on songs the model didn't see;
 *   3. guess the speciality of every new song (marked `auto: true`);
 *   4. write songs/manifest.json, src/songs/specialityModel.json and songs/ANALYSIS.md.
 *
 * Needs data/song_features.json from scripts/song_features.ts.
 * Usage (from app/): npx vite-node scripts/build_songs.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classify, FEATURE_KEYS, fitModel, inputs, type SongFeatures, type SpecialityModel } from '../src/songs/analyze'
import { buildLibrary, type Category, type SongInfo, type SongManifest } from '../src/songs/library'
import { TAG_KEYS, tagVector, type WebTag } from '../src/songs/tags'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const manifest: SongManifest & Record<string, unknown> = read('songs/manifest.json')
const features: Record<string, SongFeatures> = read('data/song_features.json')
type Meta = { old?: string; artist?: string; title?: string; album?: string; year?: number | null; genre?: string; from?: string }
// keyed by track number; "07", "7" and "007" are the same track
const meta: Record<string, Meta> = Object.fromEntries(
  Object.entries(read('data/song_metadata.json') as Record<string, Meta>).map(([k, v]) => [String(Number(k)), v]),
)
const CATS = Object.keys(manifest.categories) as Category[]

const stem = (f: string) => f.replace(/\.[^.]+$/, '')
const num = (f: string) => String(Number(/^(\d+)\s*-/.exec(f)?.[1] ?? NaN))
const files = readdirSync(join(ROOT, 'songs', 'originals'))
  .filter((f) => /\.(flac|wav|mp3|m4a|ogg|opus)$/i.test(f))
  .sort((a, b) => Number(num(a)) - Number(num(b)))

// ---- 1. pair files with songs ----
// Guessed entries are rebuilt every run. To correct a guess, edit its category in
// songs/manifest.json and delete its "auto": true — it then counts as hand-labelled.
manifest.songs = manifest.songs.filter((s) => !s.auto)
const byId = new Map(manifest.songs.map((s) => [s.id, s]))
const fileOf = new Map<string, string>() // song id -> file
const claimed = new Set<string>()
const claim = (id: string, f: string) => {
  fileOf.set(id, f)
  claimed.add(f)
}
// a) songs already pinned to a file in the manifest, b) pins in data/song_metadata.json
for (const s of manifest.songs) {
  const f = s.fileName !== undefined ? files.find((x) => stem(x) === s.fileName) : undefined
  if (f) claim(s.id, f)
}
for (const f of files) {
  const old = meta[num(f)]?.old
  if (!old || claimed.has(f) || fileOf.has(old)) continue
  if (!byId.has(old)) throw new Error(`${f}: unknown manifest id ${old}`)
  claim(old, f)
}
// c) files with no hand metadata: try the app's fuzzy matcher
const loose = files.filter((f) => !claimed.has(f) && !meta[num(f)])
const lib = buildLibrary(
  { ...manifest, songs: manifest.songs.filter((s) => !fileOf.has(s.id)) },
  loose.map((name) => ({ name, size: 0, arrayBuffer: async () => new ArrayBuffer(0) })),
)
for (const s of lib.songs) if (!s.id.startsWith('extra-')) claim(s.id, s.file.name)

const songs: SongInfo[] = []
const fresh: SongInfo[] = []
for (const f of files) {
  const oldId = [...fileOf.entries()].find(([, file]) => file === f)?.[0]
  if (oldId) {
    songs.push({ ...byId.get(oldId)!, fileName: stem(f) })
    continue
  }
  const m = meta[num(f)]
  if (!m) throw new Error(`${f}: not in the old list and no entry in data/song_metadata.json`)
  const s: SongInfo = {
    id: `s-${num(f).padStart(3, '0')}`,
    artist: m.artist ?? '',
    title: m.title ?? stem(f),
    album: m.album ?? '',
    year: m.year ?? null,
    category: 'any',
    also: [],
    genre: m.genre ?? 'unknown',
    ...(m.from ? { from: m.from } : {}),
    clip: { start: null, end: null },
    fileName: stem(f),
    auto: true,
  }
  songs.push(s)
  fresh.push(s)
}
const featOf = (s: SongInfo) => features[`${s.fileName}.flac`] ?? features[Object.keys(features).find((k) => stem(k) === s.fileName)!]
for (const s of songs) if (!featOf(s)) throw new Error(`no features for ${s.fileName}; run scripts/song_features.ts`)
// Smart volume levels (scripts/song_loudness.ts), so the player needn't measure bundled songs
const levels: Record<string, { lufs: number; peak: number }> = existsSync(join(ROOT, 'data', 'song_loudness.json')) ? read('data/song_loudness.json') : {}
for (const s of songs) {
  const k = Object.keys(levels).find((f) => stem(f) === s.fileName)
  if (k) s.level = levels[k]
  else delete s.level
}

// web tags from MusicBrainz (scripts/musicbrainz_tags.py); missing for songs it couldn't find
type WebInfo = { match?: { title: string; artist: string } | null; year?: number | null; album?: string | null; genres?: WebTag[]; tags?: WebTag[]; artist_genres?: WebTag[]; artist_tags?: WebTag[] }
const web: Record<string, WebInfo> = existsSync(join(ROOT, 'data', 'song_tags.json')) ? read('data/song_tags.json') : {}
const tagsOf = (s: SongInfo) => {
  const w = web[s.id]
  return w ? tagVector([...(w.genres ?? []), ...(w.tags ?? [])], [...(w.artist_genres ?? []), ...(w.artist_tags ?? [])]) : null
}
const KEYS = [...FEATURE_KEYS, ...TAG_KEYS.map((k) => `tag:${k}`)]
const xOf = (s: SongInfo) => inputs(featOf(s), tagsOf(s), TAG_KEYS.length)

// ---- 2. calibrate on hand-labelled songs ----
const labelled = songs.filter((s) => !s.auto && s.category !== 'any').map((s) => ({ s, x: xOf(s), c: s.category as Category }))

type Rows = typeof labelled
function looAccuracy(rows: Rows, weight: number[]): { top1: number; top2: number; preds: Category[][] } {
  let top1 = 0, top2 = 0
  const preds: Category[][] = []
  rows.forEach((r, i) => {
    const model = fitModel(rows.filter((_, j) => j !== i), KEYS, weight)
    const ranked = classify(model, r.x).map((x) => x.category)
    preds.push(ranked)
    if (ranked[0] === r.c) top1++
    // a hand label's "also" counts for top-2: the song really does show off both
    if (ranked.slice(0, 2).includes(r.c) || (ranked[0] && r.s.also.includes(ranked[0]))) top2++
  })
  return { top1: top1 / rows.length, top2: top2 / rows.length, preds }
}

// two set-ups, both scored leave-one-out; the better one is used
const setups = [
  { name: 'sound only', w: KEYS.map((k) => (k.startsWith('tag:') ? 0 : 1)) },
  { name: 'sound + web tags', w: KEYS.map(() => 1) },
].map((u) => ({ ...u, ...looAccuracy(labelled, u.w) }))
const best = setups.reduce((a, b) => (b.top1 > a.top1 ? b : a))
const model: SpecialityModel = fitModel(labelled, KEYS, best.w)
const perCat = (preds: Category[][]) =>
  CATS.map((c) => {
    const mine = labelled.map((r, i) => ({ r, p: preds[i][0] })).filter((x) => x.r.c === c)
    return mine.filter((x) => x.p === c).length / Math.max(1, mine.length)
  })

// ---- 3. guess new songs ----
const ALSO_MIN = 0.25
for (const s of fresh) {
  const ranked = classify(model, xOf(s))
  s.category = ranked[0].category
  s.also = ranked.slice(1).filter((r) => r.score >= ALSO_MIN).map((r) => r.category).slice(0, 1)
}

// ---- 4. write ----
// a song whose file left songs/originals leaves the list too (it used to be kept, unused)
const inFolder = new Set(songs.map((s) => s.id))
const notHere = manifest.songs.filter((s) => !inFolder.has(s.id))
writeFileSync(
  join(ROOT, 'songs', 'manifest.json'),
  JSON.stringify({ ...manifest, version: Number(manifest.version ?? 1) + 1, songs }, null, 2) + '\n',
)
const round = (v: number, d: number) => (Number.isFinite(v) ? +v.toFixed(d) : null)
writeFileSync(
  join(ROOT, 'app', 'src', 'songs', 'specialityModel.json'),
  JSON.stringify(
    { ...model, mean: model.mean.map((v) => round(v, 5)), std: model.std.map((v) => round(v, 5)), centroids: model.centroids.map((c) => ({ c: c.c, x: c.x.map((v) => round(v, 3)) })) },
    null,
    1,
  ) + '\n',
)

const pct = (x: number) => `${Math.round(x * 100)}%`
const confusion = CATS.map((c) => {
  const rows = labelled.map((r, i) => ({ r, p: best.preds[i][0] })).filter((x) => x.r.c === c)
  return `| ${c} | ${rows.length} | ${CATS.map((p) => rows.filter((x) => x.p === p).length || '·').join(' | ')} |`
})
// MusicBrainz often lands on a live/compilation release, so its year/album aren't trusted over the
// hand-written ones; it only suggests values where the list has none (for a person to check)
const suggestions = songs
  .filter((s) => web[s.id]?.match)
  .flatMap((s) => {
    const w = web[s.id]
    const out: string[] = []
    if (w.year && s.year === null) out.push(`year ${w.year}`)
    if (w.album && !s.album) out.push(`album "${w.album}"`)
    return out.length ? [`| ${num(s.fileName!)} | ${s.artist} — ${s.title} | ${out.join('; ')} |`] : []
  })
const md = `# Song analysis

Generated by \`app/scripts/build_songs.ts\`. ${files.length} audio files in \`songs/originals\`:
${songs.length - fresh.length} are hand-labelled songs from the list, ${fresh.length} are new and got a guessed speciality.
${notHere.length} songs from the old list had no file here and were dropped from the list.
${Object.values(web).filter((w) => w.match).length} songs were matched on MusicBrainz; ${songs.filter((s) => tagsOf(s)).length} have genre/tags.

## How well the guesser does

Calibrated on the ${labelled.length} hand-labelled songs. Every score below is leave-one-out: each song is guessed
by a model that never saw it. Chance level for 6 specialities is about ${pct(1 / CATS.length)}.

| inputs | right first guess | right in top 2 (or a hand "also") | ${CATS.join(' | ')} |
|---|---|---|${CATS.map(() => '---').join('|')}|
${setups.map((u) => `| ${u.name}${u === best ? ' (used)' : ''} | ${pct(u.top1)} | ${pct(u.top2)} | ${perCat(u.preds).map(pct).join(' | ')} |`).join('\n')}

Method: nearest centroid (each speciality's average song) on the sound measurements in
\`app/src/songs/analyze.ts\` plus, when known, MusicBrainz tag-group scores (\`app/src/songs/tags.ts\`).

Which speciality the hand-labelled songs got (rows: hand label, columns: guess):

| label | n | ${CATS.join(' | ')} |
|---|---|${CATS.map(() => '---').join('|')}|
${confusion.join('\n')}

## Guesses for the new songs (check these)

To fix one: set its category in \`songs/manifest.json\`, delete its \`"auto": true\`, and rerun the build. It then counts as hand-labelled.

| # | Artist | Title | Guess | Also | Confidence | Tags |
|---|---|---|---|---|---|---|
${fresh
  .map((s) => {
    const r = classify(model, xOf(s))
    return `| ${num(s.fileName!)} | ${s.artist} | ${s.title} | **${s.category}** | ${s.also.join(', ')} | ${pct(r[0].score)} | ${tagsOf(s) ? 'yes' : '—'} |`
  })
  .join('\n')}

## MusicBrainz suggestions for blanks in the list (not applied)

Only where the list has no year or album. MusicBrainz sometimes picks a compilation or live release, so check before copying.

${suggestions.length ? `| # | Song | MusicBrainz says |\n|---|---|---|\n${suggestions.join('\n')}` : 'None.'}

## Old-list songs with no file

${notHere.map((s) => `- ${s.artist} — ${s.title} (${s.category})`).join('\n')}
`
writeFileSync(join(ROOT, 'songs', 'ANALYSIS.md'), md)
console.log(setups.map((u) => `${u.name}: top1=${pct(u.top1)} top2=${pct(u.top2)} per-cat ${perCat(u.preds).map(pct).join('/')}`).join('\n'))
console.log(`songs ${songs.length} (new ${fresh.length}), labelled ${labelled.length}, not in folder ${notHere.length}, suggestions ${suggestions.length}`)

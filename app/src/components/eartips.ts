/**
 * Two ear tip reviewers side by side: Fernanda Gunsan's tier list (eartips.json, translated) and
 * Jay's Audio's tip database (eartips_jay.json, scripts/jay_eartips.py). A tip either rated is one
 * row; the 17 both rated carry both reviews.
 */
export interface FernandaTip {
  name: string
  tier: string | null
  tagline: string | null
  useOn: string | null
  review: string
  original: string
  usedWith: string | null
}

export interface JayRating {
  rating: string | null
  note: string
}

export interface JayTip {
  id: string
  name: string
  kind: 'silicone' | 'foam' | 'stock'
  tonality: string
  tech: JayRating | null
  build: string
  grip: JayRating | null
  flex: JayRating | null
  verdict: string
  photo: string | null
  graph: string | null
  /** The same tip's name in Fernanda's list. */
  fernanda?: string
}

export interface TipRow {
  key: string
  name: string
  kind: JayTip['kind'] | null
  photo: string | null
  fernanda: FernandaTip | null
  jay: JayTip | null
}

/** One row per tip, Jay's name and photo where he has it; A–Z. */
export function mergeTips(fernanda: FernandaTip[], jay: JayTip[]): TipRow[] {
  const byName = new Map(fernanda.map((f) => [f.name, f]))
  const rows: TipRow[] = jay.map((j) => {
    const f = (j.fernanda && byName.get(j.fernanda)) || null
    if (f) byName.delete(f.name)
    return { key: j.id, name: j.name, kind: j.kind, photo: j.photo, fernanda: f, jay: j }
  })
  for (const f of byName.values()) rows.push({ key: `fg-${f.name}`, name: f.name, kind: /foam/i.test(f.name) ? 'foam' : null, photo: null, fernanda: f, jay: null })
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

type Lean = 1 | 0 | -1

/** Fernanda: S/A recommend, B neutral, C and below don't. */
export function fernandaLean(f: FernandaTip): Lean {
  const t = (f.tier ?? '').trim().toUpperCase()[0]
  return t === 'S' || t === 'A' ? 1 : t === 'B' || !t ? 0 : -1
}

/** Jay: better technicalities, or great grip and flex with nothing lost, recommend; lost detail or a poor fit don't. */
export function jayLean(j: JayTip): Lean {
  const tech = j.tech?.rating
  const fit = [j.grip?.rating, j.flex?.rating]
  if (tech === 'Reduced' || fit.includes('Poor')) return -1
  if (tech === 'Improved' || (tech === 'No Change' && fit.every((r) => r === 'Great'))) return 1
  return 0
}

/** Both reviewed it and one recommends what the other doesn't. */
export function opinionsDiffer(row: TipRow): boolean {
  if (!row.fernanda || !row.jay) return false
  const f = fernandaLean(row.fernanda)
  const j = jayLean(row.jay)
  return f * j === -1
}

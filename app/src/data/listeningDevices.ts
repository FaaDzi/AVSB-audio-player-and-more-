// Devices you can listen on that aren't in the review catalog (plan §78 B, C): generic presets for no-name gear
// (scripts/build_generic_presets.py) and cheap powered speakers plus a soundbar from spinorama.org
// (scripts/build_speakers.py). They join the Database's merged catalog only, so they never enter a bracket.
import type { Band, Iem } from '../audio/data'
import type { Catalog } from './catalog'

interface Row {
  id: string
  name: string
  fr: number[]
  count?: number
  source?: string
  /** A photo (spinorama.org's picture), app-relative. */
  photo?: string
}

const NO_METRICS: Record<Band, number> = { subBass: 0, midBass: 0, lowerMids: 0, upperMids: 0, lowerTreble: 0, air: 0 }

function toIem(c: Catalog, r: Row, source: string): Iem {
  return {
    id: r.id,
    name: r.name,
    source,
    sources: [source],
    fr: Int16Array.from(r.fr, (v) => Math.round(v / c.data.frScale)),
    metrics: NO_METRICS,
  }
}

/** Adds them to the catalog in place; a file that's missing or on another grid is skipped. */
export function addListeningDevices(c: Catalog, generic: unknown, speakers: unknown, phoneSpeakers: unknown = null) {
  const sameGrid = (g: unknown) => Array.isArray(g) && g.length === c.data.grid.length
  const rows: Iem[] = []
  const gen = generic as { grid?: number[]; devices?: Row[] }
  if (sameGrid(gen.grid)) for (const r of gen.devices ?? []) rows.push(toIem(c, r, `Generic: median of ${r.count ?? 1} measured`))
  const spk = speakers as { grid?: number[]; speakers?: Row[] }
  if (sameGrid(spk.grid)) {
    for (const r of spk.speakers ?? []) {
      rows.push(toIem(c, r, r.source ?? 'spinorama.org'))
      if (r.photo && !c.images[r.id]) c.images[r.id] = { src: r.photo, store: 'spinorama.org', url: 'https://www.spinorama.org', title: r.name }
    }
  }
  // §106 F: phone and tablet speakers (scripts/build_phone_speakers.py), so a deleted one can be found and added again
  const phones = phoneSpeakers as { grid?: number[]; speakers?: Row[] } | null
  if (phones && sameGrid(phones.grid)) for (const r of phones.speakers ?? []) rows.push(toIem(c, r, r.source ?? 'Notebookcheck'))
  for (const r of rows) {
    if (c.byId.has(r.id)) continue
    c.data.iems.push(r)
    c.byId.set(r.id, r)
  }
}

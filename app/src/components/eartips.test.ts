import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeTips, opinionsDiffer, type FernandaTip, type JayTip } from './eartips'

const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf-8'))
const fernanda = load<{ tips: FernandaTip[] }>('eartips.json').tips
const jay = load<{ tips: JayTip[] }>('eartips_jay.json').tips

describe('ear tips from both reviewers', () => {
  const rows = mergeTips(fernanda, jay)
  it('every tip once: shared ones joined', () => {
    const shared = jay.filter((j) => j.fernanda).length
    expect(shared).toBe(17)
    expect(rows.length).toBe(fernanda.length + jay.length - shared)
    expect(rows.filter((r) => r.fernanda && r.jay).length).toBe(shared)
  })
  it('every Jay tip has its ratings, photo and graph', () => {
    for (const j of jay) {
      expect(j.tech?.rating, j.name).toBeTruthy()
      expect(j.grip?.rating, j.name).toBeTruthy()
      expect(j.flex?.rating, j.name).toBeTruthy()
      expect(j.photo && j.graph, j.name).toBeTruthy()
    }
  })
  it('flags a disagreement only when one recommends what the other does not', () => {
    const f = (tier: string): FernandaTip => ({ name: 'x', tier, tagline: null, useOn: null, review: '', original: '', usedWith: null })
    const j = (tech: string): JayTip => ({
      id: 'x', name: 'x', kind: 'silicone', tonality: '', build: '', verdict: '', photo: null, graph: null,
      tech: { rating: tech, note: '' }, grip: { rating: 'Normal', note: '' }, flex: { rating: 'Normal', note: '' },
    })
    const row = (ft: string, jt: string) => ({ key: 'x', name: 'x', kind: null, photo: null, fernanda: f(ft), jay: j(jt) })
    expect(opinionsDiffer(row('S', 'Reduced'))).toBe(true)
    expect(opinionsDiffer(row('C', 'Improved'))).toBe(true)
    expect(opinionsDiffer(row('B', 'Reduced'))).toBe(false)
    expect(opinionsDiffer(row('S', 'Improved'))).toBe(false)
  })
})

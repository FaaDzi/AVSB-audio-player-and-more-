/** The three kinds a tournament can be about (Preferences.compare). Their colours are CSS (tournament.css): Clean uses
 *  IEM yellow, headphones blue, TWS red; Game show keeps the old app's purple, orange and cyan (§65 decision). */
export type TourneyKind = 'iems' | 'headphones' | 'tws'
export const KINDS: TourneyKind[] = ['iems', 'headphones', 'tws']
const LABELS: Record<TourneyKind, string> = { iems: 'IEMs', headphones: 'Headphones', tws: 'TWS' }
export const kindLabel = (k?: string) => LABELS[(k ?? 'iems') as TourneyKind] ?? 'IEMs'

/** What a contender is, for the VS screen and match header: "IEM", "TWS", "Headphones · Open back". */
export function kindDetail(kind: string, back?: string): string {
  if (kind === 'tws') return 'TWS'
  if (kind === 'speakers') return 'Speakers'
  if (kind === 'soundbar') return 'Soundbar'
  if (kind !== 'headphones') return 'IEM'
  return back === 'open' ? 'Headphones · Open back' : back === 'semi-open' ? 'Headphones · Semi-open' : back === 'closed' ? 'Headphones · Closed back' : 'Headphones'
}

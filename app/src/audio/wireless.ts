/**
 * True-wireless earbuds in the database (AirPods, Galaxy Buds, Sony WF-…): measured on the same
 * ear simulators as wired IEMs, so they work as "the IEM in your ears" — with caveats the app
 * should say out loud (their own DSP, ANC modes, codecs). Recognised by name.
 */
const EARTIP_TWS =
  /\b(?:type\s*e|e-?type|final(?:\s+audio)?|azla|spinfit|divinus|velvet|sedna\w*)\s+tws(?:\s*(?:ear\s*)?tips?)?\b|\btws\s*(?:ear\s*)?tips?\b/gi

const WIRELESS =
  /\bairpods\b|galaxy buds|pixel buds|\bbuds\s?(?:\d|air|pro|plus|live|fe|\+)|\bwf-\w|\bwf\d{3,4}xm\d|linkbuds|soundcore (?:liberty|space|life|p\d|a\d|r\d|sport|vr)|liberty \d|\banker (?:liberty|r50i|p\d0i|a\d0i)|freebuds|momentum true wireless|accentum true wireless|\bcx ?(?:plus )?true wireless|\bcx ?400bt|jabra elite|nothing ear|\bear \(\d\)|\bear \((?:a|stick|open)\)|beats (?:studio buds|fit pro|powerbeats|solo buds)|\btws\d*\b|true wireless|\bqcy\b|\bearfun\b|moto buds|realme buds|oneplus buds|redmi buds|xiaomi buds|oppo enco|vivo tws|baseus bowie|soundpeats|haylou|tozo\b|edifier (?:tws|neobuds|lolli|w\d+nb|x\d)|moondrop (?:space travel|ultrasonic|golden ages|moca|nekocake|sparks|alice|block|voyager|kuroneko|pill)|bose (?:quietcomfort|qc) (?:ultra )?earbuds|bowers\s*(?:&|and)?\s*wilkins pi\d|devialet gemini|fiio fw\d|final ze\d{3,4}|kz (?:carol|sk10|vxs|xtra|az\d+|sa08|s\d\b|z\d\b|e10)|beoplay (?:e8|eq|ex|eleven)|technics eah-az\d+|denon perl|noble (?:audio )?fokus (?:pro|mystique|prestige|rex5|triumph|h-anc| Amadeus)|elite \d+t|status between|cambridge melomania|lypertek|nura ?true|master & dynamic mw0\d|akg n400|ath-(?:twx\d|cks\d+tw|sq1tw)|jbl (?:tour pro|live (?:pro|free|beam|flex)|wave|vibe|tune (?:beam|buds|flex|\d+tws))|skullcandy (?:dime|indy|sesh|rail|push|mod|smokin|grind)|huawei freeclip/i

export function isWirelessName(name: string): boolean {
  const cleaned = name.replace(EARTIP_TWS, ' ')
  return WIRELESS.test(cleaned)
}

/**
 * Buds that retune themselves to your ear with an inner mic (Apple/Beats Adaptive EQ, Bose CustomTune,
 * Samsung Adaptive EQ). Most can't switch it off, so they partly undo whatever the simulation changes.
 */
const ADAPTIVE_EQ = /\bairpods\b(?! ?(?:2|1|\(?(?:1st|2nd) gen))|beats (?:fit pro|powerbeats pro 2)|powerbeats pro 2|bose (?:quietcomfort|qc) (?:ultra )?earbuds(?: ii)?|galaxy buds ?3 pro/i

export function hasAdaptiveEq(name: string): boolean {
  return ADAPTIVE_EQ.test(name)
}

export const ADAPTIVE_EQ_TIP =
  "These buds retune themselves to your ear (Adaptive EQ / CustomTune), and most can't switch it off. It partly undoes the simulation, so differences come through smaller than they really are."

/** What to tell someone listening on wireless earbuds, shortest first. */
export const WIRELESS_TIPS: string[] = [
  "Turn off the buds' own EQ, sound modes and spatial audio / head tracking in their app — the simulation assumes them flat.",
  'Pick the measured variant that matches how you wear them (e.g. "ANC on" or "ANC off").',
  'Bluetooth codecs (SBC, AAC, LDAC) compress the sound a little. The tuning differences still come through; very fine detail can blur.',
  'Fit and tips change the bass more than anything else. Run the Fit & Seal check in Settings.',
]

/** Windows names a Bluetooth headset's call mode "Headset … Hands-Free": mono, low quality, no good for listening tests. */
export function isHandsFreeLabel(label: string): boolean {
  return /hands-?free|\bheadset\b.*\bAG\b|\bHFP\b/i.test(label)
}

/** An output device whose name says it's Bluetooth (or a known wireless model). */
export function isBluetoothLabel(label: string): boolean {
  return /bluetooth|\bbt\b|hands-?free|stereo\)$/i.test(label) || isWirelessName(label)
}

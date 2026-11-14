// Lyrics stored in a file's tags: plain text, or LRC with [mm:ss.xx] timestamps,
// optionally with a singer (`v1:`) and word timings (`<mm:ss.xx>`).
export interface LyricWord {
  at: number
  end: number | null
  text: string
}

export interface LyricLine {
  at: number | null
  text: string
  /** Singer label such as "v2", without the colon. */
  voice?: string
  words?: LyricWord[]
  /** Background vocals sung with this line, from a following [bg:...] row. */
  background?: string
}

const seconds = (m: string, s: string) => Number(m) * 60 + Number(s)

function parseWords(body: string): LyricWord[] {
  const marks = [...body.matchAll(/<(\d{1,3}):(\d{1,2}(?:\.\d+)?)>([^<]*)/g)]
  const words: LyricWord[] = []
  marks.forEach((m, i) => {
    if (!m[3]) return
    const next = marks[i + 1]
    words.push({ at: seconds(m[1], m[2]), end: next ? seconds(next[1], next[2]) : null, text: m[3] })
  })
  return words
}

export function parseLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const bg = /^\[bg:(.*)\]$/i.exec(row.trim())
    if (bg) {
      const said = bg[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const last = lines[lines.length - 1]
      if (said && last) last.background = last.background ? `${last.background} ${said}` : said
      continue
    }
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    const body = row.replace(/\[[^\]]*\]/g, '').trim()
    const voice = /^(v\d+):\s*/i.exec(body)
    const rest = voice ? body.slice(voice[0].length) : body
    const text = rest.replace(/<[^>]*>/g, '').trim()
    const words = parseWords(rest)
    const extra = { ...(voice ? { voice: voice[1].toLowerCase() } : {}), ...(words.length ? { words } : {}) }
    if (stamps.length) {
      for (const s of stamps) {
        const fraction = s[3] ? Number(`0.${s[3]}`) : 0
        lines.push({ at: Number(s[1]) * 60 + Number(s[2]) + fraction, text, ...extra })
      }
    } else if (text && !/^\[[a-z]+:/i.test(row.trim())) {
      lines.push({ at: null, text, ...extra })
    }
  }
  const timed = lines.filter((l) => l.at !== null)
  return timed.length ? timed.sort((a, b) => a.at! - b.at!) : lines
}

const PROFANITY_PATTERNS = [
  /\b(f+u+c+k+(?:i+n+g?|e+d|e+r+|s+)?)\b/gi,
  /\b(m+o+t+h+e+r+f+u+c+k+(?:e+r+|i+n+g?|s+)?)\b/gi,
  /\b(s+h+i+t+(?:t+y|s+)?)\b/gi,
  /\b(b+u+l+l+s+h+i+t+(?:s+)?)\b/gi,
  /\b(b+i+t+c+h+(?:e+s+|i+n+g?)?)\b/gi,
  /\b(a+s+s+h+o+l+e+(?:s+)?)\b/gi,
  /\b(d+u+m+b+a+s+s+(?:e+s+)?)\b/gi,
  /\b(c+u+n+t+(?:s+)?)\b/gi,
  /\b(d+i+c+k+(?:s+|h+e+a+d+(?:s+)?)?)\b/gi,
  /\b(p+u+s+s+y|(?:p+u+s+s+i+e+s+))\b/gi,
  /\b(b+a+s+t+a+r+d+(?:s+)?)\b/gi,
  /\b(n+i+g+g+(?:e+r+|a+)(?:s+)?)\b/gi,
  /\b(c+o+c+k+(?:s+u+c+k+e+r+|s+)?)\b/gi,
]

export function maskProfanityWord(word: string): string {
  if (word.length <= 1) return '*'
  return word[0] + '*'.repeat(word.length - 1)
}

function matchCase(source: string, target: string): string {
  if (!source || !target) return target
  const letters = source.replace(/[^A-Za-z]/g, '')
  if (letters.length > 1 && letters === letters.toUpperCase()) return target.toUpperCase()
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1).toLowerCase()
  }
  return target.toLowerCase()
}

const MASK_SYMBOLS = /[*#@$_\-]/

const UNCENSOR_PATTERNS: Array<{ regex: RegExp; restore: (m: string) => string }> = [
  // motherfucker / muthafucker / mothafucka / muthaf***a / mothaf***er / motherf***ing / motherf***ed
  {
    regex: /(?<![A-Za-z0-9])m(?:[ou]th[ea]r?|[\*#@$_\-]{3,6})\s*f[a-z*#@$_\-']*(?![A-Za-z0-9])|(?<![A-Za-z0-9])m[\*#@$_\-]{1,2}t+h+e+r+[a-z*#@$_\-']*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      const lower = m.toLowerCase()
      let suffix = 'er'
      if (lower.includes('ing') || lower.endsWith("in'") || lower.endsWith('in')) suffix = lower.endsWith("'") ? "in'" : 'ing'
      else if (lower.endsWith('a') || lower.includes('cka')) suffix = 'a'
      else if (lower.endsWith('s') || lower.endsWith('z')) suffix = 'ers'
      else if (lower.endsWith('ed')) suffix = 'ed'
      const base = lower.startsWith('mutha') ? 'muthafuck' : lower.startsWith('motha') ? 'mothafuck' : 'motherfuck'
      return matchCase(m, base + suffix)
    },
  },
  // bullshit / horseshit / dipshit / bullsh*t / b*llsh*t / bulls***
  {
    regex: /(?<![A-Za-z0-9])(?:bull|horse|dip)s+[a-z*#@$_\-]+(?![A-Za-z0-9])|(?<![A-Za-z0-9])b+[\*#@$_\-]+l+l+s+h+[a-z*#@$_\-]+(?![A-Za-z0-9])|(?<![A-Za-z0-9])(?:bull|horse|dip)[\*#@$_\-]{3,6}([a-z]*)(?![A-Za-z0-9])/gi,
    restore: (m) => {
      const lower = m.toLowerCase()
      const prefix = lower.startsWith('horse') ? 'horse' : lower.startsWith('dip') ? 'dip' : 'bull'
      return matchCase(m, prefix + 'shit' + (lower.endsWith('s') ? 's' : ''))
    },
  },
  // fuck / f*** / f*ck / f**k / f#ck / f!ck / f--- / f___ / f***in' / f***ing / f***ed / f***er / f**kin'
  {
    regex: /(?<![A-Za-z0-9])f(?:[\*#@$_\-!]|u)(?:[\*#@$_\-]|c)(?:[\*#@$_\-]|k)[a-z*#@$_\-']*(?![A-Za-z0-9])|(?<![A-Za-z0-9])f[\*#@$_\-]{2,5}[a-z*#@$_\-']*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      let suffix = ''
      if (lower.endsWith("in'") || lower.endsWith('in’')) suffix = "in'"
      else if (lower.includes('ing') || lower.endsWith('in')) suffix = 'ing'
      else if (lower.includes('er') || lower.endsWith('a')) suffix = lower.endsWith('a') ? 'a' : 'er'
      else if (lower.includes('ed')) suffix = 'ed'
      else if (lower.endsWith('s')) suffix = 's'
      return matchCase(m, 'fuck' + suffix)
    },
  },
  // shit / sh*t / s*** / s**t / sh!t / sh#t / s--- / s___ / sh*tty / sh*tting
  {
    regex: /(?<![A-Za-z0-9])s(?:[\*#@$_\-]|h)(?:[\*#@$_\-!]|i)(?:[\*#@$_\-]|t)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])s[\*#@$_\-]{2,4}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      let suffix = ''
      if (lower.includes('ting') || lower.includes('tin')) suffix = 'ting'
      else if (lower.includes('ty') || lower.includes('ti')) suffix = 'ty'
      else if (lower.endsWith('s')) suffix = 's'
      return matchCase(m, 'shit' + suffix)
    },
  },
  // bitch / b*tch / b!tch / b#tch / b***h / b**** / b*tches / b****es
  {
    regex: /(?<![A-Za-z0-9])b(?:[\*#@$_\-!]|i)(?:[\*#@$_\-]|t)(?:[\*#@$_\-]|c)(?:[\*#@$_\-]|h)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])b[\*#@$_\-]{2,5}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      let suffix = ''
      if (lower.includes('es') || lower.endsWith('s') || lower.endsWith('z')) suffix = 'es'
      else if (lower.endsWith('y')) suffix = 'y'
      else if (lower.includes('in')) suffix = 'ing'
      return matchCase(m, 'bitch' + suffix)
    },
  },
  // cocksucker / c***sucker / c*cksucker
  {
    regex: /(?<![A-Za-z0-9])c[a-z*#@$_\-]*s+u+c+k[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'cocksucker' + (m.toLowerCase().endsWith('s') ? 's' : '')),
  },
  // asshole / a**hole / a$$hole / @$$hole / a****** / a**holes
  {
    regex: /(?<![A-Za-z0-9])a[a-z*#@$_\-]*h+[\*#@$_\-o][\*#@$_\-l][\*#@$_\-e]([a-z*]*)(?![A-Za-z0-9])|(?<![A-Za-z0-9])a[\*#@$_\-]{4,7}([a-z]*)(?![A-Za-z0-9])|(?<![A-Za-z0-9])@[\$*#@_\-]{2}h[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'asshole' + (m.toLowerCase().endsWith('s') ? 's' : '')),
  },
  // dumbass / dumb*** / dumb*ss
  {
    regex: /(?<![A-Za-z0-9])d+u+m+b(?:[\*#@$_\-]{2,4}|a[\*#@$_\-]{2}|a(?:[\*#@$_\-]|s){2})(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'dumbass'),
  },
  // badass / bad*** / bad*ss
  {
    regex: /(?<![A-Za-z0-9])b+a+d(?:[\*#@$_\-]{2,4}|a[\*#@$_\-]{2}|a(?:[\*#@$_\-]|s){2})(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'badass'),
  },
  // jackass / jack*** / jack*ss
  {
    regex: /(?<![A-Za-z0-9])j+a+c+k(?:[\*#@$_\-]{2,4}|a[\*#@$_\-]{2}|a(?:[\*#@$_\-]|s){2})(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'jackass'),
  },
  // ass / a** / a$$ / @ss / @$$ / a**es
  {
    regex: /(?<![A-Za-z0-9])a[\*#@$_\-]{2}(?:es)?(?![A-Za-z0-9])|(?<![A-Za-z0-9])a[\$]{2}(?:es)?(?![A-Za-z0-9])|(?<![A-Za-z0-9])@s{2}(?:es)?(?![A-Za-z0-9])|(?<![A-Za-z0-9])@[\$]{2}(?:es)?(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, m.toLowerCase().includes('es') ? 'asses' : 'ass'),
  },
  // cunt / c**t / c*** / c*nt / c!nt
  {
    regex: /(?<![A-Za-z0-9])c(?:[\*#@$_\-!]|u)(?:[\*#@$_\-]|n)(?:[\*#@$_\-]|t)(?:[s]*)(?![A-Za-z0-9])|(?<![A-Za-z0-9])c[\*#@$_\-]{3,4}([s]*)(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      return matchCase(m, 'cunt' + (m.toLowerCase().endsWith('s') ? 's' : ''))
    },
  },
  // cock / c*ck / c**k / c***
  {
    regex: /(?<![A-Za-z0-9])c(?:[\*#@$_\-]|o)(?:[\*#@$_\-]|c)(?:[\*#@$_\-]|k)(?:[s]*)(?![A-Za-z0-9])|(?<![A-Za-z0-9])c[\*#@$_\-]{3,4}([s]*)(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!MASK_SYMBOLS.test(m)) return m
      return matchCase(m, 'cock' + (m.toLowerCase().endsWith('s') ? 's' : ''))
    },
  },
  // dick / d**k / d*** / d*ck / d!ck / dickhead / d***head
  {
    regex: /(?<![A-Za-z0-9])d(?:[\*#@$_\-!]|i)(?:[\*#@$_\-]|c)(?:[\*#@$_\-]|k)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])d[\*#@$_\-]{2,4}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      let suffix = ''
      if (lower.includes('head')) suffix = 'head'
      else if (lower.endsWith('s')) suffix = 's'
      return matchCase(m, 'dick' + suffix)
    },
  },
  // pussy / p***y / p**** / p*ssy / p!ssy / pussies
  {
    regex: /(?<![A-Za-z0-9])p(?:[\*#@$_\-]|u)(?:[\*#@$_\-]|s){2}(?:[\*#@$_\-]|y)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])p[\*#@$_\-]{3,5}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!MASK_SYMBOLS.test(m)) return m
      const lower = m.toLowerCase()
      if (lower.includes('ies')) return matchCase(m, 'pussies')
      return matchCase(m, 'pussy')
    },
  },
  // nigga / nigger / n**** / n***a / n*gga / n*ggas / n***as / n*gger / n***er / n*ggaz / n****z
  {
    regex: /(?<![A-Za-z0-9])n(?:[\*#@$_\-!]|i)(?:[\*#@$_\-]|g){2}[a-z*#@$_\-]+(?![A-Za-z0-9])|(?<![A-Za-z0-9])n[\*#@$_\-]{2,6}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      const end = lower.includes('er') || lower.endsWith('er') || lower.endsWith('ers') ? 'nigger' : 'nigga'
      const suffix = lower.endsWith('z') ? 'z' : lower.endsWith('s') ? 's' : ''
      return matchCase(m, end + suffix)
    },
  },
  // bastard / b*stard / b*****d / b****** / b*stards
  {
    regex: /(?<![A-Za-z0-9])b(?:[\*#@$_\-]|a)(?:[\*#@$_\-]|s)(?:[\*#@$_\-]|t)(?:[\*#@$_\-]|a)(?:[\*#@$_\-]|r)(?:[\*#@$_\-]|d)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])b[\*#@$_\-]{5,7}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!MASK_SYMBOLS.test(m)) return m
      return matchCase(m, 'bastard' + (m.toLowerCase().endsWith('s') ? 's' : ''))
    },
  },
  // whore / wh*re / w***e / w**** / wh*res
  {
    regex: /(?<![A-Za-z0-9])w(?:[\*#@$_\-]|h)(?:[\*#@$_\-]|o)(?:[\*#@$_\-]|r)(?:[\*#@$_\-]|e)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])w[\*#@$_\-]{3,5}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!MASK_SYMBOLS.test(m)) return m
      return matchCase(m, 'whore' + (m.toLowerCase().endsWith('s') ? 's' : ''))
    },
  },
  // slut / sl*t / sl!t / sl** / sluts
  {
    regex: /(?<![A-Za-z0-9])s+l(?:[\*#@$_\-!]|u)(?:[\*#@$_\-]|t)[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])s+l[\*#@$_\-]{2,3}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      return matchCase(m, 'slut' + (m.toLowerCase().endsWith('s') ? 's' : ''))
    },
  },
  // hoe / h*e / h** / h*es / h**s
  {
    regex: /(?<![A-Za-z0-9])h[\*#@$_\-][e\-_*#@$_\-]([s]*)(?![A-Za-z0-9])|(?<![A-Za-z0-9])h[\*#@$_\-]{2}([s]*)(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'hoe' + (m.toLowerCase().endsWith('s') ? 's' : '')),
  },
  // piss / p*ss / p!ss / p*** / p*ssed / p***ed / p*ssing
  {
    regex: /(?<![A-Za-z0-9])p(?:[\*#@$_\-!]|i)(?:[\*#@$_\-]|s){2}[a-z*#@$_\-]*(?![A-Za-z0-9])|(?<![A-Za-z0-9])p[\*#@$_\-]{2,4}[a-z*#@$_\-]*(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!/[*#@$_\-!]/.test(m)) return m
      const lower = m.toLowerCase()
      let suffix = ''
      if (lower.includes('ing')) suffix = 'ing'
      else if (lower.includes('ed')) suffix = 'ed'
      return matchCase(m, 'piss' + suffix)
    },
  },
  // goddamn / god d*** / g*ddamn / goddam* / g*ddammit
  {
    regex: /(?<![A-Za-z0-9])g+o+d+[\s\-_]*d[a-z*#@$_\-]+(?![A-Za-z0-9])|(?<![A-Za-z0-9])g+[\*#@$_\-]+d+d+a+m+n(?![A-Za-z0-9])|(?<![A-Za-z0-9])g+[\*#@$_\-]+d+d+a+m+m+i+t(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, m.toLowerCase().includes('mit') ? 'goddammit' : 'goddamn'),
  },
  // damn / d**n / d*** / d*mn
  {
    regex: /(?<![A-Za-z0-9])d(?:[\*#@$_\-]|a)(?:[\*#@$_\-]|m)(?:[\*#@$_\-]|n)(?![A-Za-z0-9])|(?<![A-Za-z0-9])d[\*#@$_\-]{2,3}(?![A-Za-z0-9])/gi,
    restore: (m) => {
      if (!MASK_SYMBOLS.test(m)) return m
      return matchCase(m, 'damn')
    },
  },
  // hell / h*ll / h***
  {
    regex: /(?<![A-Za-z0-9])h[\*#@$_\-!]{1,2}l+l(?![A-Za-z0-9])/gi,
    restore: (m) => matchCase(m, 'hell'),
  },
  // tit / tits / t*ts / t!ts / t*** / titties / t*tties
  {
    regex: /(?<![A-Za-z0-9])t(?:[\*#@$_\-!]|i)t+i+e+s(?![A-Za-z0-9])|(?<![A-Za-z0-9])t[\*#@$_\-!]{1,2}t(?:s|ies)(?![A-Za-z0-9])/gi,
    restore: (m) => {
      const lower = m.toLowerCase()
      if (lower.includes('ies')) return matchCase(m, 'titties')
      return matchCase(m, 'tits')
    },
  },
]

/** Reconstructs uncensored words for clean/radio-edited lyrics containing asterisks. */
export function uncensorProfanity(text: string): string {
  if (!text) return text
  let out = text
    .replace(/[\uFF0A\u2217\u2022\u00B7\u25CF]/g, '*')
    .replace(/\b([Ff])x{1,2}k\b/g, '$1uck')
    .replace(/\b([Ff])x{1,2}k(ing?|in'|ed|er|s)?\b/g, '$1uck$2')
    .replace(/\b([Bb])xtch(es|ing?)?\b/g, '$1itch$2')
    .replace(/\b([Ss])hxt(s|ty|ting)?\b/g, '$1hit$2')
    .replace(/\b([Pp])xss(y|ies)\b/g, '$1uss$2')
    .replace(/\b([Cc])xnt(s)?\b/g, '$1unt$2')
    .replace(/\b([Nn])x{1,2}g([ae]r?s?|az)\b/g, '$1igg$2')
  // first the exact fit: the visible letters and the word length pick the word ("d**n" is damn, not dick)
  out = out.replace(MASKED_WORD, (token) => restoreMasked(token) ?? token)
  // then the looser patterns for what's left: masks of another length ("mothaf***er"), "!" for a letter ("sh!t")
  for (const { regex, restore } of UNCENSOR_PATTERNS) {
    out = out.replace(regex, (m) => restore(m))
  }
  return out
}

/**
 * Words lyric sites mask, most common first: when a mask fits more than one ("s***" is shit or slut) the earlier wins.
 * Only used to restore masked words when the filter is off; censoring itself uses PROFANITY_PATTERNS.
 */
const MASKED_DICTIONARY = [
  'fuck', 'fucking', 'fuckin', 'fucked', 'fucker', 'fuckers', 'fucks', 'motherfucker', 'motherfuckers', 'motherfucking',
  'shit', 'shits', 'shitty', 'shittin', 'bullshit', 'nigga', 'niggas', 'niggaz', 'nigger', 'niggers', 'bitch', 'bitches',
  'bitchin', 'ass', 'asses', 'asshole', 'assholes', 'dumbass', 'damn', 'goddamn', 'dick', 'dicks', 'dickhead', 'pussy',
  'pussies', 'hoe', 'hoes', 'whore', 'whores', 'slut', 'sluts', 'cunt', 'cunts', 'cock', 'cocks', 'cocksucker', 'bastard',
  'bastards', 'piss', 'pissed', 'twat', 'wanker', 'hell',
]
/** A word with at least one mask character in it (letters may sit around them). */
const MASKED_WORD = /(?<![A-Za-z0-9])[A-Za-z]*[*#@$_-][A-Za-z*#@$_-]*(?![A-Za-z0-9])/g

function restoreMasked(token: string): string | null {
  if (!/[A-Za-z]/.test(token)) return null // "****" alone: nothing to go on
  const shape = new RegExp(`^${[...token].map((c) => (/[A-Za-z]/.test(c) ? c.toLowerCase() : '[a-z]')).join('')}$`)
  const word = MASKED_DICTIONARY.find((w) => shape.test(w))
  return word ? matchCase(token, word) : null
}

/** Censored version of lyrics line text or word tokens with asterisks. */
export function censorProfanity(text: string): string {
  if (!text) return text
  let out = text
  for (const pat of PROFANITY_PATTERNS) {
    out = out.replace(pat, (m) => maskProfanityWord(m))
  }
  return out
}

/** The line being sung at this position, or -1 before the first one or for unsynced lyrics. */
export function activeLine(lines: LyricLine[], position: number): number {
  let found = -1
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].at
    if (at === null) continue
    if (at > position) break
    found = i
  }
  return found
}

/** A silence worth showing the three dots for: before line `index`. Mornye's minimum gap wasn't traced, so 5 seconds is my choice. */
export function gapBefore(lines: LyricLine[], index: number): { start: number; end: number } | null {
  const line = lines[index]
  if (line?.at == null) return null
  const before = lines[index - 1]
  if (!before) return line.at >= 5 ? { start: 0, end: line.at } : null
  const last = before.words?.[before.words.length - 1]
  if (last?.end == null) return null
  return line.at - last.end >= 5 ? { start: last.end, end: line.at } : null
}

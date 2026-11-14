import { logLine } from './logs'

const KANA = /[぀-ヿ]/
const JAPANESE = /[぀-ヿ一-鿿]/

/** Kana anywhere means Japanese. Kanji alone could just as well be Chinese, which romaji would read wrongly. */
export const isJapaneseSong = (texts: string[]) => texts.some((t) => KANA.test(t))

/** The converter spaces every word, punctuation and all: "kimi ga ? " becomes "kimi ga?". */
export function tidyRomaji(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    // a straight quote opens and closes, so the spaces inside each pair go
    .replace(/"\s*([^"]*?)\s*"/g, '"$1"')
    .replace(/\s+([?!.,)」』])/g, '$1')
    .replace(/([(「『])\s+/g, '$1')
    .trim()
}

interface Converter {
  convert: (text: string, options: Record<string, string>) => Promise<string>
}

let converter: Promise<Converter> | null = null
const cache = new Map<string, string>()

/** Loads the dictionary (about 17 MB) the first time a Japanese song's lyrics open. */
function load(): Promise<Converter> {
  converter ??= (async () => {
    const [kuroshiro, analyzer] = await Promise.all([import('kuroshiro'), import('kuroshiro-analyzer-kuromoji')])
    type Ctor<T> = new (...args: never[]) => T
    const pick = <T>(m: unknown) => ((m as { default?: { default?: T } & T }).default?.default ?? (m as { default?: T }).default ?? m) as T
    const Kuroshiro = pick<Ctor<Converter & { init: (a: unknown) => Promise<void> }>>(kuroshiro)
    const Analyzer = pick<new (o: { dictPath: string }) => unknown>(analyzer)
    const instance = new Kuroshiro()
    await instance.init(new Analyzer({ dictPath: `${import.meta.env.BASE_URL}kuromoji-dict/` }))
    logLine('INFO', 'Lyrics', 'Romaji dictionary loaded')
    return instance
  })()
  converter.catch((e: unknown) => {
    converter = null
    logLine('WARN', 'Lyrics', `Romaji unavailable: ${String(e)}`)
  })
  return converter
}

/** The romaji reading of each line, or an empty string for a line with nothing Japanese in it. */
export async function romajiFor(texts: string[]): Promise<string[]> {
  const kuroshiro = await load()
  return Promise.all(texts.map(async (text) => {
    if (!JAPANESE.test(text)) return ''
    const known = cache.get(text)
    if (known !== undefined) return known
    const reading = tidyRomaji(await kuroshiro.convert(text, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' }))
    cache.set(text, reading)
    return reading
  }))
}

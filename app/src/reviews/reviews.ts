export interface Keyword {
  tag: string
  /** Sentence from the reviewer's notes that produced the tag. */
  evidence: string
}

export interface JayEntry {
  name: string
  rank: string | null
  score: number | null
  tuning: string | null
  tech: string | null
  value: string | null
  valueStars: number
  flags: string[]
  volume: string | null
  tier: string | null
  priceUsd: number | null
  discontinued: boolean
  notes: string
}

export interface Review {
  jay: JayEntry
  /** Highlighted pink on the sheet: "closer to my preference" (Jay's own taste). */
  pink?: boolean
  /** Shop link from the sheet. */
  link?: string | null
  keywords: Record<'signature' | 'strengths' | 'weaknesses' | 'goodFor' | 'notFor', Keyword[]>
}

/** A verdict from one of Jay's speed-run videos (from auto-captions). */
export interface VideoTake {
  kind: 'notOnSheet' | 'conflicts'
  videoTitle: string
  videoUrl: string
  timestamp: string
  tierOrScore: string | null
  /** Short neutral summary of what he says. */
  verdict: string
  quote: string
  /** Quote found word-for-word in the captions. */
  quoteVerified: boolean
}

export interface ReviewData {
  source: string
  /** IEM id -> Jay's entries (some IEMs are ranked more than once, e.g. per volume level). */
  reviews: Record<string, Review[]>
  /** IEM id -> verdicts from his videos. */
  videos?: Record<string, VideoTake[]>
  /** IEM id -> other reviewers' quotes (verified, confidently named). */
  comments?: Record<string, Comment[]>
  /** Short summaries of every review above (review_points.json), attached at load. */
  points?: ReviewPointData
}

/** One review in a few words: what they think, pros, cons (scripts/build_review_points.mjs). */
export type ReviewPoint = [think: string, pros: string[], cons: string[]]

/**
 * review_points.json: summaries by hash, and per IEM id the hash of each review in reviews.json's
 * order (reviews / videos / comments). Keyed like reviews.json so duplicate merges carry them along.
 */
export interface ReviewPointData {
  points: Record<string, ReviewPoint>
  reviews: Record<string, string[]>
  videos: Record<string, string[]>
  comments: Record<string, string[]>
}

export interface Comment {
  reviewer: string
  sourceType: 'ranking-list' | 'youtube' | string | null
  grade: string | null
  verdict: string | null
  quote: string
  /** null: a ranking line with no page of its own (some RequIEM rows) */
  url: string | null
  timestamp: string | null
  /** The review in its own language when `quote` is a translation (Fernanda Gunsan: Indonesian). */
  original?: string
  translated?: boolean
  /** His 1–10 scores (total, bass, loMid, …), as on his sheet. */
  scores?: Record<string, number> | null
  /** Eartips he found suit it, as written on his sheet. */
  tips?: string | null
  /** Jaytiss: signature · drivers (or DSP/TWS, headphone type), from his sheet. */
  facts?: string | null
  /** Jaytiss: his "hot take" column, when he wrote one besides the comment. */
  hotTake?: string | null
}

/** Image URL: user photos are data: URLs, bundled ones are relative paths. */
export const imgUrl = (src: string) => (src.startsWith('data:') ? src : `${import.meta.env.BASE_URL}${src}`)

export interface IemImage {
  src: string
  store: string
  /** Product page the photo comes from. */
  url: string
  title: string
}

/** IEM id -> product photo (only IEMs matched to a retailer product). */
export async function loadImages(url = `${import.meta.env.BASE_URL}data/images.json`): Promise<Record<string, IemImage>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json()
}

export async function loadReviews(url = `${import.meta.env.BASE_URL}data/reviews.json`): Promise<ReviewData> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json()
}

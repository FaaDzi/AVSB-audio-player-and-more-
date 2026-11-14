import { useState } from 'react'
import type { ReviewData, ReviewPoint } from './reviews'

/** Reviewers with a bundled profile picture (public/img/reviewers, their public channel avatars). */
const AVATARS: Record<string, string> = {
  'Jay Audio': 'jay-audio',
  Crinacle: 'crinacle',
  Precogvision: 'precogvision',
  Resolve: 'resolve',
  GoldenSound: 'goldensound',
  'Super* Review': 'super-review',
  Gizaudio: 'gizaudio',
  'Rikudou Goku': 'rikudou-goku',
  Antdroid: 'antdroid',
  'Fernanda Gunsan': 'fernanda-gunsan',
  Jaytiss: 'jaytiss',
  DankPods: 'dankpods',
}
/** Jay's sheet rows have no review page of their own; his channel holds the reviews. */
const JAY_CHANNEL = 'https://www.youtube.com/@jayyaudio'

interface Message {
  who: string
  grade: string | null
  point: ReviewPoint | null
  url: string | null
  linkText: string
  /** A ranking-list line shown as written when it has no summary (Jaytiss's takes are one-liners). */
  quote?: string | null
  /** Why it's a 5-star pick, or another headline. */
  verdict?: string | null
  scores?: Record<string, number> | null
  facts?: string | null
}

/** Jaytiss's four scores, as titled on his sheet. */
const SCORE_LABELS: Record<string, string> = { dynamics: 'Bass', mids: 'Mids', treble: 'Treble', soundstage: 'Stage' }

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

/** A steady colour per reviewer for the initials circle. */
const hue = (name: string) => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)

export function Avatar({ who }: { who: string }) {
  const slug = AVATARS[who]
  return slug ? (
    <img className="rt-avatar" src={`${import.meta.env.BASE_URL}img/reviewers/${slug}.webp`} alt="" width={40} height={40} loading="lazy" />
  ) : (
    <span className="rt-avatar rt-initials" style={{ background: `hsl(${hue(who)} 55% 42%)` }} aria-hidden="true">
      {initials(who)}
    </span>
  )
}

/** Every review of one model, in reviews.json order, each with its short summary. */
export function messagesFor(data: ReviewData | null, id: string): Message[] {
  if (!data) return []
  const p = data.points
  const pointOf = (map: Record<string, string[]> | undefined, i: number) => {
    const h = map?.[id]?.[i]
    return (h && p?.points[h]) || null
  }
  const out: Message[] = []
  ;(data.reviews[id] ?? []).forEach((r, i) => {
    const j = r.jay
    out.push({
      who: 'Jay Audio',
      grade: [j.rank, j.score !== null ? `${j.score}/10` : null].filter(Boolean).join(' · ') || null,
      point: pointOf(p?.reviews, i),
      url: JAY_CHANNEL,
      linkText: 'Jay on YouTube',
    })
  })
  ;(data.videos?.[id] ?? []).forEach((v, i) => {
    out.push({ who: 'Jay Audio', grade: v.tierOrScore, point: pointOf(p?.videos, i), url: v.videoUrl, linkText: `Watch at ${v.timestamp}` })
  })
  ;(data.comments?.[id] ?? []).forEach((c, i) => {
    const url = c.url ?? ''
    const video = /youtu\.?be/.test(url)
    const point = pointOf(p?.comments, i)
    out.push({
      who: c.reviewer,
      grade: c.grade,
      point,
      url: c.url || null,
      linkText:
        c.reviewer === 'Jaytiss'
          ? 'Jaytiss on YouTube'
          : url.includes('instagram.com')
            ? `${c.reviewer} on Instagram`
            : url.includes('reddit.com')
              ? 'Full review on Reddit'
              : video
                ? c.timestamp
                  ? `Watch at ${c.timestamp}`
                  : 'Watch the review'
                : 'Read the review',
      // no summary (short ranking-list lines: Jaytiss, RequIEM, DankPods): shown as written
      ...(point ? {} : { quote: c.quote, verdict: c.verdict, scores: c.scores, facts: c.facts }),
    })
  })
  return out
}

/** One model's reviews as a chat: a bubble per review, the reviewer's picture beside their first. */
export function ReviewThread({ data, id }: { data: ReviewData | null; id: string }) {
  const messages = messagesFor(data, id)
  if (!messages.length) return <p className="rt-empty">No reviews for this one yet.</p>
  return (
    <ol className="rt-thread">
      {messages.map((m, i) => {
        const first = i === 0 || messages[i - 1].who !== m.who
        const [think, pros, cons] = m.point ?? [m.quote ?? '', [], []]
        return (
          <li key={i} className={`rt-msg ${first ? 'first' : ''}`}>
            <div className="rt-side">{first && <Avatar who={m.who} />}</div>
            <div className="rt-bubble">
              {first && (
                <div className="rt-head">
                  <strong>{m.who}</strong>
                  {m.grade && <span className="rt-grade">{m.grade}</span>}
                </div>
              )}
              {!first && m.grade && <span className="rt-grade solo">{m.grade}</span>}
              {m.verdict && <strong className="comment-tagline">{m.verdict}</strong>}
              {think && <p className="rt-think">{think}</p>}
              {m.scores && (
                <ul className="rt-scores" aria-label="Scores out of 10">
                  {Object.entries(m.scores).map(([k, v]) => (
                    <li key={k}>
                      <span>{SCORE_LABELS[k] ?? k}</span> <b>{v}</b>
                    </li>
                  ))}
                </ul>
              )}
              {m.facts && <p className="rt-facts">{m.facts}</p>}
              {(pros.length > 0 || cons.length > 0) && (
                <div className="rt-pc">
                  {pros.length > 0 && (
                    <ul className="rt-pros" aria-label="Pros">
                      {pros.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                  {cons.length > 0 && (
                    <ul className="rt-cons" aria-label="Cons">
                      {cons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {m.url && (
                <a className="rt-link" href={m.url} target="_blank" rel="noreferrer">
                  {m.linkText} ↗
                </a>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Several models' reviews, one at a time, picked with a switch on top. */
export function ReviewSwitch({ data, items }: { data: ReviewData | null; items: { id: string; label: string }[] }) {
  const [on, setOn] = useState(0)
  const cur = items[Math.min(on, items.length - 1)]
  if (!cur) return null
  return (
    <div className="rt-switch-wrap">
      <div className="rt-switch" role="tablist">
        {items.map((it, i) => (
          <button key={it.id} type="button" role="tab" aria-selected={i === on} className={i === on ? 'on' : ''} onClick={() => setOn(i)}>
            {it.label}
          </button>
        ))}
      </div>
      <ReviewThread data={data} id={cur.id} />
    </div>
  )
}

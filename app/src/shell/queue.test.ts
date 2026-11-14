import { describe, expect, it } from 'vitest'
import type { Track } from './library'
import { freshPicks, nextAfterEnd, nextByButton, PlayHistory } from './queue'

const t = (id: string) => ({ id }) as Track
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(t)
const off = { repeat: 'off', shuffle: false, autoplay: false } as const

describe('nextAfterEnd', () => {
  it('goes in order and stops at the end', () => {
    expect(nextAfterEnd([a, b], a, off, [])).toBe(b)
    expect(nextAfterEnd([a, b], b, off, [])).toBeNull()
  })
  it('repeats one or all', () => {
    expect(nextAfterEnd([a, b], a, { ...off, repeat: 'one' }, [])).toBe(a)
    expect(nextAfterEnd([a, b], b, { ...off, repeat: 'all' }, [])).toBe(a)
  })
  it('never shuffles onto the same song', () => {
    expect(nextAfterEnd([a, b, c], a, { ...off, shuffle: true }, [], () => 0)).toBe(b)
    expect(nextAfterEnd([a, b, c], c, { ...off, shuffle: true }, [], () => 0.99)).toBe(b)
  })
  it('autoplay continues from the library when the queue runs out', () => {
    expect(nextAfterEnd([a], a, { ...off, autoplay: true }, [a, d], () => 0)).toBe(d)
    expect(nextAfterEnd([a], a, { ...off, autoplay: true }, [a], () => 0)).toBeNull()
  })
})

describe('nextByButton', () => {
  it('wraps both ways', () => {
    expect(nextByButton([a, b], b, 1, false)).toBe(a)
    expect(nextByButton([a, b], a, -1, false)).toBe(b)
  })
  it('shuffles forward but goes back in order', () => {
    expect(nextByButton([a, b, c], a, 1, true, () => 0.99)).toBe(c)
    expect(nextByButton([a, b, c], b, -1, true, () => 0.99)).toBe(a)
  })
})

describe('PlayHistory', () => {
  it('goes back through what was heard, then forward again', () => {
    const h = new PlayHistory()
    h.visit(a) // a then b
    h.visit(b) // b then c
    expect(h.goBack(c)).toBe(b)
    expect(h.goBack(b)).toBe(a)
    expect(h.goBack(a)).toBeNull()
    expect(h.goForward(a)).toBe(b)
    expect(h.goForward(b)).toBe(c)
    expect(h.goForward(c)).toBeNull()
  })
  it('forgets the way forward once a new song is chosen', () => {
    const h = new PlayHistory()
    h.visit(a)
    h.goBack(b)
    expect(h.peekForward()).toBe(b)
    h.visit(a)
    expect(h.peekForward()).toBeNull()
  })
})

describe('freshPicks', () => {
  it('leaves out what was just heard', () => {
    const h = new PlayHistory()
    h.visit(b)
    expect(freshPicks([a, b, c, d], a, h).map((t) => t.id)).toEqual(['a', 'c', 'd'])
  })
  it('falls back to the whole list when everything was heard', () => {
    const h = new PlayHistory()
    h.visit(b)
    expect(freshPicks([a, b], a, h).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

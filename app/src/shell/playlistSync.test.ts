import { describe, expect, it } from 'vitest'
import { asState, fromWire, merge, missingTrack, resolveMissing, sameState, stamp, toWire } from './playlistSync'
import type { Playlist, Track } from './library'

const song = (id: string, title: string, artist: string, sec: number, pc = false) =>
  ({ id, title, artist, sec, path: pc ? `pc:${id.slice(3)}` : `content://media/x/${id}`, ...(pc ? { source: 'pc' } : {}) }) as Track
const list = (id: string, tracks: string[], updated = 0, extra: Partial<Playlist> = {}): Playlist => ({ id, name: id, tracks, updated, ...extra })

describe('playlists shared between PC and phone (§80 A)', () => {
  it('stamps new and edited playlists, keeps untouched ones, and remembers deletes', () => {
    const prev = [list('a', ['1'], 5), list('b', ['2'], 5), list('c', ['3'], 5)]
    const next = [list('a', ['1'], 5), { ...prev[1], tracks: ['2', '9'] }, list('d', [])]
    const s = stamp(prev, next, {}, 100)
    expect(s.lists.map((p) => p.updated)).toEqual([5, 100, 100])
    expect(s.deleted).toEqual({ c: 100 })
  })

  it('reordering on one side wins over the older copy on the other', () => {
    const pc = { lists: [list('a', ['1', '2', '3'], 10)], deleted: {} }
    const phone = { lists: [list('a', ['3', '1', '2'], 20)], deleted: {} }
    expect(merge(pc, phone).lists[0].tracks).toEqual(['3', '1', '2'])
    expect(merge(phone, pc).lists[0].tracks).toEqual(['3', '1', '2'])
  })

  it('a newer delete removes the playlist on both sides; an edit after it keeps it', () => {
    const pc = { lists: [list('a', ['1'], 10)], deleted: {} }
    expect(merge(pc, { lists: [], deleted: { a: 20 } }).lists).toEqual([])
    expect(merge({ lists: [list('a', ['1'], 30)], deleted: {} }, { lists: [], deleted: { a: 20 } }).lists).toHaveLength(1)
  })

  it('maps ids: PC songs to PC ids, phone-only songs to "phone:" with their name, and back', () => {
    const tracks = [song('pc_X1', 'Alpha', 'Band', 200, true), song('L1', 'Only Here', 'Solo', 180), song('L2', 'Alpha', 'Band', 201)]
    const wire = toWire([list('a', ['pc_X1', 'L1', 'L2'])], tracks)
    // the phone's own copy of a PC song goes as the PC's id; a song only the phone has as "phone:L1"
    expect(wire[0].tracks).toEqual(['X1', 'phone:L1', 'X1'])
    expect(wire[0].missing).toEqual({ 'phone:L1': { title: 'Only Here', artist: 'Solo', sec: 180 } })
    // back on the phone, a PC song it also has plays from the phone
    expect(fromWire(wire, tracks)[0].tracks).toEqual(['L2', 'L1', 'L2'])
  })

  it('on the PC, a missing phone song takes its real id once it arrives, within 2 s of length', () => {
    const lists = [list('a', ['X1', 'phone:L1'], 1, { missing: { 'phone:L1': { title: 'Only Here', artist: 'Solo', sec: 180 } } })]
    expect(resolveMissing(lists, [song('X1', 'Alpha', 'Band', 200)])).toBe(lists)
    const done = resolveMissing(lists, [song('X1', 'Alpha', 'Band', 200), song('N9', 'only here', 'SOLO', 182)])
    expect(done[0].tracks).toEqual(['X1', 'N9'])
    expect(done[0].missing).toEqual({})
  })

  it('shows a missing song greyed out, not playable', () => {
    const t = missingTrack('phone:L1', { title: 'Only Here', artist: 'Solo', sec: 180 })
    expect(t).toMatchObject({ title: 'Only Here (missing song)', playable: false, missing: true })
  })

  it('checks what the other side sends, and compares copies by content', () => {
    expect(asState(null)).toBeNull()
    expect(asState({ lists: 'x', deleted: {} })).toBeNull()
    const s = asState({ lists: [list('a', ['1'], 3), { id: 1 }, { id: 'b', name: 'b', tracks: [2] }], deleted: { a: 1, b: 'x' } })!
    expect(s.lists.map((p) => p.id)).toEqual(['a'])
    expect(s.deleted).toEqual({ a: 1 })
    expect(sameState({ lists: [list('a', ['1'], 3)], deleted: {} }, { lists: [{ ...list('a', ['1'], 3), missing: {} }], deleted: {} })).toBe(true)
  })
})

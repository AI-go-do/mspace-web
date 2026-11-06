import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWatched, toggled } from './watch'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    map: m,
  }
}

describe('빈방 지켜보기 저장', () => {
  const g = globalThis as { localStorage?: unknown }
  let before: unknown
  let fake: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    before = g.localStorage
    fake = fakeStorage()
    g.localStorage = fake
  })
  afterEach(() => { g.localStorage = before })

  it('오늘 목록만 읽고, 날이 바뀌면 비운다', () => {
    fake.map.set('mspace:watch:7', JSON.stringify({ date: '2026-11-06', rooms: [2, 4] }))
    expect(loadWatched(7, new Date('2026-11-06T10:00:00+09:00'))).toEqual([2, 4])
    expect(loadWatched(7, new Date('2026-11-07T00:10:00+09:00'))).toEqual([])
  })

  it('회원마다 따로 두고, 깨진 값은 빈 목록', () => {
    fake.map.set('mspace:watch:7', JSON.stringify({ date: '2026-11-06', rooms: [3] }))
    fake.map.set('mspace:watch:8', '{broken')
    const now = new Date('2026-11-06T10:00:00+09:00')
    expect(loadWatched(7, now)).toEqual([3])
    expect(loadWatched(8, now)).toEqual([])
    expect(loadWatched(null, now)).toEqual([])
  })

  it('저장소를 못 써도 빈 목록으로 조용히 넘어간다', () => {
    g.localStorage = { getItem: () => { throw new Error('denied') } }
    expect(loadWatched(7)).toEqual([])
  })
})

describe('toggled', () => {
  it('없으면 넣고(번호순), 있으면 뺀다', () => {
    expect(toggled([4], 2)).toEqual([2, 4])
    expect(toggled([2, 4], 2)).toEqual([4])
    expect(toggled([], 5)).toEqual([5])
  })
})

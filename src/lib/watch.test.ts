import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWatched, reverted, toggled, withServer } from './watch'

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

describe('core 빈방 알림과 합치기 (core #109)', () => {
  it('core에 켜 둔 방은 더하기만 한다(알려서 core가 뺀 방은 비서 카드를 누를 때까지 남는다)', () => {
    expect(withServer([3], [1, 3])).toEqual([1, 3])
    expect(withServer([2, 4], [])).toEqual([2, 4])
  })
  it('지금 누르는 중인 방과 이상한 번호는 건드리지 않는다', () => {
    expect(withServer([], [2, 5, 0, -1], new Set([5]))).toEqual([2])
  })
  it('core에 못 보내면 그 방만 누르기 전으로 되돌린다', () => {
    expect(reverted([1, 3], 3, true)).toEqual([1])
    expect(reverted([1], 3, false)).toEqual([1, 3])
    // 이미 되돌려진 상태면 그대로
    expect(reverted([1, 3], 3, false)).toEqual([1, 3])
  })
})

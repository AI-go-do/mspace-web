import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changedRooms, inScope, loadWatched, queued, reverted, toggled, withServer } from './watch'

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
  it('core 목록을 받는 사이 누른 방은 요청이 이미 끝났어도 받은 목록으로 덮지 않는다', () => {
    const before = new Map([[2, 1]])
    const after = new Map([[2, 2], [3, 1], [4, 1]])
    expect(changedRooms(before, after)).toEqual([2, 3, 4])
    expect(changedRooms(after, after)).toEqual([])
    // 방금 끈 3번은 옛 core 목록에 남아 있어도 다시 켜지지 않는다
    expect(withServer([], [3, 5], new Set(changedRooms(new Map(), new Map([[3, 1]]))))).toEqual([5])
  })
})

describe('같은 방 요청은 누른 순서대로 (queued)', () => {
  const deferred = () => {
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('켜기가 끝나기 전에 끈 방은 켜기가 끝난 뒤에 끄기를 보낸다', async () => {
    // given: 켜기 요청이 아직 가는 중
    const queue = new Map<number, Promise<unknown>>()
    const order: string[] = []
    const on = deferred()
    const first = queued(queue, 3, () => { order.push('켜기 보냄'); return on.promise.then(() => { order.push('켜기 끝') }) })
    // when: 그 사이 끄기를 누름
    const second = queued(queue, 3, () => { order.push('끄기 보냄'); return Promise.resolve() })
    await Promise.resolve()
    expect(order).toEqual(['켜기 보냄'])
    on.resolve()
    await Promise.all([first, second])
    // then
    expect(order).toEqual(['켜기 보냄', '켜기 끝', '끄기 보냄'])
  })

  it('앞 요청이 실패해도 다음 요청은 보내고, 실패는 그 요청에만 돌아간다', async () => {
    const queue = new Map<number, Promise<unknown>>()
    const on = deferred()
    const first = queued(queue, 3, () => on.promise)
    const second = queued(queue, 3, () => Promise.resolve('끔'))
    on.reject(new Error('네트워크'))
    await expect(first).rejects.toThrow('네트워크')
    await expect(second).resolves.toBe('끔')
  })

  it('다른 방 요청은 기다리지 않고, 다 끝나면 줄을 비운다', async () => {
    const queue = new Map<number, Promise<unknown>>()
    const slow = deferred()
    const a = queued(queue, 1, () => slow.promise)
    let otherRan = false
    await queued(queue, 2, () => { otherRan = true; return Promise.resolve() })
    expect(otherRan).toBe(true)
    slow.resolve()
    await a
    await new Promise((r) => setTimeout(r, 0))
    expect(queue.size).toBe(0)
  })
})

describe('늦게 끝난 요청은 그 회원·그 날 몫만 (inScope)', () => {
  it('같은 몫이면 바꾼 목록을 준다', () => {
    expect(inScope({ scope: '7|2026-11-09', rooms: [1, 3] }, '7|2026-11-09', (r) => reverted(r, 3, true))).toEqual([1])
  })

  it('날짜가 바뀐 뒤 어제 켜기가 실패하면 오늘 목록을 건드리지 않는다', () => {
    // given: 어제(11/9) 켠 3번 방 요청이 오늘(11/10) 실패로 돌아옴
    const today = { scope: '7|2026-11-10', rooms: [2, 3] }
    // when
    const next = inScope(today, '7|2026-11-09', (r) => reverted(r, 3, true))
    // then
    expect(next).toBeNull()
  })
})

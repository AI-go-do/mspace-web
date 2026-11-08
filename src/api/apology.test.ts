import { afterEach, describe, expect, it } from 'vitest'
import { demoApologies, isDemoId, mergeDemo, pickApology, readDemo } from './apology'
import { notificationAction, type AppNotification } from './notifications'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const n = (id: number, kind: string, createdAt: string, read = false): AppNotification =>
  ({ id, reservationId: 7, kind, title: 't', body: 'b', createdAt, read })

describe('방의 사과 카드 (Q-19)', () => {
  afterEach(() => store.clear())

  it('안 읽은 사과 중 가장 최근 것 하나만 홈에 띄운다', () => {
    const list = [
      n(1, 'ROOM_APOLOGY', '2026-11-10T14:16:00+09:00'),
      n(2, 'ROOM_APOLOGY', '2026-11-10T15:00:00+09:00'),
      n(3, 'START_SOON', '2026-11-10T16:00:00+09:00'),
      n(4, 'ROOM_APOLOGY', '2026-11-10T17:00:00+09:00', true),
    ]
    expect(pickApology(list)?.id).toBe(2)
  })
  it('방금 닫은 사과는 서버가 아직 안 읽음이라고 해도 다시 띄우지 않는다', () => {
    const list = [n(1, 'ROOM_APOLOGY', '2026-11-10T14:16:00+09:00'), n(2, 'ROOM_APOLOGY', '2026-11-10T15:00:00+09:00')]
    expect(pickApology(list, new Set([2]))?.id).toBe(1)
    expect(pickApology(list, new Set([1, 2]))).toBeNull()
  })
  it('알림함의 사과는 경고 수를 보러 이용 규칙으로 간다(예약 번호가 없어도)', () => {
    expect(notificationAction({ ...n(1, 'ROOM_APOLOGY', '2026-11-10T14:16:00+09:00'), reservationId: null }))
      .toEqual({ to: '/rules', label: '내 경고 보기' })
  })
})

describe('예시 사과 (?demo=1)', () => {
  afterEach(() => store.clear())

  it('예시는 음수 번호라 서버 번호와 겹치지 않고, 읽으면 이 탭에서 읽음으로 남는다', () => {
    const now = Date.parse('2026-11-10T14:20:00+09:00')
    const [d] = demoApologies(now)
    expect(isDemoId(d.id)).toBe(true)
    expect(d.read).toBe(false)
    expect(Date.parse(d.createdAt)).toBe(now - 4 * 60_000)
    readDemo()
    const [again] = demoApologies(now + 60_000)
    expect(again.read).toBe(true)
    // 처음 켠 시각은 그대로(새로 열 때마다 "방금"으로 바뀌지 않게)
    expect(again.createdAt).toBe(d.createdAt)
  })
  it('서버 목록에 예시를 섞으면 최신 것이 앞에 온다', () => {
    const list = [n(9, 'START_SOON', '2026-11-10T14:30:00+09:00'), n(8, 'END_SOON', '2026-11-10T13:00:00+09:00')]
    const merged = mergeDemo(list, [n(-1, 'ROOM_APOLOGY', '2026-11-10T14:00:00+09:00')])
    expect(merged.map((x) => x.id)).toEqual([9, -1, 8])
    // 같은 번호는 두 번 넣지 않는다
    expect(mergeDemo(merged, [n(-1, 'ROOM_APOLOGY', '2026-11-10T14:00:00+09:00')])).toHaveLength(3)
  })
})

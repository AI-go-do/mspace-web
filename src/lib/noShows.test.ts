import { describe, expect, it } from 'vitest'
import type { MyReservation } from '../api/reservations'
import { myNoShows } from './noShows'

const r = (o: Partial<MyReservation>): MyReservation => ({
  id: 1, room: { id: 1, name: '1번 방' }, startAt: '2026-11-10T10:00:00+09:00', endAt: '2026-11-10T11:00:00+09:00',
  status: 'NO_SHOW', owner: true, accessCode: null, participants: [], ...o,
})

describe('내 노쇼 기록', () => {
  const now = new Date('2026-11-12T13:00:00+09:00')

  it('내가 대표자인 최근 30일 노쇼만, 최근 것부터', () => {
    const list = [
      r({ id: 1 }),
      r({ id: 2, startAt: '2026-11-11T09:00:00+09:00' }),
      r({ id: 3, owner: false }),
      r({ id: 4, status: 'CHECKED_OUT' }),
      r({ id: 5, startAt: '2026-10-01T09:00:00+09:00' }),
    ]
    expect(myNoShows(list, now).map((x) => x.id)).toEqual([2, 1])
  })
})

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

describe('core 노쇼 기록 셈 (core #128)', () => {
  it('counted인 것만 종류별로', async () => {
    const { countedTotals } = await import('./noShows')
    const base = { reservationId: 1, roomId: 1, roomName: '1번 방', startAt: '', endAt: '', happenedAt: '', excusedAt: null }
    expect(countedTotals([
      { ...base, kind: 'NO_SHOW', counted: true },
      { ...base, kind: 'NO_SHOW', counted: false, excusedAt: '2026-11-12T10:00:00+09:00' },
      { ...base, kind: 'AWAY_RELEASED', counted: true },
    ])).toEqual({ noShows: 1, awayReleases: 1 })
  })
})

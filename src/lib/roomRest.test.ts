import { describe, expect, it } from 'vitest'
import type { AdminReport } from '../api/admin'
import { demoBrokenReports, proposeRests, roomCapacity } from './roomRest'
import type { BlockConflict, RoomBlock } from './roomBlocks'

const now = new Date('2026-11-08T14:10:00+09:00')
const kst = (s: string) => new Date(`${s}+09:00`).toISOString()
const rep = (id: number, roomId: number, minAgo: number, over: Partial<AdminReport> = {}): AdminReport => ({
  id, roomId, category: 'BROKEN', content: 'x', verdict: 'OPEN', reporterReservationId: 1,
  createdAt: new Date(now.getTime() - minAgo * 60_000).toISOString(), judgedAt: null, ...over,
})
const res = (reservationId: number, roomId: number, s: string, e: string, people: number): BlockConflict =>
  ({ reservationId, roomId, startAt: kst(s), endAt: kst(e), people })

describe('아픈 방 휴업안', () => {
  it('24시간 안 판정 안 된 비품 고장 신고가 2건이면 다음 30분 칸부터 24시간 쉬게 제안', () => {
    const p = proposeRests([rep(1, 3, 30), rep(2, 3, 300)], [], [], now)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ roomId: 3, startAt: kst('2026-11-08T14:30:00'), endAt: kst('2026-11-09T14:30:00'), key: '3:1,2' })
  })

  it('1건, 오래된 신고, 판정한 신고, 다른 종류는 세지 않는다', () => {
    const list = [rep(1, 2, 30), rep(2, 2, 25 * 60), rep(3, 2, 10, { verdict: 'CONFIRMED' }), rep(4, 2, 10, { category: 'MESSY' })]
    expect(proposeRests(list, [], [], now)).toEqual([])
  })

  it('이미 막혀 있는 방은 묻지 않는다', () => {
    const block: RoomBlock = { id: 1, roomId: 3, startAt: kst('2026-11-08T15:00:00'), endAt: kst('2026-11-08T18:00:00'), reason: 'INSPECTION', memo: null, createdAt: now.toISOString(), releasedAt: null }
    expect(proposeRests([rep(1, 3, 30), rep(2, 3, 60)], [block], [], now)).toEqual([])
    expect(proposeRests([rep(1, 3, 30), rep(2, 3, 60)], [{ ...block, releasedAt: now.toISOString() }], [], now)).toHaveLength(1)
  })

  it('겹친 예약마다 비어 있고 인원이 맞는 옆방을 고른다', () => {
    const reservations = [
      res(10, 3, '2026-11-08T16:00:00', '2026-11-08T18:00:00', 4),
      res(11, 1, '2026-11-08T16:00:00', '2026-11-08T17:00:00', 4),
      res(12, 3, '2026-11-08T20:00:00', '2026-11-08T21:00:00', 6),
    ]
    const p = proposeRests([rep(1, 3, 30), rep(2, 3, 60)], [], reservations, now)[0]
    expect(p.moves.map((m) => m.reservation.reservationId)).toEqual([10, 12])
    // 4명: 1번은 그 시간 예약 있음, 5번은 5명부터 → 2·4번
    expect(p.moves[0].rooms).toEqual([2, 4])
    // 6명: 5번 방만
    expect(p.moves[1].rooms).toEqual([5])
  })

  it('신고가 많은 방부터, 방 인원 규칙', () => {
    const p = proposeRests([rep(1, 2, 5), rep(2, 2, 6), rep(3, 4, 5), rep(4, 4, 6), rep(5, 4, 7)], [], [], now)
    expect(p.map((x) => x.roomId)).toEqual([4, 2])
    expect(roomCapacity(5)).toEqual([5, 8])
    expect(roomCapacity(1)).toEqual([3, 5])
  })

  it('예시 신고는 3번 방 3건으로 휴업안 하나가 된다', () => {
    const p = proposeRests(demoBrokenReports(now), [], [], now)
    expect(p).toHaveLength(1)
    expect(p[0].reports.map((r) => r.id)).toEqual([-33, -32, -31])
  })
})

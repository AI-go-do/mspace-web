import { describe, expect, it } from 'vitest'
import type { MyReservation } from '../api/reservations'
import { friendsLine, reservationsLine, scheduleLine } from './MyPage'

const r = (p: Partial<MyReservation>): MyReservation => ({
  id: 1, room: { id: 3, name: '창작실 3' }, startAt: '2026-11-06T14:00:00+09:00', endAt: '2026-11-06T16:00:00+09:00',
  status: 'BOOKED', owner: true, accessCode: null, participants: [], ...p,
})

describe('마이 탭 줄 메뉴 한 줄 요약', () => {
  it('내 예약: 다가오는(예약됨·사용 중)과 지난 개수', () => {
    expect(reservationsLine(null)).toBe('')
    expect(reservationsLine([r({}), r({ id: 2, status: 'IN_USE' }), r({ id: 3, status: 'CHECKED_OUT' })])).toBe('다가오는 2 · 지난 1')
  })
  it('내 시간표: 오늘(서울 요일) 수업 개수와 마지막 끝 시각', () => {
    const fri = new Date('2026-11-06T09:00:00+09:00')
    const s = { updatedAt: '', classes: [
      { dayOfWeek: 'FRI' as const, startTime: '13:00', endTime: '15:00', name: '자료구조' },
      { dayOfWeek: 'FRI' as const, startTime: '09:00', endTime: '10:30', name: '운영체제' },
      { dayOfWeek: 'MON' as const, startTime: '16:00', endTime: '18:00', name: '월' },
    ] }
    expect(scheduleLine(s, fri)).toBe('오늘 수업 2개 · 15:00 끝')
    expect(scheduleLine(s, new Date('2026-11-07T09:00:00+09:00'))).toBe('오늘 수업 없음')
    expect(scheduleLine(null, fri)).toBe('아직 안 넣었어요')
    expect(scheduleLine(undefined, fri)).toBe('')
  })
  it('친구: 받은 요청이 있을 때만 같이 적는다', () => {
    const f = (n: number, received: number) => ({
      friends: Array.from({ length: n }, (_, i) => ({ studentId: `${i}`, name: '김*수', since: '' })),
      received: Array.from({ length: received }, (_, i) => ({ requestId: i, studentId: `${i}`, name: '박*아', requestedAt: '' })),
      sent: [],
    })
    expect(friendsLine(f(4, 1))).toBe('친구 4 · 받은 요청 1')
    expect(friendsLine(f(0, 0))).toBe('친구 0')
    expect(friendsLine(null)).toBe('')
  })
})

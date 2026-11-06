import { describe, expect, it } from 'vitest'
import type { MyReservation } from '../api/reservations'
import type { RoomSlots } from '../api/rooms'
import type { Schedule } from '../api/schedule'
import { butlerSuggestion, lastClassToday, longestFreeFrom, seoulDay } from './butler'

// 2026-11-06은 금요일
const at = (hhmm: string, date = '2026-11-06') => new Date(`${date}T${hhmm}:00+09:00`)

/** 하루 48칸. taken은 [시작 시, 끝 시](30분은 .5) */
function room(roomId: number, taken: [number, number][] = [], date = '2026-11-06'): RoomSlots {
  const day0 = Date.parse(`${date}T00:00:00+09:00`)
  return {
    roomId, roomName: `창작실 ${roomId}`, minPeople: 3, maxPeople: 5, occupiedNow: false,
    slots: Array.from({ length: 48 }, (_, i) => ({
      startAt: new Date(day0 + i * 1_800_000).toISOString(),
      endAt: new Date(day0 + (i + 1) * 1_800_000).toISOString(),
      available: !taken.some(([a, b]) => i / 2 >= a && i / 2 < b),
    })),
  }
}

const mine = (p: Partial<MyReservation>): MyReservation => ({
  id: 1, room: { id: 3, name: '창작실 3' }, startAt: at('14:00').toISOString(), endAt: at('16:00').toISOString(),
  status: 'BOOKED', owner: true, accessCode: '123456', participants: [], ...p,
})

const schedule: Schedule = {
  updatedAt: '', classes: [
    { dayOfWeek: 'FRI', startTime: '09:00', endTime: '10:30', name: '운영체제' },
    { dayOfWeek: 'FRI', startTime: '13:00', endTime: '15:00', name: '자료구조' },
    { dayOfWeek: 'MON', startTime: '16:00', endTime: '18:00', name: '월요일 수업' },
  ],
}

describe('seoulDay', () => {
  it('서울 기준 요일 (자정 넘어도 서울 날짜로)', () => {
    expect(seoulDay(at('00:30'))).toBe('FRI')
    expect(seoulDay(new Date('2026-11-06T15:30:00Z'))).toBe('SAT') // 서울 11/7 00:30
  })
})

describe('lastClassToday', () => {
  it('오늘 요일 수업 중 가장 늦게 끝나는 것', () => {
    const last = lastClassToday(schedule.classes, at('09:30'))
    expect(last?.c.name).toBe('자료구조')
    expect(last?.endAt.toISOString()).toBe(at('15:00').toISOString())
  })
  it('이미 다 끝났거나 오늘 수업이 없으면 null', () => {
    expect(lastClassToday(schedule.classes, at('15:00'))).toBeNull()
    expect(lastClassToday(schedule.classes, at('10:00', '2026-11-07'))).toBeNull()
  })
})

describe('longestFreeFrom', () => {
  it('그 시각(30분 경계로 올림)부터 가장 오래 비는 방, 최대 2시간, 같으면 작은 번호', () => {
    const rooms = [room(3, [[16, 17]]), room(2, [[15.5, 16]]), room(1, [[18, 19]]), room(5, [[14, 16]])]
    const best = longestFreeFrom(rooms, at('14:50'))
    expect(best).toMatchObject({ roomId: 1, start: 30, len: 4 })
    expect(best?.startAt).toBe(at('15:00').toISOString())
    expect(best?.endAt).toBe(at('17:00').toISOString())
    expect(longestFreeFrom([room(3, [[16, 17]]), room(2, [[15.5, 16]])], at('15:00'))).toMatchObject({ roomId: 3, len: 2 })
  })
  it('그 시각에 빈 방이 없거나 오늘을 넘기면 null', () => {
    expect(longestFreeFrom([room(1, [[15, 24]])], at('15:00'))).toBeNull()
    expect(longestFreeFrom([room(1)], at('00:00', '2026-11-07'))).toBeNull()
  })
})

describe('butlerSuggestion 우선순위', () => {
  const rooms = [room(1), room(2)]
  it('사용 중인 내 예약이 10분 안에 끝나면 연장이 먼저', () => {
    const r = mine({ status: 'IN_USE' })
    expect(butlerSuggestion({ mine: [r], rooms, schedule }, at('15:52'))).toMatchObject({ kind: 'extend', r })
    // 참여자는 연장할 수 없다
    expect(butlerSuggestion({ mine: [mine({ status: 'IN_USE', owner: false })], rooms, schedule: undefined }, at('15:52'))).toBeNull()
  })
  it('입실 시간(시작 10분 전 ~ 마감)이면 QR 꺼내기', () => {
    const r = mine({})
    const s = butlerSuggestion({ mine: [r], rooms, schedule }, at('13:50'))
    expect(s).toMatchObject({ kind: 'checkin', r })
    expect(s?.kind === 'checkin' && s.deadline.toISOString()).toBe(at('14:15').toISOString())
    expect(butlerSuggestion({ mine: [r], rooms, schedule: undefined }, at('13:49'))).toBeNull()
    expect(butlerSuggestion({ mine: [r], rooms, schedule: undefined }, at('14:16'))).toBeNull()
  })
  it('마지막 수업이 끝나는 시각부터 가장 오래 비는 방을 제안한다', () => {
    const s = butlerSuggestion({ mine: [], rooms: [room(1, [[15, 16]]), room(2)], schedule }, at('12:00'))
    expect(s).toMatchObject({ kind: 'afterClass', className: '자료구조', endTime: '15:00', roomId: 2, start: 30, len: 4, date: '2026-11-06' })
  })
  it('시간표가 없으면 넣으라고 권하고, 아직 못 받았으면 아무 말도 안 한다', () => {
    expect(butlerSuggestion({ mine: [], rooms, schedule: null }, at('12:00'))).toEqual({ kind: 'noSchedule' })
    expect(butlerSuggestion({ mine: [], rooms, schedule: undefined }, at('12:00'))).toBeNull()
  })
  it('수업이 다 끝났거나 빈 방이 없으면 카드를 숨긴다', () => {
    expect(butlerSuggestion({ mine: [], rooms, schedule }, at('15:30'))).toBeNull()
    expect(butlerSuggestion({ mine: [], rooms: [room(1, [[15, 24]])], schedule }, at('12:00'))).toBeNull()
  })
})

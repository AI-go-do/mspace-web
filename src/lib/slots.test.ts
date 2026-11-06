import { describe, expect, it } from 'vitest'
import { addDays, dayLabel, freeNextDaySlots, instantEnds, lengthLabel, nextDayReach, nextTakenAt, roomLink, slotClockAcross, tapSlot, weekChips } from './slots'

const allFree = Array(48).fill(true)

describe('tapSlot 30분 칸 고르기', () => {
  it('처음 누르면 1칸', () => {
    expect(tapSlot(null, 38, allFree)).toEqual({ start: 38, len: 1 })
  })
  it('뒤 칸을 누르면 그 칸까지 늘어난다(최대 4칸)', () => {
    expect(tapSlot({ start: 38, len: 1 }, 41, allFree)).toEqual({ start: 38, len: 4 })
    expect(tapSlot({ start: 38, len: 1 }, 42, allFree)).toEqual({ start: 42, len: 1 })
  })
  it('고른 안쪽 칸을 누르면 줄어든다', () => {
    expect(tapSlot({ start: 38, len: 4 }, 39, allFree)).toEqual({ start: 38, len: 2 })
  })
  it('사이에 예약된 칸이 있으면 늘리지 않고 새로 시작한다', () => {
    const free = [...allFree]
    free[40] = false
    expect(tapSlot({ start: 38, len: 1 }, 41, free)).toEqual({ start: 41, len: 1 })
  })
  it('고를 수 없는 칸은 무시한다', () => {
    const free = [...allFree]
    free[10] = false
    expect(tapSlot({ start: 8, len: 1 }, 10, free)).toEqual({ start: 8, len: 1 })
  })
  it('1칸 고른 칸을 다시 누르면 지운다', () => {
    expect(tapSlot({ start: 8, len: 1 }, 8, allFree)).toBeNull()
    expect(tapSlot({ start: 8, len: 3 }, 8, allFree)).toEqual({ start: 8, len: 1 })
  })
})

describe('날짜', () => {
  it('달이 넘어가도 7일 칩', () => {
    const chips = weekChips('2026-11-28')
    expect(chips.map((c) => c.date)).toEqual([
      '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04',
    ])
    expect(chips[0].weekday).toBe('오늘')
    expect(chips[1].weekday).toBe('일')
  })
  it('글자', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayLabel('2026-11-05')).toBe('11월 5일 (목)')
    expect(lengthLabel(3)).toBe('1시간 30분')
    expect(lengthLabel(4)).toBe('2시간')
    expect(lengthLabel(1)).toBe('30분')
  })
})

describe('instantEnds 지금 바로 쓰기 끝 시각', () => {
  const day = (taken: number[] = []) =>
    Array.from({ length: 48 }, (_, i) => {
      const s = new Date(Date.UTC(2026, 10, 2, 15, 0) + i * 30 * 60_000) // 서울 11/3 00:00부터
      return { startAt: s.toISOString(), endAt: new Date(s.getTime() + 30 * 60_000).toISOString(), available: !taken.includes(i) }
    })
  const seoul = (h: number, m: number) => new Date(Date.UTC(2026, 10, 2, 15 + h, m))

  it('15:32면 16:00부터 18:00(15:32+2h를 30분으로 올림)까지 5개', () => {
    const ends = instantEnds(day(), seoul(15, 32)).map((e) => new Date(e.endAt).toISOString().slice(11, 16))
    expect(ends).toEqual(['07:00', '07:30', '08:00', '08:30', '09:00']) // UTC = 서울 16:00…18:00
  })
  it('다음 예약 칸부터는 고를 수 없다', () => {
    // 17:00 칸(34) 예약됨
    const ends = instantEnds(day([34]), seoul(15, 32))
    expect(ends.map((e) => e.ok)).toEqual([true, true, true, false, false])
  })
  it('비어 있는 끝은 2시간 제한과 따로, 다음 예약 시작이다', () => {
    // 21:00 칸(42) 예약됨: 2시간 제한(18:00)보다 늦어도 그대로 21:00
    expect(new Date(nextTakenAt(day([42]), seoul(15, 32))!).toISOString().slice(11, 16)).toBe('12:00')
    // 지난 칸(15:00, 30)은 세지 않는다
    expect(nextTakenAt(day([30]), seoul(15, 32))).toBeNull()
  })
})

describe('자정 넘김', () => {
  const withNext = Array(51).fill(true)
  it('23:00·23:30 시작이면 다음 날 칸까지 끝으로 늘릴 수 있다(최대 2시간)', () => {
    expect(tapSlot({ start: 46, len: 1 }, 49, withNext, 48)).toEqual({ start: 46, len: 4 })
    expect(tapSlot({ start: 47, len: 1 }, 50, withNext, 48)).toEqual({ start: 47, len: 4 })
  })
  it('다음 날 칸은 시작으로 못 고른다', () => {
    expect(tapSlot(null, 48, withNext, 48)).toBeNull()
    expect(tapSlot({ start: 44, len: 1 }, 49, withNext, 48)).toEqual({ start: 44, len: 1 })
  })
  it('시작에서 2시간 안에 자정이 있을 때만 다음 날 칸을 이어 붙인다', () => {
    expect(nextDayReach(null)).toBe(0)
    expect(nextDayReach(44)).toBe(0)
    expect(nextDayReach(46)).toBe(2)
    expect(nextDayReach(47)).toBe(3)
  })
  it('다음 날 칸 시각과 표시', () => {
    expect(freeNextDaySlots('2026-11-11')[2]).toEqual({ startAt: '2026-11-11T01:00:00+09:00', endAt: '2026-11-11T01:30:00+09:00', available: true })
    expect(slotClockAcross(48)).toBe('24:00')
    expect(slotClockAcross(50)).toBe('다음 날 01:00')
  })
})

describe('roomLink 방을 눌렀을 때', () => {
  const day = (taken: number[] = []) =>
    Array.from({ length: 48 }, (_, i) => {
      const s = new Date(Date.UTC(2026, 10, 2, 15, 0) + i * 30 * 60_000) // 서울 11/3 00:00부터
      return { startAt: s.toISOString(), endAt: new Date(s.getTime() + 30 * 60_000).toISOString(), available: !taken.includes(i) }
    })
  const seoul = (h: number, m: number) => new Date(Date.UTC(2026, 10, 2, 15 + h, m))

  it('지금 비어 있으면 그 방을 고른 지금 바로 쓰기로 간다', () => {
    expect(roomLink({ roomId: 3, occupiedNow: false, slots: day() }, seoul(15, 32))).toBe('/now?room=3')
  })
  it('사용 중이면 그 방 시간 고르기로 간다', () => {
    expect(roomLink({ roomId: 3, occupiedNow: true, slots: day() }, seoul(15, 32))).toBe('/rooms/3')
  })
  it('비어 있어도 바로 다음 칸이 예약돼 고를 끝이 없으면 시간 고르기로 간다', () => {
    // 정각 15:00에 막 비었는데 15:00 칸(30)이 이미 다음 사람 예약
    expect(roomLink({ roomId: 2, occupiedNow: false, slots: day([30]) }, seoul(15, 0))).toBe('/rooms/2')
  })
  it('지금 사용 여부를 모르면 시간 고르기로 간다', () => {
    expect(roomLink({ roomId: 1, slots: day() }, seoul(15, 32))).toBe('/rooms/1')
  })
})

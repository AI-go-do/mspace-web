import { describe, expect, it } from 'vitest'
import { addDays, dayLabel, lengthLabel, tapSlot, weekChips } from './slots'

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

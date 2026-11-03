import { describe, expect, it } from 'vitest'
import { mockAvailability } from '../api/mock'
import { isFreeNow, nowPercent, takenSegments } from './time'

const date = '2026-11-03'
const at = (hm: string) => new Date(`${date}T${hm}:00+09:00`)

describe('takenSegments', () => {
  it('이어진 예약 칸을 한 막대로 합친다', () => {
    const now = at('00:00')
    const room3 = mockAvailability(date, now).rooms[2]
    expect(takenSegments(room3.slots, now)).toEqual([
      { from: 14, to: 16 },
      { from: 18, to: 20.5 },
    ])
  })

  it('지난 칸은 예약으로 그리지 않는다', () => {
    const now = at('15:40') // 14–16 예약 중 15:30 칸까지는 지남
    const room3 = mockAvailability(date, now).rooms[2]
    expect(takenSegments(room3.slots, now)).toEqual([{ from: 18, to: 20.5 }])
  })
})

describe('isFreeNow', () => {
  it('지금 다음 칸으로 비었는지 본다', () => {
    const now = at('15:20')
    const rooms = mockAvailability(date, now).rooms
    expect(isFreeNow(rooms[0].slots, now)).toBe(true) // 1번: 13–15 끝남
    expect(isFreeNow(rooms[4].slots, now)).toBe(false) // 5번: 15–17 사용 중
  })
})

describe('nowPercent', () => {
  it('정오는 50%', () => {
    const now = at('12:00')
    expect(nowPercent(mockAvailability(date, now).rooms[0].slots, now)).toBe(50)
  })
})

import { describe, expect, it } from 'vitest'
import { mockAvailability } from '../api/mock'
import { isFreeNow, nowPercent, takenSegments, nowState } from './time'

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
  it('서버가 occupiedNow를 주면 그 값을 따른다', () => {
    const now = at('15:20')
    const rooms = mockAvailability(date, now).rooms
    expect(isFreeNow(rooms[0].slots, now, true)).toBe(false)
    expect(isFreeNow(rooms[4].slots, now, false)).toBe(true)
  })
})

describe('nowPercent', () => {
  it('정오는 50%', () => {
    const now = at('12:00')
    expect(nowPercent(mockAvailability(date, now).rooms[0].slots, now)).toBe(50)
  })
})

describe('nowState 배치도 한 줄', () => {
  const mk = (avail: boolean[]) =>
    avail.map((a, i) => {
      const s = new Date(Date.UTC(2026, 10, 3, 10, 0) + i * 30 * 60_000) // 서울 19:00부터
      return { startAt: s.toISOString(), endAt: new Date(s.getTime() + 30 * 60_000).toISOString(), available: a }
    })
  const at = new Date(Date.UTC(2026, 10, 3, 9, 50)) // 서울 18:50
  it('비어 있다가 예약이 나오면 그때까지', () => {
    expect(nowState(mk([true, true, false]), at)).toEqual({ free: true, text: '20:00까지 빔' })
  })
  it('사용 중이면 언제 비는지', () => {
    expect(nowState(mk([false, false, true]), at)).toEqual({ free: false, text: '사용 중 · 20:00까지' })
  })
  it('서버가 사용 중이라 하면 다음 빈 칸까지 사용 중', () => {
    expect(nowState(mk([true, true, false]), at, true)).toEqual({ free: false, text: '사용 중 · 19:00까지' })
  })
  it('끝까지 비어 있음', () => {
    expect(nowState(mk([true, true]), at).text).toBe('오늘 계속 빔')
  })
})

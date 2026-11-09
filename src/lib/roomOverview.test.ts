import { describe, expect, it } from 'vitest'
import type { RoomEnvironment } from '../api/environment'
import { mockEnvironment } from '../api/environmentMock'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView } from './roomHealth'
import { levelOf, overview } from './roomOverview'

const now = new Date('2026-11-08T14:41:00+09:00')
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()

function room(roomId: number, ppm: (i: number) => number | null, extra: Partial<RoomEnvironment> = {}, n = 45): RoomEnvironment {
  const series = Array.from({ length: n }, (_, i) => ({ at: iso(n - 1 - i), ppm: ppm(i), temperatureC: 24, humidityPct: 45 }))
  const last = series[n - 1].ppm
  return {
    roomId, roomName: `방 ${roomId}`, presence: 'OCCUPIED', lastSignalAt: iso(0), offline: false,
    co2: last === null ? null : { ppm: last, at: iso(0) }, temperatureC: 24, humidityPct: 45, series,
    current: null, next: null, ...extra,
  }
}
const view = (env: RoomEnvironment) => toRoomView(env, ADMIN_ROOMS.find((c) => c.roomId === env.roomId), now)

describe('levelOf', () => {
  it('기준 1000을 넘으면 4, 800부터 3, 값이 없으면 null', () => {
    expect(levelOf(1000)).toBe(4)
    expect(levelOf(999)).toBe(3)
    expect(levelOf(800)).toBe(3)
    expect(levelOf(650)).toBe(2)
    expect(levelOf(560)).toBe(1)
    expect(levelOf(420)).toBe(0)
    expect(levelOf(null)).toBeNull()
  })
})

describe('overview', () => {
  it('값이 있는 방만으로 평균과 가장 높은 방을 고른다', () => {
    const o = overview([
      view(room(1, (i) => 600 + (i % 2))),
      view(room(2, (i) => 800 + (i % 2))),
      view(room(3, () => null)),
    ])
    expect(o.measured).toBe(2)
    expect(o.avg).toBe(700)
    expect(o.top).toEqual({ roomId: 2, co2: 800 })
  })

  it('환기 순서는 이미 넘은 방이 먼저, 그다음 넘을 때가 가까운 방', () => {
    const o = overview([
      view(room(1, (i) => 460 + 10 * i)), // 900, 10분 뒤 넘음
      view(room(2, (i) => 1100 + (i % 2))), // 이미 넘음
      view(room(3, (i) => 680 + 8 * i)), // 지금 1032 → 이미 넘음
      view(room(4, (i) => 600 + (i % 2))), // 괜찮음
    ])
    expect(o.order.map((x) => x.roomId)).toEqual([2, 3, 1])
    expect(o.order[0].why).toBe('지금 1100 · 기준 넘음')
    expect(o.order[2].why).toBe(`10분 뒤 ${ENV_RULES.co2LimitPpm} 넘음`)
    expect(o.soon).toBe(3)
  })

  it('지난 시간 동안 기준을 넘은 분을 센다', () => {
    const o = overview([view(room(1, (i) => (i >= 40 ? 1050 : 700)))])
    expect(o.rows[0].overMinutes).toBe(5)
    expect(o.rows[0].past.slice(-5)).toEqual([4, 4, 4, 4, 4])
  })

  it('센서가 멈추거나 끊긴 방은 값을 믿지 않아 평균·열지도에서 뺀다', () => {
    const o = overview([
      view(room(1, () => 452)), // 45분째 같은 값 → 센서 멈춤
      view(room(2, (i) => 700 + (i % 2), { offline: true })),
      view(room(3, (i) => 640 + (i % 2))),
    ])
    expect(o.measured).toBe(1)
    expect(o.avg).toBe(640)
    expect(o.rows[0].past.every((x) => x === null)).toBe(true)
    expect(o.rows[1].co2).toBeNull()
  })

  it('가짜 값 다섯 방으로도 행이 다섯 개 나온다', () => {
    const env = mockEnvironment(now, ENV_RULES.historyMinutes)
    const o = overview(env.rooms.map(view))
    expect(o.rows.map((r) => r.roomId)).toEqual([1, 2, 3, 4, 5])
    expect(o.rows.every((r) => r.past.length === ENV_RULES.historyMinutes)).toBe(true)
  })
})

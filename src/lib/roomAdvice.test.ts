import { describe, expect, it } from 'vitest'
import type { RoomEnvironment } from '../api/environment'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { roomAdvice } from './roomAdvice'
import { toRoomView } from './roomHealth'

const now = new Date('2026-11-09T10:00:00+09:00')
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()

function room(ppm: (i: number) => number | null, extra: Partial<RoomEnvironment> = {}, n = 45): RoomEnvironment {
  const series = Array.from({ length: n }, (_, i) => ({ at: iso(n - 1 - i), ppm: ppm(i), temperatureC: 24, humidityPct: 45 }))
  const last = series[n - 1].ppm
  return {
    roomId: 1, roomName: '창작실 1', presence: 'OCCUPIED', lastSignalAt: iso(0), offline: false,
    co2: last === null ? null : { ppm: last, at: iso(0) }, temperatureC: 24, humidityPct: 45, series,
    current: null, next: null, ...extra,
  }
}
const view = (env: RoomEnvironment) => toRoomView(env, ADMIN_ROOMS[0], now)

describe('roomAdvice', () => {
  it('이상이 없으면 할 일이 없다', () => {
    expect(roomAdvice(view(room((i) => 600 + (i % 2))), now)).toEqual([])
  })

  it('곧 기준을 넘으면 몇 분 뒤인지와 미리 환기를 알려 준다', () => {
    // 예약 중인 방(예약 없이 오르면 "무단 사용 의심"이 따로 붙는다)
    const busy = { current: { reservationId: 9, startAt: iso(30), endAt: iso(-60), people: 4 } }
    const a = roomAdvice(view(room((i) => 460 + 10 * i, busy)), now)
    expect(a).toHaveLength(1)
    expect(a[0].title).toBe('약 10분 뒤 CO2가 1000ppm을 넘을 것 같아요')
    expect(a[0].action).toBeUndefined()
  })

  it('예약이 끝났는데 남아 있으면 예약 번호와 강제 퇴실 버튼을 권한다', () => {
    const env = room(() => 700, { current: { reservationId: 1042, startAt: iso(100), endAt: iso(10), people: 3 } })
    const a = roomAdvice(view(env), now)
    expect(a.map((x) => x.action)).toContain('checkout')
    expect(a.find((x) => x.action === 'checkout')?.title).toContain('#1042')
  })

  it('신호가 끊기면 남색(확인 필요)으로 마지막 신호 시각과 점검 막기를 권한다', () => {
    const env = room(() => 600, { offline: true, lastSignalAt: iso(30) })
    const a = roomAdvice(view(env), now)
    expect(a[0]).toMatchObject({ tone: 'off', action: 'block' })
    expect(a[0].title).toContain('마지막 신호 09:30')
  })

  it('빈 방이 더우면 다음 예약 전에 켜 두라고 한다', () => {
    const env = room((i) => 500 + (i % 2), { presence: 'EMPTY', temperatureC: 28.4, next: { startAt: iso(-30), people: 4 } })
    const a = roomAdvice(view(env), now)
    expect(a).toHaveLength(1)
    expect(a[0].todo).toContain('다음 예약(10:30) 전에')
  })
})

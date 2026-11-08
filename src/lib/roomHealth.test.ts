import { describe, expect, it } from 'vitest'
import { isRoomsEnvironment, type RoomEnvironment } from '../api/environment'
import { mockEnvironment } from '../api/environmentMock'
import { ADMIN_ROOMS, ENV_RULES, type AdminRoomConfig } from '../config/adminRooms'
import { toRoomView, trendSlope } from './roomHealth'

const now = new Date('2026-11-08T14:41:00+09:00')
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()

/** 지난 n분 CO2 값으로 방 하나 만들기 */
function room(ppm: (i: number) => number | null, extra: Partial<RoomEnvironment> = {}, n = 45): RoomEnvironment {
  const series = Array.from({ length: n }, (_, i) => ({ at: iso(n - 1 - i), ppm: ppm(i), temperatureC: 24, humidityPct: 45 }))
  const last = series[n - 1].ppm
  return {
    roomId: 1, roomName: '서버 이름', presence: 'OCCUPIED', lastSignalAt: iso(0), offline: false,
    co2: last === null ? null : { ppm: last, at: iso(0) }, temperatureC: 24, humidityPct: 45, series,
    current: null, next: null, ...extra,
  }
}
const cfg = ADMIN_ROOMS[0]

describe('toRoomView', () => {
  it('CO2가 1분에 10ppm씩 오르면 기준까지 남은 분을 예측해 노랑으로 표시한다', () => {
    // 지금 900 → 10분 뒤 1000
    const v = toRoomView(room((i) => 460 + 10 * i), cfg, now)
    expect(v.co2).toBe(900)
    expect(v.forecastFrom).toBe('trend')
    expect(v.forecast).toHaveLength(ENV_RULES.forecastMinutes)
    expect(v.etaMinutes).toBe(10)
    expect(v.flags.co2Soon).toBe(true)
    expect(v.tone).toBe('warn')
    expect(v.co2Note).toBe('예측: 10분 뒤 1000 넘음')
  })

  it('천천히 오르면 주의가 아니고 15분 뒤 값만 보여 준다', () => {
    const v = toRoomView(room((i) => 600 + i), cfg, now)
    expect(v.flags.co2Soon).toBe(false)
    expect(v.tone).toBe('ok')
    expect(v.co2Note).toBe('15분 뒤 약 659')
  })

  it('젯슨 예측이 오면 추세 대신 그 값을 쓴다', () => {
    const forecast = Array.from({ length: 15 }, (_, i) => ({ at: iso(-(i + 1)), ppm: 700 + 30 * i }))
    const v = toRoomView(room((i) => 700 + (i % 3), { forecast }), cfg, now)
    expect(v.forecastFrom).toBe('model')
    expect(v.etaMinutes).toBe(11) // 700 + 30*10 = 1000 → 11분째
  })

  it('CO2가 20분 넘게 같은 값이면 센서 확인(빨강)으로 보고 예측을 그리지 않는다', () => {
    const v = toRoomView(room(() => 452, { presence: 'EMPTY' }), cfg, now)
    expect(v.flags.stuck).toBe(true)
    expect(v.tone).toBe('off')
    expect(v.status.text).toBe('센서 확인')
    expect(v.forecast).toEqual([])
    expect(v.co2Note).toBe('44분째 값이 그대로')
  })

  it('같은 값이 기준보다 짧으면 고장으로 보지 않는다', () => {
    const v = toRoomView(room((i) => (i < 30 ? 450 + i : 480)), cfg, now)
    expect(v.sameForMinutes).toBe(14)
    expect(v.flags.stuck).toBe(false)
  })

  it('신호가 끊기면 빨강', () => {
    const v = toRoomView(room(() => 600, { offline: true, presence: 'UNKNOWN' }), cfg, now)
    expect(v.tone).toBe('off')
    expect(v.status.text).toBe('신호 끊김')
  })

  it('예약이 끝나고 5분 넘게 사람이 있으면 시간 넘김', () => {
    const current = { reservationId: 1042, startAt: iso(98), endAt: iso(8), people: 3 }
    const v = toRoomView(room((i) => 700 + (i % 3), { current }), cfg, now)
    expect(v.overtimeMinutes).toBe(8)
    expect(v.flags.overtime).toBe(true)
    expect(v.status.text).toBe('시간 넘김')
    expect(v.slot).toContain('#1042')
  })

  it('끝나고 바로(5분 안)는 시간 넘김으로 보지 않는다', () => {
    const current = { reservationId: 1, startAt: iso(62), endAt: iso(2), people: 3 }
    expect(toRoomView(room((i) => 700 + (i % 3), { current }), cfg, now).flags.overtime).toBe(false)
  })

  it('빈 방이 27.5°C 넘고 다음 예약이 있으면 "다음 예약 전 더움"', () => {
    const v = toRoomView(room((i) => 480 + (i % 2), { presence: 'EMPTY', temperatureC: 27.8, next: { startAt: iso(-79), people: 4 } }), cfg, now)
    expect(v.flags.hot).toBe(true)
    expect(v.tempNote).toBe('다음 예약 전 더움')
    expect(v.slot).toBe('다음 16:00 (예약 4명)')
    expect(v.tone).toBe('warn')
  })

  it('설정에 없는 센서는 값을 버리고 "센서 없음"으로 보여 준다', () => {
    const noCo2: AdminRoomConfig = { roomId: 1, name: 'M-space 창작실 1', sensors: ['temperature', 'presence'] }
    const v = toRoomView(room((i) => 460 + 10 * i), noCo2, now)
    expect(v.name).toBe('M-space 창작실 1')
    expect(v.co2).toBeNull()
    expect(v.co2Note).toBe('센서 없음')
    expect(v.humidityPct).toBeNull()
    expect(v.humNote).toBe('센서 없음')
    expect(v.tone).toBe('ok')
  })

  it('예약이 없는데 CO2가 계속 오르면 무단 사용 의심(노랑)', () => {
    const v = toRoomView(room((i) => 480 + 5 * i, { presence: 'OCCUPIED', current: null }), cfg, now, { ...ENV_RULES, co2LimitPpm: 5000 })
    expect(v.flags.unbooked).toBe(true)
    expect(v.status.text).toBe('예약 없이 사용?')
    expect(v.tone).toBe('warn')
  })

  it('예약 중이거나 CO2가 그대로면 무단 사용으로 보지 않는다', () => {
    const current = { reservationId: 1, startAt: iso(30), endAt: iso(-90), people: 4 }
    expect(toRoomView(room((i) => 480 + 5 * i, { current }), cfg, now, { ...ENV_RULES, co2LimitPpm: 5000 }).flags.unbooked).toBe(false)
    expect(toRoomView(room((i) => 480 + (i % 2), { current: null }), cfg, now).flags.unbooked).toBe(false)
  })

  it('설정에 없는 방은 서버가 준 이름을 쓴다', () => {
    expect(toRoomView(room(() => 600), undefined, now).name).toBe('서버 이름')
  })

  it('API가 예약 칸을 안 주면 "예약 정보 없음"', () => {
    const r = room(() => 600)
    delete r.current
    delete r.next
    expect(toRoomView(r, cfg, now).slot).toBe('예약 정보 없음')
  })
})

describe('trendSlope', () => {
  it('빈 값(null)을 건너뛰고 최근 10분 기울기를 구한다', () => {
    expect(trendSlope([100, 110, null, 130, 140])).toBe(10)
    expect(trendSlope([null, null])).toBeNull()
  })
})

describe('mockEnvironment (가짜 값)', () => {
  it('같은 시각이면 같은 값이라 10초마다 불러도 지난 그래프가 튀지 않는다', () => {
    const a = mockEnvironment(now, 45)
    const b = mockEnvironment(new Date(now.getTime() + 10_000), 45)
    expect(a).toEqual(mockEnvironment(now, 45))
    // 마지막(지금) 값만 다시 재고, 그 앞 1분 칸은 그대로
    expect(b.rooms[0].series.slice(0, -1)).toEqual(a.rooms[0].series.slice(0, -1))
  })

  it('설정의 방 이름·개수를 따르고, 장면마다 맞는 이상 표시가 나온다', () => {
    const env = mockEnvironment(now, 45)
    expect(env.rooms.map((r) => r.roomName)).toEqual(ADMIN_ROOMS.map((c) => c.name))
    const views = env.rooms.map((r, i) => toRoomView(r, ADMIN_ROOMS[i], now))
    expect(views[0].history).toHaveLength(45)
    expect(views[1].flags.overtime).toBe(true) // 2번: 시간 넘김
    expect(views[3].flags.stuck).toBe(true) // 4번: 센서 멈춤
  })

  it('90분 안에 1번 방이 기준을 넘을 것 같다는 노랑이 한 번은 나온다', () => {
    const soon = Array.from({ length: 90 }, (_, m) => {
      const t = new Date(now.getTime() + m * 60_000)
      return toRoomView(mockEnvironment(t, 45).rooms[0], ADMIN_ROOMS[0], t).flags.co2Soon
    })
    expect(soon.some(Boolean)).toBe(true)
  })

  it('5번 방은 90분 안에 예약 없이 CO2가 오르는 장면이 나온다', () => {
    const seen = Array.from({ length: 90 }, (_, m) => {
      const t = new Date(now.getTime() + m * 60_000)
      return toRoomView(mockEnvironment(t, 45).rooms[4], ADMIN_ROOMS[4], t).flags.unbooked
    })
    expect(seen.some(Boolean)).toBe(true)
    expect(seen.some((x) => !x)).toBe(true)
  })

  it('3번 빈 방은 90분 안에 더워지고, 다음 예약이 보인다', () => {
    const hot = Array.from({ length: 90 }, (_, m) => {
      const t = new Date(now.getTime() + m * 60_000)
      return toRoomView(mockEnvironment(t, 45).rooms[2], ADMIN_ROOMS[2], t)
    })
    expect(hot.some((v) => v.flags.hot)).toBe(true)
    expect(hot.every((v) => v.slot.startsWith('다음 '))).toBe(true)
  })

  it('설정에서 센서를 빼면 가짜 값도 그 칸을 비운다', () => {
    const env = mockEnvironment(now, 10, [{ roomId: 9, name: '실습실', sensors: ['co2'] }])
    expect(env.rooms[0].temperatureC).toBeNull()
    expect(env.rooms[0].presence).toBe('UNKNOWN')
    expect(env.rooms[0].co2).not.toBeNull()
  })
})

describe('isRoomsEnvironment (API 응답 검사)', () => {
  const ok0 = '2026-11-08T14:42:00+09:00'
  it('가짜 값 모양은 통과하고, current·next·forecast가 없어도 된다', () => {
    const env = mockEnvironment(now, 10)
    expect(isRoomsEnvironment(env)).toBe(true)
    const r = { ...env.rooms[0] }
    delete r.current
    delete r.next
    expect(isRoomsEnvironment({ now: env.now, rooms: [r] })).toBe(true)
  })

  it('rooms·series가 없거나 온도 칸이 빠지면 거절해 화면이 깨지지 않게 한다', () => {
    const env = mockEnvironment(now, 10)
    expect(isRoomsEnvironment(null)).toBe(false)
    expect(isRoomsEnvironment({ now: env.now })).toBe(false)
    const { series: _s, ...noSeries } = env.rooms[0]
    expect(isRoomsEnvironment({ now: env.now, rooms: [noSeries] })).toBe(false)
    const { temperatureC: _t, ...noTemp } = env.rooms[0]
    expect(isRoomsEnvironment({ now: env.now, rooms: [noTemp] })).toBe(false)
  })

  it('current·next가 있으면 시각·인원을 확인한다 (null은 된다)', () => {
    const env = mockEnvironment(now, 10)
    const r = env.rooms[0]
    const ok = { reservationId: 1, startAt: '2026-11-08T14:00:00+09:00', endAt: '2026-11-08T16:00:00+09:00', people: 4 }
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, current: null, next: null }] })).toBe(true)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, current: ok }] })).toBe(true)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, current: { ...ok, endAt: '언젠가' } }] })).toBe(false)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, current: { startAt: ok.startAt } }] })).toBe(false)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, next: { startAt: ok.startAt } }] })).toBe(false)
  })

  it('series·forecast 값에 시각이 없거나 날짜가 아니면 거절한다', () => {
    const env = mockEnvironment(now, 10)
    const r = env.rooms[0]
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, forecast: [{ at: ok0, ppm: 800 }] }] })).toBe(true)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, forecast: [{ ppm: 800 }] }] })).toBe(false)
    expect(isRoomsEnvironment({ now: env.now, rooms: [{ ...r, series: [{ at: '언젠가', ppm: 800 }] }] })).toBe(false)
  })
})

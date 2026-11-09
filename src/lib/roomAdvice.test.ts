import { describe, expect, it } from 'vitest'
import type { RoomEnvironment } from '../api/environment'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { majorAdvice, roomAdvice } from './roomAdvice'
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

  it('빈 방 문이 기준보다 오래 열려 있으면 주의로 알린다(사람이 있으면 환기라 알리지 않는다)', () => {
    const open = (presence: 'EMPTY' | 'OCCUPIED') => room((i) => 500 + (i % 2), { presence, door: { open: true, since: iso(14) } })
    const empty = toRoomView(open('EMPTY'), ADMIN_ROOMS[0], now)
    expect(empty.tone).toBe('warn')
    expect(empty.status.text).toBe('문 열림')
    expect(roomAdvice(empty, now).map((a) => a.title)).toContain('빈 방 문이 14분째 열려 있어요')
    const busy = toRoomView(open('OCCUPIED'), ADMIN_ROOMS[0], now)
    expect(busy.flags.doorLeftOpen).toBe(false)
  })

  it('건조는 참고라 맨 위 띠에는 올리지 않는다', () => {
    const dry = view(room((i) => 500 + (i % 2), { humidityPct: 30 }))
    expect(roomAdvice(dry, now)).toHaveLength(1)
    expect(majorAdvice(roomAdvice(dry, now))).toEqual([])
  })

  it('예약이 시작됐는데 아무도 없으면 노쇼까지 남은 분을 알려 준다', () => {
    const env = room((i) => 480 + (i % 2), { presence: 'EMPTY', current: { reservationId: 77, startAt: iso(7), endAt: iso(-113), people: 4 } })
    const v = view(env)
    expect(v.status.text).toBe('입실 안 함')
    const a = roomAdvice(v, now)
    expect(a[0].title).toBe('예약이 시작된 지 7분인데 아무도 없어요 (#77)')
    expect(a[0].todo).toContain('8분 안에 입실하지 않으면 노쇼')
  })

  it('밤에 문이 열리면 사람이 있어도 바로 알린다', () => {
    const night = new Date('2026-11-09T23:20:00+09:00')
    const at = (m: number) => new Date(night.getTime() - m * 60_000).toISOString()
    const series = Array.from({ length: 30 }, (_, i) => ({ at: at(29 - i), ppm: 600 + (i % 2), temperatureC: 24, humidityPct: 45, doorOpen: i >= 28 }))
    const env = { ...room(() => 600), series, co2: { ppm: 601, at: at(0) }, door: { open: true, since: at(1) } }
    const v = toRoomView(env, ADMIN_ROOMS[0], night)
    expect(v.status.text).toBe('밤에 문 열림')
    expect(roomAdvice(v, night)[0].title).toBe('밤에 문이 열렸어요 (23:19부터)')
  })

  it('막아 둔 방에 사람이 있거나 판정 안 한 신고가 있으면 알린다', () => {
    const v = view(room((i) => 600 + (i % 2), { current: { reservationId: 9, startAt: iso(30), endAt: iso(-60), people: 4 } }))
    const a = roomAdvice(v, now, { blocked: '점검 중', openReports: 2 })
    expect(a.map((x) => x.title)).toEqual(['점검 중으로 막아 둔 방에 사람이 있어요', '판정 기다리는 신고 2건'])
    expect(a[1].action).toBe('reports')
  })
})

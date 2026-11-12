import { describe, expect, it } from 'vitest'
import type { ClimateRoom, Series } from '../api/climate'
import type { RoomEnvironment, RoomsEnvironment } from '../api/environment'
import { overlayClimate } from './climateOverlay'

const base = { mean: 700, std: 50, lower: null, upper: 900, samples: 100, learning: false, scope: 'HOUR' }
const room = (id: number): RoomEnvironment => ({
  roomId: id, roomName: `창작실 ${id}`, presence: 'OCCUPIED', lastSignalAt: null, offline: false,
  co2: { ppm: 600, at: '2026-11-12T07:00:00Z' }, temperatureC: 23, humidityPct: 40,
  series: [0, 1, 2].map((m) => ({ at: `2026-11-12T07:0${m}:00Z`, ppm: null, temperatureC: 23, humidityPct: 40, light: 300 })),
  forecast: [],
} as unknown as RoomEnvironment)
const env: RoomsEnvironment = { now: '2026-11-12T07:03:30Z', rooms: [room(1), room(2)] }
const climate = { roomId: 1, metrics: { CO2: { value: 812.4, at: '2026-11-12T16:03:10+09:00' }, TEMPERATURE: { value: 24.1 } } } as unknown as ClimateRoom
const co2: Series = {
  unit: 'ppm', baseline: base,
  points: [1, 2, 3].map((m) => ({ at: `2026-11-12T16:0${m}:00+09:00`, value: 700 + m * 10, lower: null, upper: 900 })),
  forecast: [{ at: '2026-11-12T16:08:00+09:00', value: 860.6, lower: null, upper: 900 }],
}

describe('overlayClimate', () => {
  it('climate 값을 같은 분에 얹고, core보다 늦은 분은 붙이고, 길이는 core 그대로 둔다', () => {
    const r = overlayClimate(env, [climate], { 1: { CO2: co2 } }).rooms[0]
    expect(r.co2).toEqual({ ppm: 812, at: '2026-11-12T16:03:10+09:00' })
    expect(r.temperatureC).toBe(24.1)
    expect(r.series.map((p) => p.ppm)).toEqual([710, 720, 730])
    expect(r.series[0].light).toBe(300) // 조도 같은 core 값은 남는다
    expect(r.forecast).toEqual([{ at: '2026-11-12T16:08:00+09:00', ppm: 861 }])
  })

  it('core CO2가 더 새것이면 core 값을 둔다', () => {
    const old = { roomId: 1, metrics: { CO2: { value: 999, at: '2026-11-12T06:59:00Z' } } } as unknown as ClimateRoom
    expect(overlayClimate(env, [old], {}).rooms[0].co2).toEqual({ ppm: 600, at: '2026-11-12T07:00:00Z' })
  })

  it('climate에 없는 방은 그대로 둔다', () => {
    expect(overlayClimate(env, [climate], {}).rooms[1]).toBe(env.rooms[1])
  })

  it('가상 센서 방은 젯슨이 꺼져(core 끊김) 있어도 climate 값이 살아 있으면 끊김이 아니다', () => {
    const dead: RoomsEnvironment = { ...env, rooms: [{ ...room(1), offline: true, presence: 'UNKNOWN', lastSignalAt: '2026-11-12T08:42:00Z' }] }
    const sim = { ...climate, source: 'SIM', offline: false, occupied: null, envAt: '2026-11-12T11:10:00Z' } as unknown as ClimateRoom
    const r = overlayClimate(dead, [sim], {}).rooms[0]
    expect(r.offline).toBe(false)
    expect(r.lastSignalAt).toBe('2026-11-12T11:10:00Z')
    expect(r.presence).toBe('UNKNOWN') // 재실은 climate도 모르면 그대로 모름
  })

  it('실제 센서(REAL) 방은 core 끊김을 그대로 둔다', () => {
    const dead: RoomsEnvironment = { ...env, rooms: [{ ...room(1), offline: true }] }
    const real = { ...climate, source: 'REAL', offline: false } as unknown as ClimateRoom
    expect(overlayClimate(dead, [real], {}).rooms[0].offline).toBe(true)
  })

  it('가상 손님 방은 core 예약 대신 손님을 예약처럼 넣고(번호 0), 다음 예약은 뺀다', () => {
    const booked = { ...room(2), current: { reservationId: 7, startAt: '2026-11-12T05:00:00Z', endAt: '2026-11-12T06:00:00Z', people: 3 }, next: { startAt: '2026-11-12T09:00:00Z', people: 4 } } as RoomEnvironment
    const guest = { roomId: 2, metrics: {}, source: 'SIM', virtual: true, occupied: true, offline: false, envAt: null, people: 5,
      occupiedSince: '2026-11-12T15:40:00+09:00', occupiedUntil: '2026-11-12T17:10:00+09:00' } as unknown as ClimateRoom
    const r = overlayClimate({ ...env, rooms: [booked] }, [guest], {}).rooms[0]
    expect(r.current).toEqual({ reservationId: 0, startAt: '2026-11-12T15:40:00+09:00', endAt: '2026-11-12T17:10:00+09:00', people: 5 })
    expect(r.next).toBeNull()
    // 손님이 나가면 예약도 없음
    const left = overlayClimate({ ...env, rooms: [booked] }, [{ ...guest, occupied: false, occupiedUntil: null } as ClimateRoom], {}).rooms[0]
    expect(left.current).toBeNull()
  })

  it('실제 방(virtual 아님)은 core 예약을 그대로 둔다', () => {
    const booked = { ...room(1), current: { reservationId: 7, startAt: '2026-11-12T05:00:00Z', endAt: '2026-11-12T06:00:00Z', people: 3 } } as RoomEnvironment
    const real = { ...climate, source: 'SIM', virtual: false, occupied: true } as unknown as ClimateRoom
    expect(overlayClimate({ ...env, rooms: [booked] }, [real], {}).rooms[0].current?.reservationId).toBe(7)
  })
})

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
})

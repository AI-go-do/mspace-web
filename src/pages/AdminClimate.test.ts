import { describe, expect, it } from 'vitest'
import { ago, applyReading, upsertDecision } from './AdminClimate'
import type { ClimateRoom, Decision, Series } from '../api/climate'

const base = { mean: 600, std: 40, lower: 500, upper: 700, samples: 60, learning: false, scope: 'HOUR' }
const metric = (value: number, at: string) => ({ unit: 'ppm', value, at, baseline: base, trendPerMinute: 0, etaMinutes: null, towards: null, status: 'OK' as const })
const room = (id: number): ClimateRoom => ({
  roomId: id, roomName: `${id}번 방`, source: id === 1 ? 'REAL' : 'DERIVED', occupied: true, auto: true, offline: false,
  envAt: '2026-11-12T16:00:00+09:00', metrics: { CO2: metric(600, '2026-11-12T16:00:00+09:00') }, findings: [], appliances: [],
})
const series = (at: string): Series => ({ unit: 'ppm', points: [{ at, value: 600, lower: 500, upper: 700 }], forecast: [], baseline: base })

describe('applyReading', () => {
  it('밀려온 값은 그 방 숫자와 그래프 끝에 바로 붙는다', () => {
    const out = applyReading([room(1), room(2)], { 1: { CO2: series('2026-11-12T16:00:00+09:00') } },
      { roomId: 1, at: '2026-11-12T16:01:10+09:00', co2: 812, temperatureC: null, humidityPct: null, source: 'REAL' })
    expect(out.rooms[0].metrics.CO2?.value).toBe(812)
    expect(out.rooms[1].metrics.CO2?.value).toBe(600)
    expect(out.series[1].CO2?.points.map((p) => p.value)).toEqual([600, 812])
    expect(out.series[1].CO2?.points[1].upper).toBe(700)
  })

  it('같은 분에 다시 오면 그래프 점을 갈아 끼운다', () => {
    const out = applyReading([room(1)], { 1: { CO2: series('2026-11-12T16:00:05+09:00') } },
      { roomId: 1, at: '2026-11-12T16:00:40+09:00', co2: 640, temperatureC: null, humidityPct: null, source: 'REAL' })
    expect(out.series[1].CO2?.points.map((p) => p.value)).toEqual([640])
  })
})

describe('upsertDecision', () => {
  const d = (id: string, open: boolean, openedAt: string): Decision => ({
    id, roomId: 1, roomName: '1번 방', metric: 'CO2', group: 'HIGH', kind: 'RISING_SOON', openedAt, closedAt: open ? null : openedAt, open, steps: [],
  })
  it('같은 id는 갈아 끼우고, 다시 확인 중인 카드가 먼저 온다', () => {
    let list = upsertDecision([], d('a', false, '2026-11-12T15:00:00+09:00'))
    list = upsertDecision(list, d('b', true, '2026-11-12T14:00:00+09:00'))
    list = upsertDecision(list, d('a', false, '2026-11-12T15:00:00+09:00'))
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('ago', () => {
  it('초·분으로 줄인다', () => {
    const now = Date.parse('2026-11-12T16:02:00+09:00')
    expect(ago('2026-11-12T16:01:48+09:00', now)).toBe('12초 전')
    expect(ago('2026-11-12T15:59:00+09:00', now)).toBe('3분 전')
  })
})

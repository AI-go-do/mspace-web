import { describe, expect, it } from 'vitest'
import { deviceSlots, FRESH_MS, lastControl } from './AdminDevices'
import type { ClimateAppliance, Decision } from '../api/climate'

const ap = (kind: ClimateAppliance['kind'], power: 'ON' | 'OFF', extra: Partial<ClimateAppliance> = {}): ClimateAppliance => ({
  applianceId: `${kind}-1`, roomId: 1, kind, brand: '가상', adapter: 'virtual', power, mode: null, targetC: null, changedAt: null, by: null, ...extra,
})
const NOW = Date.parse('2026-11-12T17:53:00+09:00')

describe('deviceSlots', () => {
  it('에어컨은 지금 모드 칸만 켜지고, 오디가 방금 바꾼 기기는 fresh', () => {
    const s = deviceSlots([
      ap('AIRCON', 'ON', { mode: 'COOL', targetC: 24, by: 'AUTO', changedAt: '2026-11-12T17:52:30+09:00' }),
      ap('VENTILATOR', 'ON', { by: 'AUTO', changedAt: new Date(NOW - FRESH_MS - 1000).toISOString() }),
      ap('PURIFIER', 'OFF'),
    ], NOW)
    expect(s.map((x) => [x.key, x.on, x.detail, x.fresh])).toEqual([
      ['cool', true, '24°', true], ['heat', false, '꺼짐', false], ['dry', false, '꺼짐', false],
      ['fan', true, '켬', false], ['purifier', false, '꺼짐', false],
    ])
  })

  it('없는 기기는 없음으로', () => {
    const s = deviceSlots([], NOW)
    expect(s.every((x) => !x.have)).toBe(true)
    expect(s.find((x) => x.key === 'fan')?.detail).toBe('없음')
  })
})

describe('lastControl', () => {
  const dec = (id: string, room: number, status: 'DONE' | 'RUNNING' | 'SKIPPED', at: string, text: string): Decision => ({
    id, roomId: room, roomName: `${room}번 방`, metric: 'CO2', group: 'HIGH', kind: 'OVER', open: true, openedAt: at, closedAt: null,
    steps: [{ key: 'CONTROL', status, text, at }],
  } as unknown as Decision)
  it('하는 중인 제어가 먼저, 아니면 가장 최근 제어', () => {
    const list = [dec('a', 1, 'DONE', '2026-11-12T17:40:00+09:00', '환풍기 켬'), dec('b', 1, 'DONE', '2026-11-12T17:50:00+09:00', '에어컨 냉방 24°C'), dec('c', 2, 'RUNNING', '2026-11-12T17:51:00+09:00', '고르는 중')]
    expect(lastControl(list, 1)).toEqual({ text: '에어컨 냉방 24°C', at: '2026-11-12T17:50:00+09:00', running: false })
    expect(lastControl(list, 2)?.running).toBe(true)
    expect(lastControl([dec('d', 3, 'SKIPPED', '2026-11-12T17:50:00+09:00', '빈 방')], 3)).toBeNull()
  })
})

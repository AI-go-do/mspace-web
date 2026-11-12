import { describe, expect, it } from 'vitest'
import { deviceSlots, FRESH_MS } from './AdminDevices'
import type { ClimateAppliance } from '../api/climate'

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

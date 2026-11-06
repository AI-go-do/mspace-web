import { describe, expect, it } from 'vitest'
import { minutesLabel, timeRange, whenLabel } from './format'

describe('글자 모양', () => {
  it('남은 시간', () => {
    expect(minutesLabel(48)).toBe('48분')
    expect(minutesLabel(72)).toBe('1시간 12분')
    expect(minutesLabel(120)).toBe('2시간')
    expect(minutesLabel(-3)).toBe('0분')
  })
  it('서울 시각으로 보여 준다', () => {
    expect(timeRange('2026-11-03T10:00:00Z', '2026-11-03T12:00:00Z')).toBe('19:00–21:00')
    expect(whenLabel('2026-11-05T05:00:00Z', new Date('2026-11-03T10:00:00Z'))).toBe('11월 5일 (목)')
    expect(whenLabel('2026-11-03T10:00:00Z', new Date('2026-11-03T01:00:00Z'))).toBe('오늘 11월 3일 (화)')
  })
})

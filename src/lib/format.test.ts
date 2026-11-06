import { describe, expect, it } from 'vitest'
import { canContinueAt, minutesLabel, remainLabel, timeRange, whenLabel } from './format'

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

describe('사용 중 카드', () => {
  it('남은 시간을 1초 단위로 보여 준다', () => {
    expect(remainLabel((83 * 60 + 5) * 1000)).toBe('1시간 23분 05초')
    expect(remainLabel((4 * 60 + 9) * 1000)).toBe('4분 09초')
    expect(remainLabel(7_900)).toBe('7초')
    expect(remainLabel(-1000)).toBe('0초')
  })
  it('연장은 끝나기 10분 전부터 끝나기 전까지', () => {
    const end = '2026-11-06T16:00:00+09:00'
    expect(canContinueAt(end, Date.parse('2026-11-06T15:49:59+09:00'))).toBe(false)
    expect(canContinueAt(end, Date.parse('2026-11-06T15:50:00+09:00'))).toBe(true)
    expect(canContinueAt(end, Date.parse('2026-11-06T15:59:59+09:00'))).toBe(true)
    expect(canContinueAt(end, Date.parse('2026-11-06T16:00:00+09:00'))).toBe(false)
  })
})

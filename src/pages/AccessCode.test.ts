import { describe, expect, it } from 'vitest'
import { checkInDeadline, isInstantStart } from './AccessCode'

describe('입실 마감 (FR-ACC-001)', () => {
  it('미리 예약은 30분 경계에서 시작하고 15분 뒤가 마감', () => {
    expect(isInstantStart('2026-11-05T14:30:00+09:00')).toBe(false)
    expect(checkInDeadline('2026-11-05T14:30:00+09:00').toISOString()).toBe('2026-11-05T05:45:00.000Z')
  })
  it('즉시 시작은 누른 시각에서 시작하고 10분 뒤가 마감(새로 열어도 같다)', () => {
    expect(isInstantStart('2026-11-05T14:17:23+09:00')).toBe(true)
    expect(checkInDeadline('2026-11-05T14:17:23+09:00').toISOString()).toBe('2026-11-05T05:27:23.000Z')
  })
})

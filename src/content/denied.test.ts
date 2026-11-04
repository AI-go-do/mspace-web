import { describe, expect, it } from 'vitest'
import { deniedFor } from './denied'

describe('예약 거절 안내 (FR-WEB-006)', () => {
  it('요구사항 표의 경우마다 다음 행동이 있다', () => {
    expect(deniedFor('RESERVATION_TIME_TAKEN').next).toBe('time')
    expect(deniedFor('OWNER_HAS_ACTIVE_RESERVATION').next).toBe('mine')
    expect(deniedFor('PARTICIPANT_TIME_TAKEN').next).toBe('members')
    expect(deniedFor('HEADCOUNT_OUT_OF_RANGE').next).toBe('members')
    expect(deniedFor('RESERVATION_INVALID_LENGTH').next).toBe('time')
    expect(deniedFor('RESERVATION_OUT_OF_RANGE').next).toBe('date')
  })
  it('모르는 code는 다시 시도', () => {
    expect(deniedFor('RESERVATION_BUSY')).toMatchObject({ next: 'retry', action: '다시 시도' })
  })
})

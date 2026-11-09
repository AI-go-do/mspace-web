import { describe, expect, it } from 'vitest'
import { deniedFor, deniedLine } from './denied'

describe('예약 거절 안내 (FR-WEB-006)', () => {
  it('요구사항 표의 경우마다 다음 행동이 있다', () => {
    expect(deniedFor('RESERVATION_TIME_TAKEN').next).toBe('time')
    expect(deniedFor('OWNER_HAS_ACTIVE_RESERVATION').next).toBe('mine')
    expect(deniedFor('PARTICIPANT_TIME_TAKEN').next).toBe('members')
    expect(deniedFor('PARTICIPANT_HAS_ACTIVE_RESERVATION')).toMatchObject({ next: 'members', action: '함께 쓸 사람 고치기' })
    expect(deniedFor('HEADCOUNT_OUT_OF_RANGE').next).toBe('members')
    expect(deniedFor('RESERVATION_INVALID_LENGTH').next).toBe('time')
    expect(deniedFor('RESERVATION_OUT_OF_RANGE').next).toBe('date')
  })
  it('빈방 릴레이로 잡아 둔 칸·받을 시간이 지난 넘김은 다른 시간을 고르게 한다 (core #101)', () => {
    expect(deniedFor('RELAY_HELD')).toMatchObject({ next: 'time', action: '다른 시간 보기' })
    expect(deniedFor('RELAY_OFFER_INVALID').next).toBe('time')
  })
  it('모르는 code는 다시 시도', () => {
    expect(deniedFor('RESERVATION_BUSY')).toMatchObject({ next: 'retry', action: '다시 시도' })
  })
  it('확인 카드 한 줄: 아는 code는 친절한 문구, 모르는 code는 서버 메시지', () => {
    expect(deniedLine('PARTICIPANT_HAS_ACTIVE_RESERVATION', '참여자 중 끝나지 않은 예약이 이미 있는 사람이 있습니다'))
      .toContain('그 사람을 빼거나')
    expect(deniedLine('SOMETHING_NEW', '서버 메시지')).toBe('서버 메시지')
  })
  it('연결이 끊기거나 늦으면 실패라고 단정하지 않고 같은 내용으로 다시 시도·내 예약 확인을 준다', () => {
    for (const code of ['NETWORK', 'TIMEOUT']) {
      expect(deniedFor(code)).toMatchObject({ title: '예약이 됐는지 확인하지 못했어요', next: 'retry', unsure: true })
      expect(deniedLine(code, 'Failed to fetch')).toContain('확인하지 못했어요')
    }
    expect(deniedFor('RESERVATION_TIME_TAKEN').unsure).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { adminErrorMessage, JUDGE_OPTIONS, stillInRoom } from './admin'
import { ApiError } from './client'

const photo = { kind: 'CHECK_OUT' as const, exists: false, url: '', uploadedAt: null }

describe('증거의 직전 예약이 아직 방에 있는지 (강제 퇴실 권하기)', () => {
  it('입실했고 퇴실 시각이 없으면 아직 사용 중', () => {
    expect(stillInRoom({ reservationId: 1, checkedInAt: '2026-11-06T13:00:00+09:00', checkedOutAt: null, photo })).toBe(true)
  })
  it('퇴실했거나 직전 예약이 없으면 아니다', () => {
    expect(stillInRoom({ reservationId: 1, checkedInAt: '2026-11-06T13:00:00+09:00', checkedOutAt: '2026-11-06T14:00:00+09:00', photo })).toBe(false)
    expect(stillInRoom(null)).toBe(false)
  })
})

describe('판정 버튼과 오류 문구 (FR-RPT-103)', () => {
  it('판정은 사실·확인 불가·허위 셋, 대기(OPEN)는 없다', () => {
    expect(JUDGE_OPTIONS.map((o) => o.verdict)).toEqual(['CONFIRMED', 'UNVERIFIED', 'FALSE'])
  })
  it('이미 판정한 신고는 다른 관리자가 판정했다고 알린다', () => {
    expect(adminErrorMessage(new ApiError(409, 'REPORT_ALREADY_JUDGED', 'x'))).toContain('이미')
  })
  it('관리자가 아니면 관리자만이라고 알린다', () => {
    expect(adminErrorMessage(new ApiError(403, 'ADMIN_ONLY', 'x'))).toBe('관리자만 할 수 있어요.')
  })
  it('core에 아직 없는 API(코드 없는 404)는 배포 확인 안내', () => {
    expect(adminErrorMessage(new ApiError(404, 'UNKNOWN', 'x'))).toContain('core')
  })
})

describe('통계 숫자 모양 (core #74)', () => {
  it('비율은 반올림한 %, 모르면 —', async () => {
    const { pct } = await import('./admin')
    expect(pct(0.4249)).toBe('42%')
    expect(pct(null)).toBe('—')
  })
  it('n일 전 날짜는 달·해를 넘긴다', async () => {
    const { daysBefore } = await import('./admin')
    expect(daysBefore('2026-11-06', 6)).toBe('2026-10-31')
    expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31')
  })
})

import { describe, expect, it } from 'vitest'
import { appealProblem, appealStep, canAppeal, daysLeft, draftAppeal, forEvidence, statusLabel, type WarningRecord } from './appeal'

const now = new Date('2026-11-08T22:00:00+09:00')
const w = (over: Partial<WarningRecord> = {}): WarningRecord => ({
  id: 1, kind: 'NO_SHOW', roomId: 2,
  startAt: '2026-11-06T14:00:00+09:00', endAt: '2026-11-06T16:00:00+09:00', issuedAt: '2026-11-06T14:15:00+09:00',
  why: '14:15까지 입실 기록이 없었어요',
  evidence: [
    { at: '2026-11-06T14:03:00+09:00', source: '문 장치', text: '문 앞 QR을 3번 찍었지만 열리지 않았어요', tone: 'for' },
    { at: '2026-11-06T14:09:00+09:00', source: '문 장치', text: '장치 와이파이가 6분 끊겼어요.', tone: 'for' },
    { at: '2026-11-06T14:15:00+09:00', source: '예약', text: '입실 기록이 없어 노쇼로 바뀌었어요', tone: 'neutral' },
  ],
  appeal: null,
  ...over,
})

describe('벌점 해명 카드', () => {
  it('받은 지 7일 안이고 아직 안 보냈으면 해명할 수 있다', () => {
    expect(canAppeal(w(), now)).toBe(true)
    expect(canAppeal(w({ issuedAt: '2026-10-31T21:00:00+09:00' }), now)).toBe(false)
    expect(canAppeal(w({ appeal: { status: 'SENT', text: 'x', sentAt: now.toISOString(), evidence: [], answer: null } }), now)).toBe(false)
  })

  it('마감까지 남은 날을 센다', () => {
    expect(daysLeft(w(), now)).toBe(4)
    expect(daysLeft(w({ issuedAt: '2026-11-01T23:00:00+09:00' }), now)).toBe(0)
    expect(daysLeft(w({ issuedAt: '2026-10-01T00:00:00+09:00' }), now)).toBeNull()
  })

  it('초안은 학생에게 유리한 기록의 시각·내용만으로 쓴다', () => {
    expect(forEvidence(w())).toEqual([0, 1])
    const d = draftAppeal(w())
    expect(d).toContain('2번 방 14:00–16:00 예약의 노쇼 경고')
    expect(d).toContain('14:03에 문 앞 QR을 3번 찍었지만 열리지 않았어요, 14:09에 장치 와이파이가 6분 끊겼어요.')
    expect(d).toContain('문이 열리지 않아')
    expect(d).not.toContain('14:15에')
  })

  it('근거를 하나도 안 고르면 첫 줄만 남긴다', () => {
    expect(draftAppeal(w(), [])).toBe('2번 방 14:00–16:00 예약의 노쇼 경고를 다시 봐 주세요.\n')
  })

  it('너무 짧거나 길거나, 전화번호·학번이 있으면 막는다', () => {
    expect(appealProblem('짧아요')).toMatch(/10자/)
    expect(appealProblem('가'.repeat(501))).toMatch(/500자/)
    expect(appealProblem('문이 안 열렸어요. 010-1234-5678로 연락 주세요')).toMatch(/전화번호/)
    expect(appealProblem('문이 안 열렸어요. 학번 20231234 입니다')).toMatch(/학번/)
    expect(appealProblem('14:03에 QR을 세 번 찍었는데 안 열렸어요')).toBeNull()
    // 날짜는 학번으로 막지 않는다
    expect(appealProblem('2026-11-06 14:03에 QR을 찍었는데 안 열렸어요')).toBeNull()
    expect(appealProblem('2026.11.06에 QR을 찍었는데 안 열렸어요')).toBeNull()
  })

  it('상태 글과 진행 칸', () => {
    expect(statusLabel(w(), now)).toEqual({ text: '4일 안 해명', tone: 'open' })
    expect(statusLabel(w({ issuedAt: '2026-11-01T23:00:00+09:00' }), now).text).toBe('오늘까지 해명')
    expect(statusLabel(w({ issuedAt: '2026-10-01T00:00:00+09:00' }), now).tone).toBe('closed')
    const sent = { status: 'SENT' as const, text: 'x', sentAt: now.toISOString(), evidence: [], answer: null }
    expect(statusLabel(w({ appeal: sent }), now).text).toBe('검토 중')
    expect(statusLabel(w({ appeal: { ...sent, status: 'ACCEPTED' } }), now).text).toBe('무름')
    expect(appealStep(null)).toBe(0)
    expect(appealStep(sent)).toBe(1)
    expect(appealStep({ ...sent, status: 'REJECTED' })).toBe(3)
  })
})

import { describe, expect, it } from 'vitest'
import { appealButtonLabel, appealProblem, appealStep, canAppeal, confidenceLabel, daysLeft, demoDecision, draftAppeal, forEvidence, leftLabel, statusLabel, type WarningRecord } from './appeal'

const now = new Date('2026-11-08T22:00:00+09:00')
const w = (over: Partial<WarningRecord> = {}): WarningRecord => ({
  id: 1, kind: 'NO_SHOW', roomId: 2, reservationId: 51,
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

describe('경고 철회 요청 (FR-RPT-105)', () => {
  it('받은 지 7일 안이고 아직 안 보냈으면 철회를 요청할 수 있다', () => {
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
    // 날짜처럼 생겼지만 뒤에 숫자가 더 붙거나 없는 날이면 그대로 막는다
    expect(appealProblem('문이 안 열렸어요. 학번 2023-12-3456 입니다')).toMatch(/학번/)
    expect(appealProblem('문이 안 열렸어요. 번호 2023-13-45 입니다')).toMatch(/학번/)
    // 달력에 없는 날(2월 30일, 평년 2월 29일)도 날짜로 보지 않고 막는다. 윤년 2월 29일은 날짜
    expect(appealProblem('문이 안 열렸어요. 번호 2023-02-30 입니다')).toMatch(/학번/)
    expect(appealProblem('문이 안 열렸어요. 번호 2023-02-29 입니다')).toMatch(/학번/)
    expect(appealProblem('문이 안 열렸어요. 번호 2023-04-31 입니다')).toMatch(/학번/)
    expect(appealProblem('2028-02-29에 QR을 찍었는데 안 열렸어요')).toBeNull()
  })

  it('상태 글과 진행 칸', () => {
    expect(statusLabel(w(), now)).toEqual({ text: '철회 요청 5일 남음', tone: 'open' })
    expect(statusLabel(w({ issuedAt: '2026-11-01T23:00:00+09:00' }), now).text).toBe('철회 요청 1시간 남음')
    expect(statusLabel(w({ issuedAt: '2026-10-01T00:00:00+09:00' }), now)).toEqual({ text: '요청 기간 끝남', tone: 'closed' })
    const sent = { status: 'SENT' as const, text: 'x', sentAt: now.toISOString(), evidence: [], answer: null }
    expect(statusLabel(w({ appeal: sent }), now).text).toBe('AI가 다시 보는 중')
    expect(statusLabel(w({ appeal: { ...sent, status: 'ACCEPTED' } }), now).text).toBe('철회됨')
    expect(statusLabel(w({ appeal: { ...sent, status: 'REJECTED' } }), now).text).toBe('경고 유지')
    expect(appealStep(null)).toBe(0)
    expect(appealStep(sent)).toBe(1)
    expect(appealStep({ ...sent, status: 'REJECTED' })).toBe(3)
  })

  it('남은 시간은 배달 앱 리뷰처럼: 받자마자 7일, 하루 안이면 시간, 1시간 안이면 곧 마감', () => {
    const at = (iso: string) => w({ issuedAt: iso })
    expect(leftLabel(at('2026-11-08T22:00:00+09:00'), now)).toBe('7일 남음')
    expect(leftLabel(at('2026-11-02T03:00:00+09:00'), now)).toBe('5시간 남음')
    expect(leftLabel(at('2026-11-01T22:30:00+09:00'), now)).toBe('곧 마감')
    expect(leftLabel(at('2026-11-01T22:00:00+09:00'), now)).toBeNull()
  })

  it('버튼 글은 "경고 철회 요청 (N일 남음)", 보냈거나 기간이 지나면 없다', () => {
    expect(appealButtonLabel(w({ issuedAt: '2026-11-08T21:00:00+09:00' }), now)).toBe('경고 철회 요청 (7일 남음)')
    expect(appealButtonLabel(w(), now)).toBe('경고 철회 요청 (5일 남음)')
    expect(appealButtonLabel(w({ issuedAt: '2026-10-01T00:00:00+09:00' }), now)).toBeNull()
    const sent = { status: 'SENT' as const, text: 'x', sentAt: now.toISOString(), evidence: [], answer: null }
    expect(appealButtonLabel(w({ appeal: sent }), now)).toBeNull()
  })

  it('예시 AI 판단: 유리한 기록을 같이 보내면 철회, 아니면 유지. 이유는 고른 기록으로만 쓴다', () => {
    const yes = demoDecision(w(), [0, 2])
    expect(yes.status).toBe('ACCEPTED')
    expect(yes.answer).toContain('14:03 문 장치 기록(문 앞 QR을 3번 찍었지만 열리지 않았어요)')
    expect(yes.answer).not.toContain('14:15')
    expect(yes.confidence).toBeGreaterThan(0.8)
    const no = demoDecision(w(), [2])
    expect(no.status).toBe('REJECTED')
    expect(no.answer).toContain('그대로')
  })

  it('확신도는 백분율로, 모르면 쓰지 않는다', () => {
    expect(confidenceLabel(0.934)).toBe('확신 93%')
    expect(confidenceLabel(1.4)).toBe('확신 100%')
    expect(confidenceLabel(null)).toBeNull()
    expect(confidenceLabel(undefined)).toBeNull()
  })

  it('전화번호·학번을 막는 글은 AI 기준으로 안내한다', () => {
    expect(appealProblem('문이 안 열렸어요. 010-1234-5678로 연락 주세요')).toContain('AI는 예약 기록으로')
  })
})

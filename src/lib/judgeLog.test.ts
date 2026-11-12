import { describe, expect, it } from 'vitest'
import type { TidyCheckRow } from '../api/admin'
import { judgeCounts, judgeRows, reportRow, tidyRow, type JudgedReport } from './judgeLog'

const now = new Date('2026-11-12T11:00:00+09:00')
const room = (id: number) => `창작실 ${id}`
const report = (o: Partial<JudgedReport>): JudgedReport => ({
  id: 7, roomId: 2, category: 'MESSY', content: null, verdict: 'CONFIRMED', reporterReservationId: 41,
  createdAt: '2026-11-12T10:00:00+09:00', judgedAt: '2026-11-12T10:01:00+09:00', ...o,
})
const tidy = (o: Partial<TidyCheckRow>): TidyCheckRow => ({
  phase: 'FIRST', result: 'CLEAN', items: [], leftItems: [], observedAt: '2026-11-12T10:30:00+09:00',
  reservationId: 90, roomId: 1, roomName: '창작실 1', endedAt: null, reportId: null, ...o,
})

describe('오디 판단 기록', () => {
  it('학생 신고 사실 판정은 앞 팀 대표자 경고로 보인다', () => {
    const r = reportRow(report({}), room, now)
    expect(r.verdict).toBe('사실 · 앞 팀 대표자 경고 1회')
    expect(r.room).toBe('창작실 2')
    expect(r.time).toBe('10:01')
    expect(r.day).toBeNull()
    expect(r.sure).toBeNull()
  })

  it('판정 전 신고는 판정 중, 카메라 신고 허위는 경고 없음', () => {
    expect(reportRow(report({ verdict: 'OPEN', judgedAt: null }), room, now).verdict).toBe('판정 중')
    expect(reportRow(report({ verdict: 'FALSE', reporterReservationId: null }), room, now).verdict).toBe('허위 · 경고 없음')
  })

  it('core가 판정기 확신도·근거를 붙이면 그대로 보인다', () => {
    const r = reportRow(report({ judgement: { judge: 'gemini', confidence: 0.873, reasons: '퇴실 사진에 컵 3개' } }), room, now)
    expect(r.sure).toBe(87)
    expect(r.why).toBe('퇴실 사진에 컵 3개')
  })

  it('어제 기록은 날짜가 붙는다', () => {
    expect(reportRow(report({ judgedAt: '2026-11-11T13:42:00+09:00' }), room, now).day).toBe('11/11')
  })

  it('정리 확인: 두고 간 물품은 알림, 확신도는 가장 높은 값', () => {
    const t = tidyRow(tidy({ result: 'LEFT_ITEMS', items: [{ name: 'cup', confidence: 0.5 }, { name: 'cup', confidence: 0.81 }] }), now)
    expect(t.verdict).toBe('두고 간 물품 · 대표자에게 알림')
    expect(t.sure).toBe(81)
    expect(t.why).toBe('컵 2개')
    expect(t.by).toBe('방 카메라 AI')
    expect(tidyRow(tidy({}), now).verdict).toBe('깨끗함')
  })

  it('다시 확인에 신고가 생기면 신고 번호를 보여 준다', () => {
    expect(tidyRow(tidy({ phase: 'RECHECK', result: 'LEFT_ITEMS', reportId: 12 }), now).verdict).toBe('3시간 뒤에도 남음 · 신고 #12')
    expect(tidyRow(tidy({ phase: 'RECHECK' }), now).verdict).toBe('치워짐')
  })

  it('두 기록을 최근 순으로 합치고 소음 신고는 뺀다', () => {
    const rows = judgeRows([report({}), report({ id: 8, category: 'NOISE' })], [tidy({})], room, now)
    expect(rows.map((r) => r.key)).toEqual(['t90-FIRST', 'r7'])
    expect(judgeCounts(rows)).toEqual({ done: 2, warned: 1, waiting: 0 })
  })
})

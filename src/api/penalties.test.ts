import { describe, expect, it } from 'vitest'
import { penaltySummary, type MyPenalty } from './penalties'

const base: MyPenalty = { warnings: 0, falseReportWarnings: 0, limit: 3, windowDays: 30, suspendedUntil: null, reportSuspendedUntil: null }

describe('이용 규칙 "내 경고 N회" (FR-WEB-003, core #92)', () => {
  it('경고가 없으면 0회와 서버 설정값(30일·3회)으로 기준을 보여 준다', () => {
    const s = penaltySummary(base)
    expect(s.title).toBe('내 경고 0회')
    expect(s.lines).toEqual(['최근 30일 안에 3회가 되면 정지돼요.'])
    expect(s.warn).toBe(false)
  })

  it('기준 숫자는 화면에 박지 않고 응답 값을 쓴다', () => {
    expect(penaltySummary({ ...base, limit: 5, windowDays: 14 }).lines[0]).toBe('최근 14일 안에 5회가 되면 정지돼요.')
  })

  it('한 번만 더 받으면 정지인 때부터 강조한다', () => {
    expect(penaltySummary({ ...base, warnings: 1 }).warn).toBe(false)
    expect(penaltySummary({ ...base, warnings: 2 }).warn).toBe(true)
  })

  it('기준이 1회면 아직 0회여도 강조한다', () => {
    expect(penaltySummary({ ...base, limit: 1 }).warn).toBe(true)
  })

  it('정지 중이면 끝나는 때를 서울 시각으로 알린다', () => {
    const s = penaltySummary({ ...base, warnings: 0, suspendedUntil: '2026-11-21T05:00:00Z' })
    expect(s.lines[0]).toContain('14:00까지 예약·참여가 정지돼 있어요')
    expect(s.lines[0]).toContain('11월 21일')
    expect(s.warn).toBe(true)
  })

  it('정지 중에도 서버 설정 기준을 같이 보여 준다', () => {
    const s = penaltySummary({ ...base, limit: 5, windowDays: 14, suspendedUntil: '2026-11-21T05:00:00Z' })
    expect(s.lines[1]).toBe('최근 14일 안에 5회가 되면 정지돼요.')
  })

  it('정지 끝 시각을 읽을 수 없어도 화면이 깨지지 않는다', () => {
    const s = penaltySummary({ ...base, suspendedUntil: '언젠가', reportSuspendedUntil: 'bad' })
    expect(s.lines).toEqual(['지금 예약·참여가 정지돼 있어요.', '최근 30일 안에 3회가 되면 정지돼요.', '지금은 신고할 수 없어요.'])
    expect(s.warn).toBe(true)
  })

  it('허위 신고 경고와 신고 정지를 따로 보여 준다', () => {
    expect(penaltySummary({ ...base, falseReportWarnings: 1 }).lines[1]).toBe('허위 신고 경고 1회')
    const s = penaltySummary({ ...base, falseReportWarnings: 3, reportSuspendedUntil: '2026-11-20T15:00:00+09:00' })
    expect(s.lines[1]).toContain('15:00까지 할 수 없어요')
  })
})

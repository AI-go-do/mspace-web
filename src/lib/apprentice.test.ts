import { describe, expect, it } from 'vitest'
import type { AdminReport, Warning } from '../api/admin'
import { aiRecords, initialTrainees, rateOf, recordTotals, traineeNote } from './apprentice'

const report = (id: number, verdict: AdminReport['verdict'], judgedAt: string | null, createdAt = '2026-11-12T09:00:00+09:00'): AdminReport =>
  ({ id, roomId: 1, category: 'MESSY', content: null, verdict, reporterReservationId: 10, createdAt, judgedAt })
const warning = (id: number, reportId: number, withdrawnAt: string | null = null): Warning =>
  ({ id, member: { id: 1, studentId: '20260000', name: '홍길동' }, reason: 'VIOLATION', reportId, reservationId: 9, createdAt: '2026-11-12T10:00:00+09:00', withdrawnAt })

describe('인사 기록 카드', () => {
  it('신고 판정·경고 철회 판단은 측정한 정확도, 소수 한 자리로', () => {
    const t = initialTrainees()
    expect(['report', 'withdraw'].map((k) => rateOf(t.find((x) => x.kind === k)!))).toEqual([98.9, 98.2])
    // 자동 처리 5개는 가짜 사례 300개로 잰 값(core #139)
    const ops = ['vent', 'sensor', 'prep', 'overtime', 'unbooked'].map((k) => t.find((x) => x.kind === k)!)
    expect(ops.map(rateOf)).toEqual([89.3, 99.3, 89, 94, 96.7])
    expect(ops.every((x) => x.total === 300 && x.note === '가짜 사례 300개로 잰 값')).toBe(true)
  })
  it('카드 아래 한 줄', () => {
    const t = initialTrainees()
    expect(traineeNote(t.find((x) => x.kind === 'report')!)).toBe('가장 높은 단계')
    expect(traineeNote(t.find((x) => x.kind === 'noshow')!)).toBe('연속 맞음 3/10 · 레벨 2까지 7번')
  })
  it('잰 게 없으면 null', () => {
    expect(rateOf({ right: 0, total: 0 })).toBeNull()
  })
})

describe('처리 기록', () => {
  it('판정 기다리는 신고는 빼고, 판정 시각 최근 순으로', () => {
    const list = aiRecords([
      report(1, 'CONFIRMED', '2026-11-12T10:00:00+09:00'),
      report(2, 'OPEN', null),
      report(3, 'UNVERIFIED', '2026-11-12T11:00:00+09:00'),
    ], [])
    expect(list.map((r) => r.report.id)).toEqual([3, 1])
  })
  it('경고는 같은 신고 줄에 붙는다', () => {
    const list = aiRecords([report(1, 'CONFIRMED', '2026-11-12T10:00:00+09:00'), report(3, 'FALSE', '2026-11-12T11:00:00+09:00')],
      [warning(7, 1), warning(8, 3, '2026-11-12T12:00:00+09:00'), warning(9, 99)])
    expect(list.find((r) => r.report.id === 1)!.warnings.map((w) => w.id)).toEqual([7])
    expect(recordTotals(list)).toEqual({ judged: 2, warned: 2, withdrawn: 1 })
  })
  it('limit개까지만', () => {
    const many = Array.from({ length: 40 }, (_, i) => report(i + 1, 'CONFIRMED', new Date(Date.UTC(2026, 10, 12, 0, i)).toISOString()))
    expect(aiRecords(many, [], 30)).toHaveLength(30)
  })
})

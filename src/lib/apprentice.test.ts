import { describe, expect, it } from 'vitest'
import type { AdminReport, Warning } from '../api/admin'
import { aiRecords, initialTrainees, rateOf, recordTotals, traineeNote, withScores } from './apprentice'

const report = (id: number, verdict: AdminReport['verdict'], judgedAt: string | null, createdAt = '2026-11-12T09:00:00+09:00'): AdminReport =>
  ({ id, roomId: 1, category: 'MESSY', content: null, verdict, reporterReservationId: 10, createdAt, judgedAt })
const warning = (id: number, reportId: number, withdrawnAt: string | null = null): Warning =>
  ({ id, member: { id: 1, studentId: '20260000', name: '홍길동' }, reason: 'VIOLATION', reportId, reservationId: 9, createdAt: '2026-11-12T10:00:00+09:00', withdrawnAt })

describe('인사 기록 카드', () => {
  it('처음 값은 측정값(core mspace.ai-score.base와 같게)', () => {
    const t = initialTrainees()
    const rates = ['vent', 'sensor', 'prep', 'overtime', 'unbooked', 'noshow', 'report', 'withdraw']
      .map((k) => rateOf(t.find((x) => x.kind === k)!))
    expect(rates).toEqual([97, 99.3, 89, 94, 96.7, 90.5, 98.9, 97.3])
  })
  it('core 점수로 맞힘·전체가 바뀌고, 실제로 채점된 수가 붙는다. core에 없는 카드는 그대로', () => {
    const t = withScores(initialTrainees(), [
      { kind: 'VENT_SOON', right: 98, total: 101, base: { right: 96, total: 99 }, live: { right: 2, total: 2, pending: 1 } },
      { kind: 'MYSTERY', right: 1, total: 1, base: { right: 0, total: 0 }, live: { right: 1, total: 1, pending: 0 } },
    ])
    const vent = t.find((x) => x.kind === 'vent')!
    expect([vent.right, vent.total, vent.live, vent.pending]).toEqual([98, 101, 2, 1])
    expect(t.find((x) => x.kind === 'report')!.total).toBe(90)
    expect(t).toHaveLength(8)
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

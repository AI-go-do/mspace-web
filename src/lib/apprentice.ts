import type { AdminReport, Warning } from '../api/admin'

/**
 * AI 수습사원 (11/10 무인 운영, 11/12 지영 "AI가 다 알아서 처리하고 관리자는 어떻게 처리됐나만 본다,
 * 관리자가 할 수 있는 건 경고 철회뿐"). 사람이 [맞아요]를 누르는 결재함·레벨 단계는 뺐다.
 * 화면은 실제로 잰 정확도(성적표)와 core에 쌓인 처리 기록만 보여 준다
 */
export const STREAK_TO_LEVEL_UP = 10

/** 일 종류 하나의 인사 기록 카드 (11/8 web #55 레벨 규칙, 11/12 지영 "레벨 카드 그대로 두기") */
export interface Trainee {
  kind: string
  name: string
  level: 1 | 2 | 3
  maxLevel: 1 | 2 | 3
  /** 지금 이어서 맞힌 횟수 */
  streak: number
  right: number
  total: number
  /** 카드 아래 한 줄 더(점수 출처·되돌리는 길) */
  note?: string
}

/** 인사 기록 카드 값. 신고 판정·경고 철회 판단은 11/12 정확도 측정(core 점수판) 값, 나머지는 시연용 값 */
export function initialTrainees(): Trainee[] {
  const t = (kind: string, name: string, level: 1 | 2 | 3, maxLevel: 1 | 2 | 3, streak: number, right: number, total: number, note?: string): Trainee =>
    ({ kind, name, level, maxLevel, streak, right, total, ...(note ? { note } : {}) })
  return [
    t('vent', '미리 환기 안내', 2, 3, 6, 31, 32),
    t('sensor', '센서 고장 알림', 1, 3, 9, 14, 15),
    t('prep', '다음 예약 전 더움 안내', 1, 3, 4, 9, 10),
    t('overtime', '시간 넘김 안내', 1, 3, 5, 11, 13),
    t('unbooked', '예약 없는 사용 기록', 1, 3, 2, 4, 5),
    t('noshow', '억울한 노쇼 무르기', 1, 2, 3, 6, 8),
    // 신고 판정 98.9%(처음 보는 가짜 사례 30개×3번, 억울한 경고 0건), 경고 철회 판단 98.2%(사람이 쓴 글 37개×3번)
    t('report', '신고 판정', 3, 3, 0, 89, 90, '억울한 경고 0건 · 되돌리기는 경고 철회로'),
    t('withdraw', '경고 철회 판단', 3, 3, 0, 109, 111, '되돌리기는 경고 철회로'),
  ]
}

/** 인사 카드 아래 한 줄 */
export function traineeNote(t: Trainee): string {
  if (t.level >= t.maxLevel) return `가장 높은 단계${t.maxLevel < 3 ? ' (학생에게 유리한 일은 레벨 2까지)' : ''}`
  return `연속 맞음 ${t.streak}/${STREAK_TO_LEVEL_UP} · 레벨 ${t.level + 1}까지 ${STREAK_TO_LEVEL_UP - t.streak}번`
}

/** 맞힌 비율, 소수 한 자리 (98.9% 처럼) */
export const rateOf = (s: Pick<Trainee, 'right' | 'total'>): number | null =>
  s.total > 0 ? Math.round((s.right / s.total) * 1000) / 10 : null

/** 처리 기록 한 줄: 판정이 끝난 신고와 그 신고로 간 경고 */
export interface AiRecord {
  report: AdminReport
  warnings: Warning[]
}

/**
 * 판정이 끝난 신고만, 판정 시각 최근 순으로 limit개. 경고는 reportId로 붙인다.
 * 판정 기다리는 신고(OPEN)는 아직 처리 전이라 넣지 않는다
 */
export function aiRecords(reports: AdminReport[], warnings: Warning[], limit = 30): AiRecord[] {
  const byReport = new Map<number, Warning[]>()
  for (const w of warnings) byReport.set(w.reportId, [...(byReport.get(w.reportId) ?? []), w])
  const at = (r: AdminReport) => Date.parse(r.judgedAt ?? r.createdAt)
  return reports
    .filter((r) => r.verdict !== 'OPEN')
    .sort((a, b) => at(b) - at(a))
    .slice(0, limit)
    .map((report) => ({ report, warnings: byReport.get(report.id) ?? [] }))
}

/** 위 숫자: 처리한 신고 · 경고가 간 신고 · 철회된 경고 */
export function recordTotals(records: AiRecord[]): { judged: number; warned: number; withdrawn: number } {
  const ws = records.flatMap((r) => r.warnings)
  return {
    judged: records.length,
    warned: records.filter((r) => r.warnings.length > 0).length,
    withdrawn: ws.filter((w) => !!w.withdrawnAt).length,
  }
}

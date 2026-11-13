import type { AdminReport, AiScore, Warning } from '../api/admin'

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
  /** 실제 운영에서 채점된 처리 수(측정값 위에 더해진 것) */
  live?: number
  /** 결과를 기다리는 실제 처리 수 */
  pending?: number
}

/**
 * 인사 기록 카드 처음 값 = 측정값(core application.yml mspace.ai-score.base와 같게, 11/13).
 * 화면을 열면 core GET /api/admin/ai-scores(측정값 + 실제 처리 채점)로 바뀌고, 실제로 맞힐 때마다 올라간다
 */
export function initialTrainees(): Trainee[] {
  const t = (kind: string, name: string, level: 1 | 2 | 3, maxLevel: 1 | 2 | 3, streak: number, right: number, total: number, note?: string): Trainee =>
    ({ kind, name, level, maxLevel, streak, right, total, ...(note ? { note } : {}) })
  return [
    // 자동 처리 5개 (core README "실험 기록: 자동 처리 규칙"). 미리 환기는 11판, 실습실 실제 기록 확인 기간. 레벨은 그대로(11/12 지영)
    t('vent', '미리 환기 안내', 2, 3, 6, 96, 99),
    t('sensor', '센서 고장 알림', 1, 3, 9, 298, 300),
    t('prep', '다음 예약 전 더움 안내', 1, 3, 4, 267, 300),
    t('overtime', '시간 넘김 안내', 1, 3, 5, 282, 300),
    t('unbooked', '예약 없는 사용 기록', 1, 3, 2, 290, 300),
    // 억울한 노쇼 무르기: 가짜 사례 21개(core NoShowExcuseEval, 11/13)
    t('noshow', '억울한 노쇼 무르기', 1, 2, 3, 19, 21),
    // 신고 판정 98.9%(처음 보는 가짜 사례 30개×3번, 억울한 경고 0건), 경고 철회 판단 9판 97.3%(사람이 쓴 글 37개×3번)
    t('report', '신고 판정', 3, 3, 0, 89, 90, '억울한 경고 0건 · 되돌리기는 경고 철회로'),
    t('withdraw', '경고 철회 판단', 3, 3, 0, 108, 111, '되돌리기는 경고 철회로'),
  ]
}

/** core 카드 종류 → 화면 카드 */
export const SCORE_KIND: Record<string, string> = {
  VENT_SOON: 'vent', SENSOR_DOWN: 'sensor', ROOM_HOT: 'prep', OVERTIME: 'overtime', UNBOOKED: 'unbooked',
  NO_SHOW_EXCUSE: 'noshow', REPORT_JUDGE: 'report', APPEAL_REVIEW: 'withdraw',
}

/** core 점수로 카드 맞힘·전체를 바꾸고, 실제로 채점된 처리 수를 붙인다. core에 없는 카드는 그대로 */
export function withScores(trainees: Trainee[], items: AiScore[]): Trainee[] {
  const byKind = new Map(items.map((i) => [SCORE_KIND[i.kind], i]))
  return trainees.map((t) => {
    const s = byKind.get(t.kind)
    return s ? { ...t, right: s.right, total: s.total, live: s.live.total, pending: s.live.pending } : t
  })
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

/** 위 숫자: 처리한 신고 · AI가 준 경고(경고 수) · 철회된 경고 */
export function recordTotals(records: AiRecord[]): { judged: number; warned: number; withdrawn: number } {
  const ws = records.flatMap((r) => r.warnings)
  return {
    judged: records.length,
    warned: ws.length,
    withdrawn: ws.filter((w) => !!w.withdrawnAt).length,
  }
}

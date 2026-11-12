import type { AdminReport, Warning } from '../api/admin'

/**
 * AI 수습사원 (11/10 무인 운영, 11/12 지영 "AI가 다 알아서 처리하고 관리자는 어떻게 처리됐나만 본다,
 * 관리자가 할 수 있는 건 경고 철회뿐"). 사람이 [맞아요]를 누르는 결재함·레벨 단계는 뺐다.
 * 화면은 실제로 잰 정확도(성적표)와 core에 쌓인 처리 기록만 보여 준다
 */
export interface AiScore {
  kind: 'report' | 'withdraw'
  name: string
  right: number
  total: number
  /** 어떻게 쟀는지 한 줄 */
  note: string
}

/** 11/12 정확도 측정(core 점수판). 처음 보는 사례로 잰 값 */
export const AI_SCORES: AiScore[] = [
  { kind: 'report', name: '신고 판정', right: 89, total: 90, note: '처음 보는 사례 30개 × 3번 · 억울한 경고 0건' },
  { kind: 'withdraw', name: '경고 철회 판단', right: 109, total: 111, note: '사람이 쓴 철회 요청 37개 × 3번' },
]

/** 맞힌 비율, 소수 한 자리 (98.9% 처럼) */
export const rateOf = (s: Pick<AiScore, 'right' | 'total'>): number | null =>
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

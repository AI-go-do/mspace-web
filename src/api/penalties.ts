import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import { api } from './client'

/** GET /api/penalties/me (core #92). 로그인한 본인 것만 */
export interface MyPenalty {
  /** 위반 경고 수. core가 정지를 걸 때 세는 방식 그대로(최근 windowDays일 + 지난 정지 뒤의 경고만) */
  warnings: number
  /** 허위 신고 경고 수(신고 정지 기준) */
  falseReportWarnings: number
  /** 이 횟수가 되면 정지(설정값) */
  limit: number
  windowDays: number
  /** 이용 정지 중이면 끝나는 시각(경고·노쇼 정지 모두) */
  suspendedUntil: string | null
  /** 신고 정지 중이면 끝나는 시각 */
  reportSuspendedUntil: string | null
}

export function getMyPenalty(member?: number | null): Promise<MyPenalty> {
  return api<MyPenalty>('/api/penalties/me', { member })
}

/** "11월 21일 (토) 14:00" */
function until(iso: string): string {
  const d = new Date(iso)
  return `${dayLabel(seoulDate(d))} ${seoulClock(d)}`
}

/**
 * 이용 규칙 화면 위쪽 "내 경고 N회" 카드 글(FR-WEB-003).
 * 숫자(3회·30일)는 서버 설정값을 그대로 쓰고, 정지 중이면 끝나는 때를 먼저 알린다
 */
export function penaltySummary(p: MyPenalty): { title: string; lines: string[]; warn: boolean } {
  const lines: string[] = []
  if (p.suspendedUntil) lines.push(`${until(p.suspendedUntil)}까지 예약·참여가 정지돼 있어요.`)
  else lines.push(`최근 ${p.windowDays}일 안에 ${p.limit}회가 되면 정지돼요.`)
  if (p.reportSuspendedUntil) lines.push(`신고는 ${until(p.reportSuspendedUntil)}까지 할 수 없어요.`)
  else if (p.falseReportWarnings > 0) lines.push(`허위 신고 경고 ${p.falseReportWarnings}회`)
  const warn = p.suspendedUntil != null || p.reportSuspendedUntil != null || p.warnings >= Math.max(1, p.limit - 1)
  return { title: `내 경고 ${p.warnings}회`, lines, warn }
}

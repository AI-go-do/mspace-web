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

/** 본인 경고·정지 상태를 받는다. member는 공용 폰에서 회원이 바뀐 걸 알아채는 데 쓴다(client.ts) */
export function getMyPenalty(member?: number | null): Promise<MyPenalty> {
  return api<MyPenalty>('/api/penalties/me', { member })
}

/** "11월 21일 (토) 14:00". 서버가 읽을 수 없는 시각을 주면 null(화면이 깨지지 않게) */
function until(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${dayLabel(seoulDate(d))} ${seoulClock(d)}`
}

/**
 * 이용 규칙 화면 위쪽 "내 경고 N회" 카드 글(FR-WEB-003).
 * 숫자(3회·30일)는 서버 설정값을 그대로 쓰고, 정지 중이면 끝나는 때를 먼저 알린다
 */
export function penaltySummary(p: MyPenalty): { title: string; lines: string[]; warn: boolean } {
  const lines: string[] = []
  if (p.suspendedUntil) {
    const end = until(p.suspendedUntil)
    lines.push(end ? `${end}까지 예약·참여가 정지돼 있어요.` : '지금 예약·참여가 정지돼 있어요.')
  }
  // 정지 중에도 기준을 같이 보여 준다(아래 규칙 칸은 기본값만 적혀 있어서, 서버 설정이 다르면 여기서만 알 수 있다)
  lines.push(`최근 ${p.windowDays}일 안에 ${p.limit}회가 되면 정지돼요.`)
  if (p.reportSuspendedUntil) {
    const end = until(p.reportSuspendedUntil)
    lines.push(end ? `신고는 ${end}까지 할 수 없어요.` : '지금은 신고할 수 없어요.')
  } else if (p.falseReportWarnings > 0) lines.push(`허위 신고 경고 ${p.falseReportWarnings}회`)
  // 한 번만 더 받으면 정지되는 때부터 노랗게(기준이 1회면 0회부터)
  const warn = p.suspendedUntil != null || p.reportSuspendedUntil != null || p.warnings >= p.limit - 1
  return { title: `내 경고 ${p.warnings}회`, lines, warn }
}

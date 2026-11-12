import type { AdminReport, TidyCheckRow } from '../api/admin'
import { seenItemsSummary, TIDY_LABEL } from '../api/admin'
import { CATEGORIES } from '../api/reports'
import { seoulClock, seoulDate } from './time'

/**
 * "오디 판단" 탭 한 줄 (10차 회의·11/10: 관리자는 보기만, 판단은 AI).
 * core에 쌓인 실제 기록 두 가지를 한 줄로 모은다.
 * - 신고 판정: GET /api/reports. 판정기(규칙·Gemini, core #118)가 1분마다 정한 판정
 * - 방 카메라 정리 확인: GET /api/tidy-checks. 젯슨 카메라 모델 판단(core #110·#112)
 * 판정기의 확신도·근거는 core가 아직 목록에 안 준다(report_judgement 표에만 있음). 오면 그대로 보여 준다
 */
export interface JudgeRow {
  key: string
  at: string
  /** 그날이 오늘이 아니면 "11/11" 같은 날짜 */
  day: string | null
  time: string
  room: string
  /** 누가 판단했나. 판정기 기록이 없는 신고는 사람이 했는지 알 수 없어 null */
  by: '오디' | '방 카메라 AI' | null
  what: string
  verdict: string
  /** 0–100. 모르면 null */
  sure: number | null
  why: string | null
  /** off는 시연 예시의 장치 고장 */
  tone: 'warn' | 'ok' | 'wait' | 'off'
}

/** 신고 판정기 기록 (core가 붙이면). 없으면 빠진다 */
export interface ReportJudgement {
  judge: string
  confidence: number
  reasons: string
}

export type JudgedReport = AdminReport & { judgement?: ReportJudgement | null }

const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

function when(iso: string, now: Date): { day: string | null; time: string } {
  const d = new Date(iso)
  const day = seoulDate(d)
  return { day: day === seoulDate(now) ? null : `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`, time: seoulClock(d) }
}

const pct = (c: number | null | undefined) => (typeof c === 'number' && Number.isFinite(c) ? Math.round(Math.min(1, Math.max(0, c)) * 100) : null)

/** 신고 한 건 → 한 줄. 판정 전이면 "판정 중" */
export function reportRow(r: JudgedReport, roomName: (id: number) => string, now: Date): JudgeRow {
  const camera = r.reporterReservationId === null
  const what = `${categoryLabel(r.category)} 신고${camera ? ' (방 카메라)' : ''} #${r.id}`
  const at = r.judgedAt ?? r.createdAt
  const base = { key: `r${r.id}`, at, ...when(at, now), room: roomName(r.roomId),
    // 판정기 기록(judgement)이 있을 때만 오디로. 비상시 관리자가 직접 판정한 것과 섞이지 않게
    by: r.judgement ? ('오디' as const) : null, what,
    sure: pct(r.judgement?.confidence), why: r.judgement?.reasons?.trim() || null }
  switch (r.verdict) {
    case 'CONFIRMED':
      return { ...base, verdict: camera ? '사실 · 대표자 경고 1회' : '사실 · 앞 팀 대표자 경고 1회', tone: 'warn' }
    case 'FALSE':
      return { ...base, verdict: camera ? '허위 · 경고 없음' : '허위 · 신고자 경고 1회', tone: camera ? 'ok' : 'warn' }
    case 'UNVERIFIED':
      return { ...base, verdict: '확인 불가 · 벌칙 없음', tone: 'ok' }
    default:
      return { ...base, verdict: '판정 중', tone: 'wait' }
  }
}

/** 정리 확인 한 줄 → 한 줄 */
export function tidyRow(t: TidyCheckRow, now: Date): JudgeRow {
  const seen = seenItemsSummary(t.items)
  const left = t.result !== 'CLEAN' || t.leftItems.length > 0
  const recheck = t.phase === 'RECHECK'
  const report = t.reportId !== null ? ` · 신고 #${t.reportId}` : ''
  const verdict = recheck
    ? (left ? `3시간 뒤에도 남음${report}` : '치워짐')
    // 11/10 전 기록(NEEDS_CLEANING)은 알림이 아니라 바로 자동 신고였다
    : t.result === 'NEEDS_CLEANING' ? `${TIDY_LABEL.NEEDS_CLEANING}${report}`
    : left ? `${TIDY_LABEL.LEFT_ITEMS} · 대표자에게 알림` : TIDY_LABEL.CLEAN
  return {
    key: `t${t.reservationId}-${t.phase}`,
    at: t.observedAt,
    ...when(t.observedAt, now),
    room: t.roomName,
    by: '방 카메라 AI',
    what: `${recheck ? '다시 확인' : '퇴실 뒤 정리 확인'} · 예약 #${t.reservationId}`,
    verdict,
    sure: seen.top === null ? null : pct(seen.top),
    why: seen.text || null,
    tone: left ? 'warn' : 'ok',
  }
}

/**
 * 두 기록을 최근 순으로 전부 합친다(자르는 건 화면이). 소음 신고는 판정하지 않으니(보기만) 빼고,
 * 신고도 정리 확인과 같은 최근 days일만 남겨 맨 위 숫자가 같은 기간을 센다
 */
export function judgeRows(reports: JudgedReport[], tidy: TidyCheckRow[], roomName: (id: number) => string, now: Date, days = 7): JudgeRow[] {
  const from = now.getTime() - days * 24 * 60 * 60 * 1000
  const rows = [
    ...reports.filter((r) => r.category !== 'NOISE').map((r) => reportRow(r, roomName, now)).filter((r) => Date.parse(r.at) >= from),
    ...tidy.map((t) => tidyRow(t, now)),
  ]
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** 맨 위 숫자: 판정한 수, 그중 경고로 이어진 수, 판정 중 */
export function judgeCounts(rows: JudgeRow[]): { done: number; warned: number; waiting: number } {
  return {
    done: rows.filter((r) => r.tone !== 'wait').length,
    warned: rows.filter((r) => r.verdict.includes('경고 1회') || r.verdict.includes('· 신고 #')).length,
    waiting: rows.filter((r) => r.tone === 'wait').length,
  }
}

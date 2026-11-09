import { api, ApiError } from './client'
import type { ReportCategory, ReportVerdict } from './reports'

/**
 * 관리자 화면 API (FR-WEB-101, FR-RPT-103·104). 모두 관리자(users.role = ADMIN)만, 아니면 403 ADMIN_ONLY.
 * 증거 사진(core #76)·강제 퇴실(core #73)은 아직 열린 core PR의 계약대로 맞췄다
 */

/** GET /api/reports 한 줄 (관리자 목록) */
export interface AdminReport {
  id: number
  roomId: number
  category: ReportCategory
  content: string | null
  verdict: ReportVerdict
  /** 방 카메라 자동 신고(FR-DEV-105)면 null */
  reporterReservationId: number | null
  createdAt: string
  judgedAt: string | null
}

/** 신고 목록. 최근 신고가 위. verdict를 빼면 전부 */
export function getReports(verdict: ReportVerdict | null, signal?: AbortSignal, member?: number | null): Promise<AdminReport[]> {
  return api(`/api/reports${verdict ? `?verdict=${verdict}` : ''}`, { signal, member })
}

/** 판정. OPEN인 신고에 한 번만. 소음은 409 REPORT_NOT_JUDGEABLE, 이미 판정했으면 409 REPORT_ALREADY_JUDGED */
export function judgeReport(id: number, verdict: Exclude<ReportVerdict, 'OPEN'>, member?: number | null): Promise<AdminReport> {
  return api(`/api/reports/${id}/judge`, { method: 'POST', body: JSON.stringify({ verdict }), member })
}

export interface EvidencePhoto {
  kind: 'CHECK_IN' | 'CHECK_OUT'
  exists: boolean
  /** 예: /api/reservations/11/photos/CHECK_OUT (Bearer가 필요해 Blob으로 받는다) */
  url: string
  uploadedAt: string | null
}

/** GET /api/reports/{id}/evidence (core #76): 직전 이용 예약의 퇴실 사진과 신고자 예약의 입실 사진 */
export interface Evidence {
  reportId: number
  /** 그 방을 바로 전에 쓴 예약. 못 찾으면 null */
  previous: { reservationId: number; checkedInAt: string | null; checkedOutAt: string | null; photo: EvidencePhoto } | null
  /** 방 카메라 자동 신고(FR-DEV-105)면 신고자가 없어 null */
  reporter: { reservationId: number; photo: EvidencePhoto } | null
  /** 사진이 없는 이유 등 */
  note: string | null
}

/** 신고 하나의 증거(앞 사람 퇴실 사진·신고자 입실 사진). 관리자만 (core #76) */
export function getEvidence(reportId: number, signal?: AbortSignal, member?: number | null): Promise<Evidence> {
  return api(`/api/reports/${reportId}/evidence`, { signal, member })
}

/** 증거 사진 받기. 화면에는 object URL로 띄운다(부른 쪽이 다 쓰면 revoke) */
export function getPhotoBlob(url: string, signal?: AbortSignal, member?: number | null): Promise<Blob> {
  return api(url, { signal, member, as: 'blob', headers: { Accept: 'image/*' } })
}

/** 강제 퇴실 사유 최대 글자 수 (core ForceCheckoutService) */
export const MAX_FORCE_REASON = 200

/** 관리자 강제 퇴실 (core #73). 사용 중이 아니면 409 RESERVATION_NOT_IN_USE, 없는 예약 404 */
export function forceCheckout(reservationId: number, reason: string, member?: number | null): Promise<{ id: number; status: string }> {
  const r = reason.trim()
  return api(`/api/reservations/${reservationId}/force-checkout`, {
    method: 'POST', body: JSON.stringify(r ? { reason: r } : {}), member,
  })
}

/** 관리자 화면 오류를 읽을 문장으로 */
export function adminErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 시도해 주세요.'
  switch (e.code) {
    case 'ADMIN_ONLY': return '관리자만 할 수 있어요.'
    case 'REPORT_NOT_JUDGEABLE': return '소음 신고는 판정 대상이 아니에요.'
    case 'REPORT_ALREADY_JUDGED': return '이미 다른 관리자가 판정했어요. 목록을 새로 받을게요.'
    case 'REPORT_NOT_FOUND': return '찾을 수 없는 신고예요.'
    case 'RESERVATION_NOT_FOUND': return '찾을 수 없는 예약 번호예요.'
    default: return e.status === 404 && e.code === 'UNKNOWN' ? '서버에 아직 이 기능이 없어요(core 배포 확인 필요).' : e.message
  }
}

/** 판정 버튼 (OPEN 뺀 셋). 확인 창 문구에 벌칙을 같이 적는다 (core #70) */
export const JUDGE_OPTIONS: { verdict: Exclude<ReportVerdict, 'OPEN'>; label: string; confirm: string }[] = [
  { verdict: 'CONFIRMED', label: '사실', confirm: '사실로 판정할까요? 그 방을 바로 전에 쓴 대표자에게 경고 1회가 가요.' },
  { verdict: 'UNVERIFIED', label: '확인 불가', confirm: '확인 불가로 판정할까요? 벌칙 없이 신고자에게 알림만 가요.' },
  { verdict: 'FALSE', label: '허위', confirm: '허위로 판정할까요? 신고자에게 경고 1회가 가요.' },
]

/** 판정 확인 문구. 방 카메라 자동 신고(신고자 없음)면 신고자에게 가는 알림·경고가 없다고 바꿔 말한다 */
export function judgeConfirm(opt: (typeof JUDGE_OPTIONS)[number], noReporter: boolean): string {
  if (!noReporter) return opt.confirm
  if (opt.verdict === 'UNVERIFIED') return '확인 불가로 판정할까요? 방 카메라 신고라 신고자가 없어 알림은 가지 않아요.'
  if (opt.verdict === 'FALSE') return '허위로 판정할까요? 방 카메라 신고라 신고자가 없어 경고는 가지 않아요.'
  return opt.confirm
}

/** 사용 중인 예약인지(퇴실 시각이 없음). 증거의 직전 예약이 아직 방을 쓰고 있으면 강제 퇴실을 권한다 */
export function stillInRoom(previous: Evidence['previous']): boolean {
  return !!previous && !!previous.checkedInAt && !previous.checkedOutAt
}

// ---- 경고·정지 목록 (core #75) ----

export interface PenaltyMember {
  id: number
  studentId: string
  name: string
}

/** 경고. reason: VIOLATION(사실 판정, 이용한 방) · FALSE_REPORT(허위 신고) */
export interface Warning {
  id: number
  member: PenaltyMember
  reason: 'VIOLATION' | 'FALSE_REPORT' | (string & {})
  reportId: number
  reservationId: number | null
  createdAt: string
}

/** 정지. scope: USE(예약·참여) · REPORT(신고만). reason: NO_SHOW · WARNINGS · FALSE_REPORT */
export interface Suspension {
  scope: 'USE' | 'REPORT' | (string & {})
  id: number
  member: PenaltyMember
  reason: 'NO_SHOW' | 'WARNINGS' | 'FALSE_REPORT' | (string & {})
  startsAt: string
  endsAt: string
  active: boolean
}

export interface Penalties {
  days: number
  warnings: Warning[]
  suspensions: Suspension[]
}

/** 최근 days일(1–365, 기본 30) 경고와 그 사이 끝났거나 진행 중인 정지. 관리자 화면이라 학번·이름이 그대로 온다 */
export function getPenalties(days: number, signal?: AbortSignal, member?: number | null): Promise<Penalties> {
  return api(`/api/penalties?days=${days}`, { signal, member })
}

export const WARNING_REASON: Record<string, string> = { VIOLATION: '이용 위반', FALSE_REPORT: '허위 신고' }
export const SUSPENSION_REASON: Record<string, string> = { NO_SHOW: '노쇼 누적', WARNINGS: '위반 경고 누적', FALSE_REPORT: '허위 신고 누적' }
export const SUSPENSION_SCOPE: Record<string, string> = { USE: '예약·참여 정지', REPORT: '신고 정지' }

// ---- 이용 통계 (core #74, #45) ----

export interface Usage {
  /** 전체(total)면 null */
  roomId: number | null
  roomName: string | null
  reservations: { total: number; canceled: number; pending: number; noShow: number; used: number; forced: number; awayReleased: number; autoCheckedOut: number }
  /** 0–1. 분모가 0이면 null */
  rates: { noShow: number | null; actualUse: number | null; utilization: number | null }
  minutes: { booked: number; used: number; avgUsed: number | null }
  shortUses: number
  uniqueUsers: number
  sensor: {
    co2Readings: number; co2AvgPpm: number | null; co2MaxPpm: number | null; co2OverRate: number | null; thresholdPpm: number
    ventilationAlerts: number; occupiedMinutes: number; occupiedWithoutReservationMinutes: number
  }
  /** 알림 효과 (core #93). 그 전 core(시연 서버 main 11-06 판)는 이 값을 안 줘서 선택 */
  alerts?: UsageAlerts
}

/**
 * 알림이 실제로 도움이 됐는지 (core #93, FR-NTF-104·FR-DEV-104).
 * 노쇼 직전 알림을 받은 예약 중 결과가 난 것 → 그중 입실, 환기 알림 중 확인 시간이 지난 것 → 그중 CO2가 기준 아래로.
 * 비율은 0–1, 분모가 0이면 null
 */
export interface UsageAlerts {
  noShowWarned: number
  noShowCheckedIn: number
  noShowCheckedInRate: number | null
  ventilationChecked: number
  ventilationResolved: number
  ventilationResolvedRate: number | null
  resolvedWithinMinutes: number
}

/** "알림 12건 중 9건 (75%)". 알림이 없었으면 "아직 없어요" */
export function alertEffectLabel(hit: number, total: number, rate: number | null): string {
  if (total <= 0) return '아직 없어요'
  return `${total}건 중 ${hit}건 (${pct(rate)})`
}

/** GET /api/stats/usage. 날짜는 서울 기준, to 포함, 최대 92일 */
export interface UsageStats {
  from: string
  to: string
  days: number
  total: Usage
  rooms: Usage[]
  byHour: { hour: number; reservations: number; used: number }[]
}

/** 기간(from~to, YYYY-MM-DD) 이용 통계. 관리자만 (core #74) */
export function getUsageStats(from: string, to: string, signal?: AbortSignal, member?: number | null): Promise<UsageStats> {
  return api(`/api/stats/usage?from=${from}&to=${to}`, { signal, member })
}

/** GET /api/reservations/stats: 예약을 만든 곳(WEB/AGENT) 건수 (core #45) */
export interface SourceCounts { from: string; to: string; total: number; web: number; agent: number }

/** 기간 안 예약을 만든 곳별 건수. 관리자만 (core #45) */
export function getSourceCounts(from: string, to: string, signal?: AbortSignal, member?: number | null): Promise<SourceCounts> {
  return api(`/api/reservations/stats?from=${from}&to=${to}`, { signal, member })
}

/** 0–1 비율 → "42%". 모르면(null) "—" */
export function pct(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`
}

/** 서울 날짜 문자열(YYYY-MM-DD)에서 n일 전 */
export function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

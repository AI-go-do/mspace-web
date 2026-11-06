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
  reporterReservationId: number
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
  reporter: { reservationId: number; photo: EvidencePhoto }
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

/** 사용 중인 예약인지(퇴실 시각이 없음). 증거의 직전 예약이 아직 방을 쓰고 있으면 강제 퇴실을 권한다 */
export function stillInRoom(previous: Evidence['previous']): boolean {
  return !!previous && !!previous.checkedInAt && !previous.checkedOutAt
}

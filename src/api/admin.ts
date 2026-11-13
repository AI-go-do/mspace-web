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

/** 방 카메라(젯슨) 정리 확인 결과 (FR-DEV-105, core #110). 사진은 남기지 않고 결과·물건 이름만 */
export interface TidyResult {
  /** CLEAN 깨끗함 · LEFT_ITEMS 물건 남음(11/10부터, core #112) · NEEDS_CLEANING 치워야 함(11/10 전 기록) */
  result: 'CLEAN' | 'LEFT_ITEMS' | 'NEEDS_CLEANING' | (string & {})
  /** 본 물건 이름 전부(모델 이름 그대로) */
  items: string[]
  /** 두고 간 귀중품: BAG·PHONE·EARBUDS·LAPTOP */
  leftItems: string[]
  observedAt: string
}

export const TIDY_LABEL: Record<string, string> = { CLEAN: '깨끗함', LEFT_ITEMS: '두고 간 물품', NEEDS_CLEANING: '치워야 함' }
export const LEFT_ITEM_LABEL: Record<string, string> = { BAG: '가방', PHONE: '휴대폰', EARBUDS: '이어폰', LAPTOP: '노트북' }

/** "깨끗함" / "치워야 함 · 두고 간 것: 가방·노트북" */
export function tidySummary(t: Pick<TidyResult, 'result' | 'leftItems'>): string {
  const head = TIDY_LABEL[t.result] ?? t.result
  const left = t.leftItems.map((x) => LEFT_ITEM_LABEL[x] ?? x)
  return left.length ? `${head} · 두고 간 것: ${left.join('·')}` : head
}

/** GET /api/reports/{id}/evidence (core #76): 직전 이용 예약의 퇴실 사진과 신고자 예약의 입실 사진 */
export interface Evidence {
  reportId: number
  /**
   * 그 방을 바로 전에 쓴 예약. 못 찾으면 null.
   * tidyCheck는 그 예약 뒤 카메라 정리 확인 결과(core #110, 없으면 null. 옛 core는 필드 자체가 없다)
   */
  previous: {
    reservationId: number; checkedInAt: string | null; checkedOutAt: string | null; photo: EvidencePhoto
    tidyCheck?: TidyResult | null
  } | null
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
    case 'WARNING_ALREADY_WITHDRAWN': return '이미 철회된 경고예요.'
    case 'WARNING_NOT_FOUND': return '찾을 수 없는 경고예요.'
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
  /** 철회된 시각 (core #123, AI 판단기·관리자 철회 모두). 살아 있는 경고면 null, 예전 core는 칸이 없다 */
  withdrawnAt?: string | null
}

/** 관리자 경고 철회 이유 최대 글자 (core #123) */
export const MAX_WITHDRAW_REASON = 200

export interface WarningWithdrawn {
  warningId: number
  userId: number
  withdrawnAt: string
  /** 이 경고로 걸린 정지를 풀었으면 true */
  suspensionLifted: boolean
  /** 대기 중이던 학생 철회 요청을 철회로 닫았으면 true */
  appealClosed: boolean
}

/**
 * 관리자 경고 철회 (core #123). 정지도 풀고 학생에게 이유와 함께 알린다.
 * 이유 1–200자 필수, 이미 철회됐으면 409 WARNING_ALREADY_WITHDRAWN
 */
export function withdrawWarning(warningId: number, reason: string, member?: number | null): Promise<WarningWithdrawn> {
  return api(`/api/admin/warnings/${warningId}/withdraw`, {
    method: 'POST', body: JSON.stringify({ reason: reason.trim() }), member,
  })
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

// ---- 카메라 정리 확인 목록 (core #110) ----

/** 카메라가 본 물건 하나. name은 모델 영어 이름 그대로, confidence는 0–1(11/10 전 기록은 null) */
export interface SeenItem { name: string; confidence: number | null }

/**
 * GET /api/tidy-checks 한 줄. 예약 하나에 퇴실 직후(FIRST)·3시간 뒤 다시 확인(RECHECK)이 따로 한 줄씩(core #112).
 * 새 기록의 leftItems는 늘 빈 배열이고, 남은 물건은 items에 확신도와 같이 온다
 */
export interface TidyCheckRow extends Omit<TidyResult, 'items'> {
  phase: TidyPhase
  items: SeenItem[]
  reservationId: number
  roomId: number
  roomName: string
  endedAt: string | null
  /** 다시 확인에도 물건이 남아 core가 만든 어질러짐 신고 번호(대표자 경고). 11/10 전 기록은 치워야 함 자동 신고 */
  reportId: number | null
  /**
   * 입실 전 사진 (core #125): 방 카메라 입실 직전(ENTRY), 없으면 학생 입실 사진. 둘 다 없으면 null.
   * core가 아직 안 주면 칸이 빠진다(그때는 같은 방 앞 줄의 퇴실 사진으로 대신)
   */
  before?: TidyPhoto | null
  /** 이 단계 사진: 방 카메라(퇴실 직후·3시간 뒤), 퇴실 직후인데 카메라가 못 찍었으면 학생 퇴실 사진. 둘 다 없으면 null */
  after?: TidyPhoto | null
  /**
   * (core #130) 두고 간 물건을 찾으러 10분 QR로 들어온 시각. 이 뒤 젯슨이 방이 비면 바로 다시 찍어(RECHECK) 가져갔는지 본다.
   * core가 아직 안 주면 빠진다
   */
  retrievedAt?: string | null
}

/** 정리 확인 줄의 사진 하나. url은 로그인 토큰이 필요해 Blob으로 받는다(AuthPhoto). source STUDENT = 카메라 대신 학생이 올린 사진 */
export interface TidyPhoto {
  source: 'CAMERA' | 'STUDENT' | (string & {})
  takenAt: string | null
  url: string
}

/** 최근 days일(1–92) 정리 확인 결과, 최근 순. 관리자만(학생 403 ADMIN_ONLY) */
export function getTidyChecks(days: number, signal?: AbortSignal, member?: number | null): Promise<TidyCheckRow[]> {
  return api<{ items: TidyCheckRow[] }>(`/api/tidy-checks?days=${Math.min(92, Math.max(1, days))}`, { signal, member }).then((r) => r.items)
}

/** 정리 확인 단계: FIRST 퇴실 직후 · RECHECK 두고 간 물건 다시 확인 */
export type TidyPhase = 'FIRST' | 'RECHECK'

/** 정리 확인 사진 단계: 정리 확인 단계 + ENTRY 입실 직전 빈 방 (core #119, Q-27) */
export type TidyPhotoPhase = TidyPhase | 'ENTRY'

/** 방 카메라가 올린 빈 방 사진 (core #115). 대표자·참여자·관리자만, 없으면 404 PHOTO_NOT_FOUND. Bearer가 필요해 Blob으로 받는다 */
export function tidyPhotoUrl(reservationId: number, phase: TidyPhotoPhase): string {
  return `/api/reservations/${reservationId}/tidy-photos/${phase}`
}

/** 정리 확인 숫자(퇴실 직후 줄 기준): 물건 남음 · 깨끗함, 그리고 3시간 뒤에도 남아 경고로 이어진 수 */
export function tidyCounts(rows: Pick<TidyCheckRow, 'phase' | 'result' | 'leftItems' | 'reportId'>[]): { left: number; clean: number; warned: number } {
  const first = rows.filter((r) => r.phase !== 'RECHECK')
  return {
    left: first.filter((r) => r.result !== 'CLEAN' || r.leftItems.length > 0).length,
    clean: first.filter((r) => r.result === 'CLEAN' && r.leftItems.length === 0).length,
    warned: rows.filter((r) => r.phase === 'RECHECK' && r.reportId !== null).length,
  }
}

/** 카메라 모델(80종) 영어 이름 → 화면 이름. 없는 이름은 그대로 */
export const SEEN_ITEM_LABEL: Record<string, string> = {
  cup: '컵', bottle: '병', backpack: '가방', handbag: '가방', suitcase: '가방', laptop: '노트북', 'cell phone': '휴대폰',
  umbrella: '우산', book: '책', keyboard: '키보드', mouse: '마우스', 'wine glass': '잔', bowl: '그릇', unknown: '모르는 물건',
}

/** AI 판단 한 줄용: 같은 물건은 묶어 "컵 3개 · 가방"처럼, 확신도는 가장 높은 값 하나만 따로 */
export function seenItemsSummary(items: SeenItem[]): { text: string; top: number | null } {
  const counts = new Map<string, number>()
  for (const i of items) {
    const name = SEEN_ITEM_LABEL[i.name] ?? i.name
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const text = [...counts].map(([n, c]) => (c > 1 ? `${n} ${c}개` : n)).join(' · ')
  const known = items.map((i) => i.confidence).filter((c): c is number => c !== null)
  return { text, top: known.length ? Math.max(...known) : null }
}

/** 물품마다 모델 확신도(%) 높은 순. 확신도 없는 물품은 뺀다. 화면엔 물건 이름 대신 "두고 간 물품"이라 숫자만 쓴다 */
export function itemPercents(items: SeenItem[]): number[] {
  return items
    .map((i) => i.confidence)
    .filter((c): c is number => c !== null)
    .map((c) => Math.round(c * 100))
    .sort((a, b) => b - a)
}

/** 남은 물건 글: "umbrella 93% · cup" (확신도 높은 순) */
export function seenItemsLabel(items: SeenItem[]): string {
  return [...items]
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
    .map((i) => (i.confidence === null ? i.name : `${i.name} ${Math.round(i.confidence * 100)}%`))
    .join(' · ')
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

// ---- 하루 운영 요약 (core #122) ----

/** 하루 숫자. 이름·학번 없음. 신고·경고·철회·고장은 그날(서울) 생긴 것만 */
export interface DailyFacts {
  /** 오늘이라 하루가 아직 안 끝났나 */
  partial: boolean
  total: Usage
  rooms: Usage[]
  /** 신고 종류 → 판정(OPEN·CONFIRMED·UNVERIFIED·FALSE) → 건수 */
  reports: Record<string, Record<string, number>>
  /** 그중 판정기가 정한 건수 */
  autoJudged: number
  /** 경고 이유(VIOLATION·FALSE_REPORT) → 건수 */
  warnings: Record<string, number>
  /** 그날 정해진 철회 요청 결과(WITHDRAWN·KEPT·PENDING) → 건수 */
  appeals: Record<string, number>
  /** 장치 고장 종류 → 건수 */
  deviceFaults: Record<string, number>
  /** AI 자동 처리 종류(OpsActionKind) → 건수 (core #142). 예전 core는 칸이 없다 */
  aiActions?: Record<string, number>
}

/** GET /api/admin/daily-report 응답. lines = AI가 쓴 3–5줄, writer = gemini:모델 · template · template:fallback */
export interface DailyReport {
  date: string
  lines: string[]
  writer: string
  generatedAt: string
  facts: DailyFacts
}

/** 하루 운영 요약 (관리자만, 미래 날짜 400). date(YYYY-MM-DD, 서울)를 빼면 오늘 */
export function getDailyReport(date: string | null, signal?: AbortSignal, member?: number | null): Promise<DailyReport> {
  return api(`/api/admin/daily-report${date ? `?date=${encodeURIComponent(date)}` : ''}`, { signal, member })
}

/** 맵 값 합 (없으면 0) */
export const sumOf = (m: Record<string, number> | undefined): number => Object.values(m ?? {}).reduce((a, b) => a + b, 0)

/** 신고 맵(종류 → 판정 → 건수)의 전체 건수와 판정별 합 */
export function reportTotals(m: Record<string, Record<string, number>> | undefined): { total: number; byVerdict: Record<string, number> } {
  const byVerdict: Record<string, number> = {}
  for (const v of Object.values(m ?? {})) for (const [k, n] of Object.entries(v)) byVerdict[k] = (byVerdict[k] ?? 0) + n
  return { total: sumOf(byVerdict), byVerdict }
}

/** 누가 썼나 → 화면 글 */
export function writerLabel(writer: string): string {
  if (writer.startsWith('gemini')) return 'Gemini'
  if (writer === 'template:fallback') return '정해진 틀 (AI 실패)'
  return '정해진 틀'
}

// ---- AI 자동 처리 기록 (core #140) ----

export type OpsActionKind = 'VENT_SOON' | 'ROOM_HOT' | 'SENSOR_DOWN' | 'OVERTIME' | 'UNBOOKED' | (string & {})

/** 자동 처리 이름 (core #140과 같은 말) */
export const OPS_KIND_LABEL: Record<string, string> = {
  VENT_SOON: '미리 환기', ROOM_HOT: '예약 전 더움', SENSOR_DOWN: '센서 고장', OVERTIME: '시간 넘김', UNBOOKED: '예약 없는 사용',
}

/** AI가 센서를 보고 혼자 처리한 일 한 줄. 관리자용 2종(센서 고장·예약 없는 사용)은 예약이 없고 notified 0 */
export interface OpsAction {
  id: number
  kind: OpsActionKind
  roomId: number
  roomName: string
  reservationId: number | null
  startedAt: string
  detectedAt: string
  /** 근거 한 줄 (예: "CO2 910ppm, 최근 5분 790→910ppm") */
  detail: string
  /** 알림을 보낸 사람 수 */
  notified: number
}

/** 그날 자동 처리 기록, 최근 것부터 (관리자만). date(YYYY-MM-DD, 서울)를 빼면 오늘 */
export function getOpsActions(date: string | null, signal?: AbortSignal, member?: number | null): Promise<OpsAction[]> {
  return api(`/api/admin/ops-actions${date ? `?date=${encodeURIComponent(date)}` : ''}`, { signal, member })
}

/** AI 수습사원 카드 점수 한 줄 (core #149). right/total = 측정값(base) + 실제 처리 채점(live) */
export interface AiScore {
  kind: string
  right: number
  total: number
  base: { right: number; total: number }
  /** pending = 결과를 아직 볼 수 없는 실제 처리 수 */
  live: { right: number; total: number; pending: number }
}

/** 카드 점수. core #149 전이면 404 → 화면은 측정값 그대로 */
export function getAiScores(signal?: AbortSignal, member?: number | null): Promise<{ at: string; items: AiScore[] }> {
  return api('/api/admin/ai-scores', { signal, member })
}

/** "미리 환기 2 · 시간 넘김 1" (건수 많은 것부터, 0은 뺌) */
export function opsSummary(m: Record<string, number> | undefined): string {
  return Object.entries(m ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${OPS_KIND_LABEL[k] ?? k} ${n}`).join(' · ')
}

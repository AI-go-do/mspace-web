import { api, ApiError } from './client'

/** 신고 종류 (FR-RPT-101, core ReportCategory) */
export type ReportCategory = 'BROKEN' | 'WINDOW_OPEN' | 'MESSY' | 'NOISE'

/** 관리자 판정 (FR-RPT-103). 신고하면 OPEN(대기)으로 시작한다 */
export type ReportVerdict = 'OPEN' | 'CONFIRMED' | 'UNVERIFIED' | 'FALSE'

/** 신고 종류 이름과 설명. 화면 버튼 순서도 이 순서 */
export const CATEGORIES: { value: ReportCategory; label: string; hint: string }[] = [
  { value: 'BROKEN', label: '비품 고장', hint: '책상·의자·전등·모니터 등이 망가졌어요' },
  { value: 'WINDOW_OPEN', label: '창문 열림', hint: '들어와 보니 창문이 열려 있었어요' },
  { value: 'MESSY', label: '어질러짐', hint: '앞 사람이 치우지 않고 나갔어요 (입실하고 5분 안)' },
  { value: 'NOISE', label: '소음', hint: '옆 방이 계속 시끄러워요' },
]

/** 판정 이름 */
export const VERDICT_LABEL: Record<ReportVerdict, string> = {
  OPEN: '확인 기다림',
  CONFIRMED: '사실',
  UNVERIFIED: '확인 불가',
  FALSE: '허위',
}

/** 메모 최대 글자 수 (core SubmitReportService) */
export const MAX_REPORT_CONTENT = 500

export interface NewReport {
  roomId: number
  category: ReportCategory
  content?: string
  /** 소음일 때 "정말 소란인가요?" 확인 */
  noiseConfirmed?: boolean
}

/** POST /api/reports 응답 */
export interface SubmittedReport {
  id: number
  roomId: number
  category: ReportCategory
  verdict: ReportVerdict
  createdAt: string
}

/**
 * 신고 보내기 (FR-RPT-101). 지금 그 방이나 옆 방을 쓰는 예약자만 보낼 수 있다(아니면 403 REPORT_NOT_ALLOWED).
 * 허위 신고 경고가 쌓이면 403 REPORT_SUSPENDED (core #70)
 */
export function submitReport(report: NewReport, member?: number | null): Promise<SubmittedReport> {
  return api('/api/reports', { method: 'POST', body: JSON.stringify(report), member })
}

/**
 * 어질러짐(MESSY) 신고 조건 (core #96): 지금 쓰는 내 방만, 입실 뒤 5분 안(core 설정값), 그 예약에 입실 사진이 있어야.
 * 5분은 core 설정이라 화면은 안내만 하고 막지 않는다. 지나면 core가 409 REPORT_MESSY_TOO_LATE
 */
export const MESSY_RULE = '어질러짐은 입실하고 5분 안에, 입실 사진을 먼저 올린 뒤 지금 쓰는 방만 신고할 수 있어요.'

/**
 * 보내기 전에 화면에서 막을 것. 없으면 null.
 * 어질러짐의 "지금 쓰는 방만"은 화면이 아는 방이 오래됐을 수 있어 막지 않고 core가 판단한다(403 REPORT_MESSY_OWN_ROOM_ONLY)
 */
export function reportProblem(r: { roomId: number | null; category: ReportCategory | null; content: string; noiseConfirmed: boolean; ownRoom?: number | null }): string | null {
  if (r.roomId === null) return '신고할 방을 골라 주세요'
  if (r.category === null) return '무엇이 문제인지 골라 주세요'
  if (r.category === 'NOISE' && r.ownRoom != null && r.roomId === r.ownRoom) return '소음은 옆 방만 신고할 수 있어요. 소리가 나는 방을 골라 주세요'
  if (r.content.trim().length > MAX_REPORT_CONTENT) return `메모는 ${MAX_REPORT_CONTENT}자 이내로 적어 주세요`
  if (r.category === 'NOISE' && !r.noiseConfirmed) return '"정말 소란인가요?"를 체크해 주세요'
  return null
}

/**
 * 내 방의 옆 방. core V8 room_adjacency(1–2, 2–3, 3–4, 4–5, docs Q-05)와 같다.
 * 소음은 옆 방만 신고한다(core 400 REPORT_NOISE_NEIGHBOR_ONLY, 11/13): 내 방은 우리 팀만 쓴다
 */
export function isNeighborRoom(own: number, room: number): boolean {
  return Math.abs(own - room) === 1
}

/** 입실 사진을 올리러 다녀와도 고른 종류·메모가 남게 (같은 예약일 때만 되살림) */
export interface ReportDraft {
  reservationId: number
  roomId: number | null
  category: ReportCategory | null
  content: string
}

const DRAFT_KEY = 'mspace.reportDraft.v1'
type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 탭 저장소. 막힌 환경(사생활 보호 창 등)이면 null */
function sessionStore(): DraftStore | null {
  try { return globalThis.sessionStorage ?? null } catch { return null }
}

/** 이 예약의 신고 초안. 없거나 다른 예약 것이면 null */
export function loadReportDraft(reservationId: number | null, store: DraftStore | null = sessionStore()): ReportDraft | null {
  if (reservationId === null || !store) return null
  try {
    const d = JSON.parse(store.getItem(DRAFT_KEY) ?? 'null') as ReportDraft | null
    if (!d || d.reservationId !== reservationId) return null
    const category = CATEGORIES.some((c) => c.value === d.category) ? d.category : null
    return { reservationId, roomId: typeof d.roomId === 'number' ? d.roomId : null, category, content: typeof d.content === 'string' ? d.content : '' }
  } catch {
    return null
  }
}

/** 신고 초안 저장. 저장 못 해도 신고 흐름은 막지 않는다 */
export function saveReportDraft(d: ReportDraft, store: DraftStore | null = sessionStore()): void {
  try { store?.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* 저장 못 해도 신고는 그대로 */ }
}

/** 신고를 보낸 뒤 초안 지우기 */
export function clearReportDraft(store: DraftStore | null = sessionStore()): void {
  try { store?.removeItem(DRAFT_KEY) } catch { /* 무시 */ }
}

/** 신고 오류를 학생이 읽을 문장으로 */
export function reportErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 보내 주세요.'
  switch (e.code) {
    case 'REPORT_NOT_ALLOWED': return '지금 그 방이나 옆 방을 사용 중일 때만 신고할 수 있어요.'
    case 'REPORT_SUSPENDED': return '허위 신고 경고가 쌓여 지금은 신고할 수 없어요. 정지가 끝나면 다시 할 수 있어요.'
    case 'REPORT_NOISE_NOT_CONFIRMED': return '소음 신고는 "정말 소란인가요?"를 체크해야 보낼 수 있어요.'
    case 'REPORT_NOISE_NEIGHBOR_ONLY': return '소음은 옆 방만 신고할 수 있어요. 소리가 나는 방을 골라 주세요.'
    // 어질러짐 조건 (core #96)
    case 'REPORT_MESSY_OWN_ROOM_ONLY': return '어질러짐은 지금 쓰는 방만 신고할 수 있어요. 옆 방은 다른 종류로 신고해 주세요.'
    case 'REPORT_MESSY_TOO_LATE': return '어질러짐은 입실하고 바로(5분 안)만 신고할 수 있어요. 연장한 예약은 앞 팀이 같은 팀이라 신고할 수 없어요.'
    case 'REPORT_CHECKIN_PHOTO_REQUIRED': return '어질러짐을 신고하려면 입실 사진을 먼저 올려 주세요.'
    default: return e.message
  }
}

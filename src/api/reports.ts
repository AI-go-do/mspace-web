import { api, ApiError } from './client'

/** 신고 종류 (FR-RPT-101, core ReportCategory) */
export type ReportCategory = 'BROKEN' | 'WINDOW_OPEN' | 'MESSY' | 'NOISE'

/** 관리자 판정 (FR-RPT-103). 신고하면 OPEN(대기)으로 시작한다 */
export type ReportVerdict = 'OPEN' | 'CONFIRMED' | 'UNVERIFIED' | 'FALSE'

/** 신고 종류 이름과 설명. 화면 버튼 순서도 이 순서 */
export const CATEGORIES: { value: ReportCategory; label: string; hint: string }[] = [
  { value: 'BROKEN', label: '비품 고장', hint: '책상·의자·전등·모니터 등이 망가졌어요' },
  { value: 'WINDOW_OPEN', label: '창문 열림', hint: '들어와 보니 창문이 열려 있었어요' },
  { value: 'MESSY', label: '어질러짐', hint: '앞 사람이 치우지 않고 나갔어요' },
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

/** 보내기 전에 화면에서 막을 것. 없으면 null */
export function reportProblem(r: { roomId: number | null; category: ReportCategory | null; content: string; noiseConfirmed: boolean }): string | null {
  if (r.roomId === null) return '신고할 방을 골라 주세요'
  if (r.category === null) return '무엇이 문제인지 골라 주세요'
  if (r.content.trim().length > MAX_REPORT_CONTENT) return `메모는 ${MAX_REPORT_CONTENT}자 이내로 적어 주세요`
  if (r.category === 'NOISE' && !r.noiseConfirmed) return '"정말 소란인가요?"를 체크해 주세요'
  return null
}

/** 신고 오류를 학생이 읽을 문장으로 */
export function reportErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 보내 주세요.'
  switch (e.code) {
    case 'REPORT_NOT_ALLOWED': return '지금 그 방이나 옆 방을 사용 중일 때만 신고할 수 있어요.'
    case 'REPORT_SUSPENDED': return '허위 신고 경고가 쌓여 지금은 신고할 수 없어요. 정지가 끝나면 다시 할 수 있어요.'
    case 'REPORT_NOISE_NOT_CONFIRMED': return '소음 신고는 "정말 소란인가요?"를 체크해야 보낼 수 있어요.'
    default: return e.message
  }
}

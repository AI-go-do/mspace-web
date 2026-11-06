import { api, ApiError } from './client'

/**
 * 내 시간표 (FR-AGT-102). 비서의 my_schedule 도구가 "수업 끝나고"를 알아듣는 근거.
 * 화면 → agent /api/agent/schedule. 모양은 mspace-assistant docs/도구-명세.md 2.5
 */

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const
export type Day = (typeof DAYS)[number]
export const DAY_LABEL: Record<Day, string> = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' }

export interface ScheduleClass {
  dayOfWeek: Day
  /** HH:mm */
  startTime: string
  endTime: string
  name: string
}

export interface Schedule {
  classes: ScheduleClass[]
  updatedAt: string
}

/** 캡처 읽기 결과. 저장하지 않은 초안이라 학생이 확인하고 [저장]을 눌러야 들어간다 */
export interface ScheduleDraft {
  classes: ScheduleClass[]
  /** 읽었지만 틀려서 버린 줄 수 */
  dropped: number
  note: string | null
}

/** 서버 검사와 같은 한도 */
export const MAX_CLASSES = 40
export const MAX_NAME = 30

/** 아직 안 넣었으면(404 NO_SCHEDULE) 오류가 아니라 null */
export async function getSchedule(member?: number | null): Promise<Schedule | null> {
  try {
    return await api<Schedule>('/api/agent/schedule', { member })
  } catch (e) {
    if (e instanceof ApiError && e.code === 'NO_SCHEDULE') return null
    throw e
  }
}

/** 통째로 바꾼다 */
export function saveSchedule(classes: ScheduleClass[], member?: number | null): Promise<Schedule> {
  return api('/api/agent/schedule', { method: 'PUT', body: JSON.stringify({ classes }), member })
}

export function deleteSchedule(member?: number | null): Promise<void> {
  return api('/api/agent/schedule', { method: 'DELETE', member })
}

export function parseScheduleImage(image: Blob, member?: number | null): Promise<ScheduleDraft> {
  const form = new FormData()
  form.append('image', image, 'timetable.jpg')
  return api('/api/agent/schedule/parse', { method: 'POST', body: form, member })
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface ScheduleProblem {
  /** 문제가 있는 줄(목록 전체 문제면 null) */
  index: number | null
  message: string
}

/** 서버 검사(INVALID_REQUEST·SCHEDULE_OVERLAP)와 같은 규칙. 첫 문제 하나를 돌려준다 */
export function checkSchedule(classes: ScheduleClass[]): ScheduleProblem | null {
  if (classes.length === 0) return { index: null, message: '수업을 하나 이상 넣어 주세요.' }
  if (classes.length > MAX_CLASSES) return { index: null, message: `수업은 ${MAX_CLASSES}개까지 넣을 수 있어요.` }
  for (const [i, c] of classes.entries()) {
    const name = c.name.trim()
    if (!name) return { index: i, message: '과목명을 적어 주세요.' }
    if (name.length > MAX_NAME) return { index: i, message: `과목명은 ${MAX_NAME}자까지예요.` }
    if (!DAYS.includes(c.dayOfWeek)) return { index: i, message: '요일을 골라 주세요.' }
    if (!TIME.test(c.startTime) || !TIME.test(c.endTime)) return { index: i, message: '시작·끝 시각을 넣어 주세요.' }
    if (c.startTime >= c.endTime) return { index: i, message: '끝 시각이 시작보다 늦어야 해요.' }
  }
  for (const [i, a] of classes.entries()) {
    const j = classes.findIndex((b, k) => k < i && b.dayOfWeek === a.dayOfWeek && b.startTime < a.endTime && a.startTime < b.endTime)
    if (j >= 0) return { index: i, message: `${DAY_LABEL[a.dayOfWeek]}요일 '${classes[j].name.trim()}'와 시간이 겹쳐요.` }
  }
  return null
}

/** 요일 → 시작 순 */
export function sortClasses(classes: ScheduleClass[]): ScheduleClass[] {
  return [...classes].sort((a, b) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

/** 서버 오류를 학생이 읽을 문장으로 */
export function scheduleErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 시도해 주세요.'
  // 학교 앞단 nginx는 1MB 넘는 본문을 HTML 413으로 막는다(코드 없음)
  if (e.status === 413) return '사진이 너무 커요. 시간표 부분만 잘라서 다시 올려 주세요.'
  switch (e.code) {
    case 'INVALID_REQUEST': return '맞지 않는 칸이 있어요. 요일·시각·과목명을 확인해 주세요.'
    case 'SCHEDULE_OVERLAP': return '같은 요일에 시간이 겹치는 수업이 있어요.'
    case 'SCHEDULE_UNAVAILABLE':
    case 'TOOLS_UNAVAILABLE': return '시간표 저장소에 잠시 닿지 못했어요. 잠시 후 다시 시도해 주세요.'
    case 'INVALID_IMAGE': return '사진을 읽지 못했어요. PNG·JPG·WebP 사진으로 다시 올려 주세요.'
    case 'LLM_RATE_LIMITED': return '오늘 사진 읽기 한도를 다 썼어요. 직접 입력하거나 내일 다시 해 주세요.'
    case 'LLM_UNAVAILABLE': return 'AI가 잠시 사진을 못 읽어요. 잠시 후 다시 하거나 직접 입력해 주세요.'
    case 'LLM_NOT_CONFIGURED': return '지금은 사진 읽기를 쓸 수 없어요. 직접 입력해 주세요.'
    default: return e.message
  }
}

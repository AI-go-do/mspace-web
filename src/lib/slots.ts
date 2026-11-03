/** 30분 칸 고르기 (FR-WEB-001). 화면과 떼어 테스트한다 */

/** 한 번에 최대 2시간 = 4칸 (FR-RSV-001) */
export const MAX_SLOTS = 4

export interface Pick {
  start: number
  len: number
}

/**
 * 칸 i를 눌렀을 때 새 선택.
 * - 아무것도 안 골랐으면 i부터 1칸
 * - 고른 시작보다 뒤이고 4칸 안이며 사이가 모두 비어 있으면 끝을 i까지 늘리거나 줄인다
 * - 1칸만 고른 상태에서 그 칸을 다시 누르면 선택을 지운다
 * - 그 밖에는 i부터 새로 1칸
 * @param free 칸마다 고를 수 있는지(지난 칸·예약된 칸은 false)
 */
export function tapSlot(pick: Pick | null, i: number, free: boolean[]): Pick | null {
  if (!free[i]) return pick
  if (!pick) return { start: i, len: 1 }
  if (i === pick.start) return pick.len === 1 ? null : { start: i, len: 1 }
  const len = i - pick.start + 1
  if (i > pick.start && len <= MAX_SLOTS && free.slice(pick.start, i + 1).every(Boolean)) {
    return { start: pick.start, len }
  }
  return { start: i, len: 1 }
}

/** "YYYY-MM-DD"에 n일을 더한다(달력 날짜만 다룬다) */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 오늘부터 7일 날짜 칩 (FR-WEB-001) */
export function weekChips(today: string): { date: string; weekday: string; day: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i)
    const [y, m, d] = date.split('-').map(Number)
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    return { date, weekday: i === 0 ? '오늘' : wd, day: d }
  })
}

/** "2026-11-05" → "11월 5일 (목)" */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** 칸 수 → "1시간 30분" */
export function lengthLabel(len: number): string {
  const h = Math.floor(len / 2)
  const half = len % 2 === 1
  if (h === 0) return '30분'
  return half ? `${h}시간 30분` : `${h}시간`
}

/** 하루 중 칸 번호 → "HH:MM" (48은 24:00) */
export function slotClock(i: number): string {
  return `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`
}

import { dayLabel } from './slots'
import { seoulClock, seoulDate } from './time'

/** "오늘 11월 3일 (화)" / "11월 5일 (목)" */
export function whenLabel(iso: string, now = new Date()): string {
  const d = seoulDate(new Date(iso))
  return `${d === seoulDate(now) ? '오늘 ' : ''}${dayLabel(d)}`
}

/** "19:00–21:00" */
export function timeRange(startAt: string, endAt: string): string {
  return `${seoulClock(new Date(startAt))}–${seoulClock(new Date(endAt))}`
}

/** 분 → "1시간 12분" / "48분" */
export function minutesLabel(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}분`
  return r ? `${h}시간 ${r}분` : `${h}시간`
}

/** 남은 시간을 1초 단위로 (예: 1시간 23분 05초, 4분 09초). 0보다 작으면 0초 */
export function remainLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  if (h > 0) return `${h}시간 ${m}분 ${sec}초`
  if (m > 0) return `${m}분 ${sec}초`
  return `${total % 60}초`
}

/** 연장하기를 누를 수 있는 때: 끝나기 10분 전부터 끝나기 전까지 (FR-RSV-105) */
export function canContinueAt(endAt: string, now: number): boolean {
  const end = Date.parse(endAt)
  return now >= end - 10 * 60_000 && now < end
}

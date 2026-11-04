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

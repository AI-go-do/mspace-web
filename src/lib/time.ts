import type { Slot } from '../api/rooms'

export interface Segment {
  /** 하루 시작부터 몇 시간째인지(0–24) */
  from: number
  to: number
}

const HOUR = 3_600_000

/** 서울 날짜 YYYY-MM-DD */
export function seoulDate(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d)
}

/** 서울 시각 HH:MM */
export function seoulClock(d = new Date()): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

/** 초까지 (취소 마감처럼 분 안에서 끝나는 시각용). 예: 10:05:50 */
export function seoulClockSec(d = new Date()): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d)
}

/**
 * 30분 칸 목록 → 예약된 구간 막대.
 * 서버의 available=false는 '예약됨'과 '지난 칸'을 함께 뜻해서, 지금 이후 칸만 예약으로 본다.
 * (지난 예약까지 그리려면 core가 칸마다 이유를 내려 줘야 함)
 */
export function takenSegments(slots: Slot[], now = new Date()): Segment[] {
  if (slots.length === 0) return []
  const day0 = Date.parse(slots[0].startAt)
  const segs: Segment[] = []
  for (const s of slots) {
    const start = Date.parse(s.startAt)
    if (s.available || start < now.getTime()) continue
    const from = (start - day0) / HOUR
    const to = (Date.parse(s.endAt) - day0) / HOUR
    const last = segs[segs.length - 1]
    if (last && last.to === from) last.to = to
    else segs.push({ from, to })
  }
  return segs
}

/**
 * 지금 비어 있는지. core가 occupiedNow를 주면 그대로 따른다.
 * 없으면(예전 core·예시 데이터) 지금 칸은 지난 칸이라 알 수 없으니 들어갈 수 있는 첫 칸으로 짐작한다
 */
export function isFreeNow(slots: Slot[], now = new Date(), occupiedNow?: boolean): boolean {
  if (occupiedNow !== undefined) return !occupiedNow
  const next = slots.find((s) => Date.parse(s.startAt) >= now.getTime())
  return next?.available ?? false
}

/** 하루 중 지금 위치(0–100%). 다른 날이면 null */
export function nowPercent(slots: Slot[], now = new Date()): number | null {
  if (slots.length === 0) return null
  const day0 = Date.parse(slots[0].startAt)
  const p = ((now.getTime() - day0) / (24 * HOUR)) * 100
  return p >= 0 && p <= 100 ? p : null
}

/** 지금 상태 한 줄: "21:30까지 비어 있어요" / "20:00에 비어요" (배치도 화면) */
export function nowState(slots: Slot[], now = new Date(), occupiedNow?: boolean): { free: boolean; text: string } {
  const t = now.getTime()
  const ahead = slots.filter((s) => Date.parse(s.startAt) >= t)
  const free = isFreeNow(slots, now, occupiedNow)
  const change = ahead.find((s) => s.available !== free)
  const at = change ? seoulClock(new Date(change.startAt)) : null
  if (free) return { free, text: at ? `${at}까지 빔` : '오늘 계속 빔' }
  return { free, text: at ? `사용 중 · ${at}까지` : '오늘 마감' }
}

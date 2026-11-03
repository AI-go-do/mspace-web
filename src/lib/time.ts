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

/** 지금 들어갈 수 있는 첫 칸이 비어 있는지 */
export function isFreeNow(slots: Slot[], now = new Date()): boolean {
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

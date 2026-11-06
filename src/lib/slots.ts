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
 * @param startable 이 번호보다 앞 칸만 시작으로 고를 수 있다. 뒤 칸(다음 날 이어 붙인 칸)은 끝으로만 쓴다
 */
export function tapSlot(pick: Pick | null, i: number, free: boolean[], startable = free.length): Pick | null {
  if (!free[i]) return pick
  const fresh = i < startable ? { start: i, len: 1 } : pick
  if (!pick) return fresh
  if (i === pick.start) return pick.len === 1 ? null : { start: i, len: 1 }
  const len = i - pick.start + 1
  if (i > pick.start && len <= MAX_SLOTS && free.slice(pick.start, i + 1).every(Boolean)) {
    return { start: pick.start, len }
  }
  return fresh
}

/** 하루 칸 수(30분 × 48) */
export const DAY_SLOTS = 48

/**
 * 자정 넘김 (FR-RSV-001: 시작만 7일 안이면 끝은 다음 날도 된다). 고른 시작에서 2시간 안에 자정이 있으면
 * 이어 붙일 다음 날 칸 수. 예: 23:00 시작 → 2칸(00:00·00:30, 끝 01:00), 23:30 → 3칸(끝 01:30)
 */
export function nextDayReach(start: number | null): number {
  if (start === null) return 0
  return Math.max(0, start + MAX_SLOTS - DAY_SLOTS)
}

/**
 * 다음 날 앞쪽 칸을 비어 있다고 만든다. 마지막(7일째) 날은 다음 날 시간표를 조회할 수 없어 쓴다.
 * 그 칸에 걸칠 수 있는 예약은 7일째 늦게 시작한 것뿐이라, 7일째 칸이 이미 막아 준다(서버가 다시 확인한다)
 * @param nextDate 다음 날 "YYYY-MM-DD"
 */
export function freeNextDaySlots(nextDate: string, n = MAX_SLOTS - 1): { startAt: string; endAt: string; available: boolean }[] {
  return Array.from({ length: n }, (_, k) => ({
    startAt: `${nextDate}T${slotClock(k)}:00+09:00`,
    endAt: `${nextDate}T${slotClock(k + 1)}:00+09:00`,
    available: true,
  }))
}

/** 칸 번호 → 시계. 하루를 넘긴 번호는 "다음 날 01:00"처럼 (48 = 24:00은 그대로) */
export function slotClockAcross(i: number): string {
  return i > DAY_SLOTS ? `다음 날 ${slotClock(i - DAY_SLOTS)}` : slotClock(i)
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

/**
 * 지금부터 비어 있는 동안의 끝: 지금 뒤로 처음 나오는 예약된 칸의 시작(ISO). 오늘 안에 없으면 null.
 * 2시간 제한은 고르는 끝 시각에만 쓰고 여기서는 쓰지 않는다
 */
export function nextTakenAt(slots: { startAt: string; available: boolean }[], now: Date): string | null {
  const t = now.getTime()
  return slots.find((s) => Date.parse(s.startAt) >= t && !s.available)?.startAt ?? null
}

/** 지금 바로 쓰기의 끝 시각 후보 (FR-WEB-102) */
export interface EndChoice {
  /** ISO 시각 */
  endAt: string
  /** 다음 예약 전·2시간 안이라 고를 수 있는지 */
  ok: boolean
}

/**
 * 지금 바로 쓰기 끝 시각 칩: 지금 다음 30분 경계부터 (지금 + 2시간)을 30분으로 올린 시각까지.
 * 중간에 예약된 칸이 나오면 그 뒤로는 고를 수 없다(core ReservationTime.instant와 같은 규칙).
 * @param slots 오늘 30분 칸 48개(서버 availability)
 */
export function instantEnds(slots: { startAt: string; endAt: string; available: boolean }[], now: Date, maxMinutes = 120): EndChoice[] {
  const half = 30 * 60_000
  const t = now.getTime()
  const latest = Math.ceil((t + maxMinutes * 60_000) / half) * half
  const out: EndChoice[] = []
  let blocked = false
  for (const s of slots) {
    const start = Date.parse(s.startAt)
    const end = Date.parse(s.endAt)
    if (end <= t || end > latest) continue
    // 지금 들어 있는 칸은 서버가 '지남'으로 보내므로, 그 칸은 비어 있다고 보고 끝까지 쓸 수 있게 한다
    if (start >= t && !s.available) blocked = true
    out.push({ endAt: s.endAt, ok: !blocked })
  }
  return out
}

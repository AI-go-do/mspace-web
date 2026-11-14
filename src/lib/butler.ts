import type { MyReservation } from '../api/reservations'
import type { RoomSlots } from '../api/rooms'
import { seoulDay, type Schedule, type ScheduleClass } from '../api/schedule'
import { deadlineOf } from '../pages/AccessCode'
import { canContinueAt } from './format'
import { MAX_SLOTS } from './slots'
import { isFreeNow, seoulDate } from './time'

/**
 * 홈 맨 위 "비서가 먼저" 카드 (11/6 재웅: 혁신은 주인→비서가 빠지고 비서→주인이 먼저 움직이는 것).
 * 학생이 아무것도 누르지 않아도, 이미 받아 둔 내 예약·방 현황·시간표만 보고 지금 할 일을 하나 골라 먼저 말을 건다.
 * core를 바꾸지 않고 화면이 가진 자료로만 정한다. 우선순위는 급한 순: 연장 → 입실 → 지켜보던 방이 빔 → 수업 끝 제안 → 시간표 권유
 */
export type Suggestion =
  /** 사용 중인 내 예약이 10분 안에 끝난다(대표자). 연장은 끝나기 전에만 되므로 가장 급하다 */
  | { kind: 'extend'; r: MyReservation }
  /** 내 예약의 입실 시간이다(대표자, 시작 10분 전 ~ 입실 마감). QR을 바로 꺼낸다 */
  | { kind: 'checkin'; r: MyReservation; deadline: Date }
  /** 지켜보던(눈 표시) 방이 지금 비었다. 바로 쓰기로 간다 */
  | { kind: 'roomFree'; roomId: number }
  /** 오늘 마지막 수업이 끝나는 시각부터 가장 오래 비는 방 */
  | { kind: 'afterClass'; className: string; endTime: string; roomId: number; date: string; start: number; len: number; startAt: string; endAt: string }
  /** 시간표가 아직 없다(서버가 NO_SCHEDULE). 넣으면 수업 끝 제안을 받을 수 있다고 알린다 */
  | { kind: 'noSchedule' }

const SLOT_MS = 30 * 60_000
// 요일 계산은 시간표 쪽 한 곳에 둔다(마이 탭과 같은 함수). 테스트·다른 곳이 쓰던 이름은 그대로 내보낸다
export { seoulDay }

/** 오늘 수업 중 가장 늦게 끝나는 것. 아직 안 끝난 것만(끝났으면 null: 그때는 "지금 바로 쓰기"가 맡는다) */
export function lastClassToday(classes: ScheduleClass[], now: Date): { c: ScheduleClass; endAt: Date } | null {
  const day = seoulDay(now)
  const today = seoulDate(now)
  let best: { c: ScheduleClass; endAt: Date } | null = null
  for (const c of classes) {
    if (c.dayOfWeek !== day) continue
    const endAt = new Date(`${today}T${c.endTime}:00+09:00`)
    if (!best || endAt > best.endAt) best = { c, endAt }
  }
  return best && best.endAt.getTime() > now.getTime() ? best : null
}

/**
 * 어느 시각부터 가장 오래(최대 2시간) 비는 방. 시각은 다음 30분 칸 경계로 올린다.
 * 같은 길이면 번호가 작은 방(1번 방이 입구에서 가깝다). 그 시각에 빈 방이 없으면 null
 */
export function longestFreeFrom(rooms: RoomSlots[], at: Date): { roomId: number; start: number; len: number; startAt: string; endAt: string } | null {
  let best: { roomId: number; start: number; len: number; startAt: string; endAt: string } | null = null
  for (const room of [...rooms].sort((a, b) => a.roomId - b.roomId)) {
    if (room.slots.length === 0) continue
    const day0 = Date.parse(room.slots[0].startAt)
    const start = Math.ceil((at.getTime() - day0) / SLOT_MS)
    if (start < 0 || start >= room.slots.length) continue
    let len = 0
    while (len < MAX_SLOTS && start + len < room.slots.length && room.slots[start + len].available) len++
    if (len > 0 && (!best || len > best.len)) {
      best = { roomId: room.roomId, start, len, startAt: room.slots[start].startAt, endAt: room.slots[start + len - 1].endAt }
    }
  }
  return best
}

export interface ButlerInput {
  mine: MyReservation[]
  rooms: RoomSlots[]
  /** undefined: 아직 못 받음(또는 비서 서버가 꺼짐) → 시간표 제안은 건너뛴다. null: 아직 안 넣음 */
  schedule: Schedule | null | undefined
  /** 지켜보기(눈 표시)를 켜 둔 방 번호. 없으면 빈 배열 */
  watched?: number[]
}

/** 지금 먼저 말할 한 가지. 없으면 null(카드를 숨긴다) */
export function butlerSuggestion({ mine, rooms, schedule, watched = [] }: ButlerInput, now: Date): Suggestion | null {
  const t = now.getTime()
  const extend = mine.find((r) => r.owner && r.status === 'IN_USE' && !r.continued && canContinueAt(r.endAt, t))
  if (extend) return { kind: 'extend', r: extend }

  const checkin = mine.find((r) => {
    if (!r.owner || r.status !== 'BOOKED') return false
    const from = Date.parse(r.startAt) - 10 * 60_000
    return t >= from && t <= deadlineOf(r).getTime()
  })
  if (checkin) return { kind: 'checkin', r: checkin, deadline: deadlineOf(checkin) }

  // 지켜보던 방 중 지금 비어 있는 것(지금 상태를 아는 방만). 여러 개면 번호가 작은 방
  const freeWatched = [...watched].sort((a, b) => a - b).find((id) => {
    const room = rooms.find((r) => r.roomId === id)
    return !!room && room.occupiedNow !== undefined && isFreeNow(room.slots, now, room.occupiedNow)
  })
  if (freeWatched !== undefined) return { kind: 'roomFree', roomId: freeWatched }

  if (schedule === undefined) return null
  if (schedule === null) return { kind: 'noSchedule' }
  const last = lastClassToday(schedule.classes, now)
  if (!last) return null
  const free = longestFreeFrom(rooms, last.endAt)
  if (!free) return null
  return { kind: 'afterClass', className: last.c.name, endTime: last.c.endTime, date: seoulDate(now), ...free }
}

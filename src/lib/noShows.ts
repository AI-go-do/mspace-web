import type { MyReservation } from '../api/reservations'

/** 노쇼 정지 기준 (예약 규칙 v2: 30일 안에 2회면 14일 정지). core가 노쇼 API를 주면 그 값으로 바꾼다 */
export const NO_SHOW_RULES = { windowDays: 30, limit: 2, suspendDays: 14 }

/**
 * 내 예약에서 노쇼 기록만 (11/12 지영 "내 경고 기록에 노쇼 기록도 보이게").
 * 벌칙은 대표자에게만 가니 내가 대표자인 예약만, 최근 windowDays일(시작 기준), 최근 것부터.
 * core에 노쇼 목록 API가 아직 없어 내 예약(GET /api/reservations/me)으로 대신한다.
 * 그래서 장치 고장으로 무른 노쇼도 여기엔 그대로 보인다
 */
export function myNoShows(list: MyReservation[], now: Date, rules = NO_SHOW_RULES): MyReservation[] {
  const since = now.getTime() - rules.windowDays * 86_400_000
  return list
    .filter((r) => r.status === 'NO_SHOW' && r.owner && Date.parse(r.startAt) >= since)
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
}

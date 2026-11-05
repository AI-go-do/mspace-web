import { api } from './client'

/** 예약 상태 (요구사항 4장) */
export type ReservationStatus =
  | 'BOOKED' | 'IN_USE' | 'CHECKED_OUT' | 'AUTO_CHECKED_OUT' | 'AWAY_RELEASED' | 'CANCELED' | 'NO_SHOW'

/** POST /api/reservations 응답 (core CreateReservationResponse) */
export interface CreatedReservation {
  id: number
  roomId: number
  startAt: string
  endAt: string
  status: ReservationStatus
  headcount: number
  /** 키패드 6자리. 대표자에게만 */
  accessCode: string
}

export interface NewReservation {
  roomId: number
  startAt: string
  endAt: string
  /** 대표자 본인은 빼고 적는다 */
  participantStudentIds: string[]
}

/**
 * 미리 예약 (FR-RSV-001). idempotencyKey가 같으면 다시 보내도 예약이 두 번 생기지 않는다
 * (빠르게 두 번 누르거나 응답을 못 받고 다시 보낼 때).
 */
export function createReservation(body: NewReservation, idempotencyKey: string): Promise<CreatedReservation> {
  return api('/api/reservations', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

/** 지금 바로 쓰기 = 즉시 시작 (FR-RSV-103). 시작은 서버 시계, 끝은 30분 칸. 10분 안에 입실해야 한다 */
export function startNow(
  body: { roomId: number; endAt: string; participantStudentIds: string[] },
  idempotencyKey: string,
): Promise<CreatedReservation> {
  return api('/api/reservations/instant', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

/** GET /api/reservations/me 한 건 (core MyReservationResponse) */
export interface MyReservation {
  id: number
  room: { id: number; name: string }
  startAt: string
  endAt: string
  status: ReservationStatus
  /** 내가 대표자인지 */
  owner: boolean
  /** 키패드 번호. 대표자일 때만 값이 있다 */
  accessCode: string | null
  /** 입실 마감 (core #54, DB 값 그대로). 예전 core에는 없어서 선택 값 → 없으면 화면이 계산 */
  checkinDeadline?: string
  /** 이름은 가려서 온다(김*영) */
  participants: { name: string; owner: boolean }[]
}

/** 내 예약 (FR-RSV-006). 끝나지 않은 것이 위(시작 빠른 순), 끝난 것은 최근 순 */
export function getMyReservations(signal?: AbortSignal): Promise<MyReservation[]> {
  return api('/api/reservations/me', { signal })
}

/** 끝나지 않은 예약(예약됨·사용 중)인지 */
export function isActive(status: ReservationStatus): boolean {
  return status === 'BOOKED' || status === 'IN_USE'
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  BOOKED: '예약됨',
  IN_USE: '사용 중',
  CHECKED_OUT: '퇴실',
  AUTO_CHECKED_OUT: '시간 끝나 퇴실',
  AWAY_RELEASED: '자리 비움으로 퇴실',
  CANCELED: '취소됨',
  NO_SHOW: '노쇼로 풀림',
}

/** 시작 전 취소 (FR-RSV-007). 대표자만, 시작 전 BOOKED만 */
export function cancelReservation(id: number): Promise<{ id: number; status: ReservationStatus }> {
  return api(`/api/reservations/${id}/cancel`, { method: 'POST' })
}

/** 퇴실 (FR-RSV-008). 대표자만, 입실한(IN_USE) 예약만. 방이 바로 빈다 */
export function checkoutReservation(id: number): Promise<{ id: number; status: ReservationStatus }> {
  return api(`/api/reservations/${id}/checkout`, { method: 'POST' })
}

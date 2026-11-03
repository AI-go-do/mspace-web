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

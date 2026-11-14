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
  /** 빈방 릴레이로 넘겨받은 칸이면 그 번호(Q-18 제안, core #94). core가 잡아 둔 칸을 이 사람만 예약하게 */
  relayOfferId?: number
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

/**
 * 연장하기 (FR-RSV-105, core #51). 대표자, 사용 중, 끝나기 10분 전부터 끝나기 전까지, 30분 단위 최대 2시간, 1회.
 * core는 지금 예약을 퇴실하고 지금부터 endAt까지 새 예약(새 번호, 바로 사용 중)을 만든다.
 * idempotencyKey가 같으면 다시 보내도 두 번 연장되지 않는다
 */
export function continueReservation(id: number, endAt: string, idempotencyKey: string): Promise<CreatedReservation> {
  return api(`/api/reservations/${id}/continue`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ endAt }),
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
  /**
   * 이 시각 전까지 대표자가 취소할 수 있다 (core #84). 미리 예약은 시작, 지금 바로 쓰기는 누른 뒤 5분(설정값).
   * 예전 core에는 없어서 선택 값 → 없으면 시작 시각
   */
  cancelableUntil?: string
  /** 이름은 가려서 온다(김*영) */
  participants: { name: string; owner: boolean }[]
  /**
   * 문 앞 웹캠이 읽는 입실 QR 글자 (core #71, 예: MSPACE:1:123456). 번호가 없으면(참여자·끝난 예약) null.
   * 예전 core에는 없어서 선택 값 → 없으면 QR 없이 번호만 보여 준다
   */
  qrText?: string | null
  /** 실제 입실 시각 (core #134). 입실 전·노쇼·취소는 null, 예전 core에는 없다 */
  checkedInAt?: string | null
  /** 실제 퇴실 시각 (core #134). 퇴실 버튼·시간 끝나 자동·자리 비움 모두. 아직 안 나갔으면 null */
  checkedOutAt?: string | null
  /** 연장으로 생긴 예약인지 (core fix/me-continued). 연장은 1회라 true면 연장 버튼을 숨긴다. 예전 core에는 없다 */
  continued?: boolean
}

/**
 * 내 예약 (FR-RSV-006). 끝나지 않은 것이 위(시작 빠른 순), 끝난 것은 최근 순.
 * member를 주면 그 회원 토큰으로만 보낸다(다른 탭에서 다른 학생이 로그인하면 SESSION_CHANGED)
 */
export function getMyReservations(signal?: AbortSignal, member?: number): Promise<MyReservation[]> {
  return api('/api/reservations/me', { signal, member })
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
  NO_SHOW: '노쇼됨',
}

/** 취소 마감: 서버 값(cancelableUntil)이 있으면 그것, 없으면 시작 시각 */
export function cancelDeadline(r: Pick<MyReservation, 'startAt' | 'cancelableUntil'>): Date {
  return new Date(r.cancelableUntil ?? r.startAt)
}

/** 대표자이고 BOOKED이고 취소 마감 전이면 취소 버튼을 보인다 (FR-RSV-007, 즉시 시작은 누른 뒤 5분) */
export function canCancel(r: Pick<MyReservation, 'owner' | 'status' | 'startAt' | 'cancelableUntil'>, now: number): boolean {
  return r.owner && r.status === 'BOOKED' && now < cancelDeadline(r).getTime()
}

/** 시작 전 취소 (FR-RSV-007). 대표자만, BOOKED이고 취소 마감(cancelableUntil) 전만 */
export function cancelReservation(id: number): Promise<{ id: number; status: ReservationStatus }> {
  return api(`/api/reservations/${id}/cancel`, { method: 'POST' })
}

/**
 * "아직 있어요" (FR-DEV-103). 대표자만, 사용 중(IN_USE)만, 예약당 1번. 자리 비움 시간을 지금부터 다시 잰다.
 * 409 STILL_HERE_ALREADY_USED(이미 씀)·RESERVATION_NOT_IN_USE, 404 STILL_HERE_DISABLED(서버 설정으로 꺼 둠)
 */
export function stillHere(id: number): Promise<{ id: number; status: ReservationStatus }> {
  // 응답이 오지 않으면 15초 뒤 끊어 버튼이 '보내는 중'에 머물지 않게 한다(다시 누를 수 있는 오류로)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STILL_HERE_TIMEOUT_MS)
  return api<{ id: number; status: ReservationStatus }>(`/api/reservations/${id}/still-here`, { method: 'POST', signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

const STILL_HERE_TIMEOUT_MS = 15_000

/** 퇴실 (FR-RSV-008). 대표자만, 입실한(IN_USE) 예약만. 방이 바로 빈다 */
export function checkoutReservation(id: number): Promise<{ id: number; status: ReservationStatus }> {
  return api(`/api/reservations/${id}/checkout`, { method: 'POST' })
}

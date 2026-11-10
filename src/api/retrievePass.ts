import { demoOn } from '../lib/demo'
import { api } from './client'
import type { AppNotification } from './notifications'

/**
 * 두고 간 물건 "찾으러 갈게요" 10분 QR (FR-DEV-105, core #114, 11/10 지영 결정).
 * 퇴실 직후 확인에서 물건이 남았다는 알림(LEFT_ITEM)을 받은 대표자·참여자가 퇴실 3시간 안에 받는다.
 * 10분 안에 다시 누르면 같은 QR, 지나면 새 번호. 다음 팀이 쓰고 있어도 준다.
 */
export const LEFT_ITEM_KIND = 'LEFT_ITEM'

export interface RetrievePass {
  reservationId: number
  roomId: number
  code: string
  qrText: string
  expiresAt: string
}

/** POST /api/reservations/{id}/retrieve-pass. 거절: 404 RESERVATION_NOT_FOUND, 409 RESERVATION_NOT_ENDED·RETRIEVE_NOT_NEEDED·RETRIEVE_TOO_LATE */
export function getRetrievePass(reservationId: number): Promise<RetrievePass> {
  if (reservationId === DEMO_RESERVATION) return Promise.resolve(demoPass())
  return api<RetrievePass>(`/api/reservations/${reservationId}/retrieve-pass`, { method: 'POST' })
}

/** 남은 분 (올림, 0 아래로 안 감) */
export function minutesLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))
}

// ---- 예시 데이터 (주소에 ?demo=1일 때만) ----

const DEMO_ID = -201
const DEMO_RESERVATION = -51
let demoExpires = 0
let demoRead = false
const demoAt = Date.now() - 40 * 60_000

export const isLeftItemDemoId = (id: number) => id === DEMO_ID
/** 예시 알림 읽음. 이 탭에서만 */
export function readLeftItemDemo(): void { demoRead = true }

function demoPass(): RetrievePass {
  if (Date.now() >= demoExpires) demoExpires = Date.now() + 10 * 60_000
  return { reservationId: DEMO_RESERVATION, roomId: 3, code: '000000', qrText: 'MSPACE:3:000000', expiresAt: new Date(demoExpires).toISOString() }
}

/** 예시 알림 하나: 40분 전 퇴실한 창작실 3에 물건이 남음 */
export function demoLeftItemAlerts(): AppNotification[] {
  if (!demoOn()) return []
  return [{
    id: DEMO_ID, reservationId: DEMO_RESERVATION, kind: LEFT_ITEM_KIND, read: demoRead,
    createdAt: new Date(demoAt).toISOString(),
    title: '두고 간 물건이 있어요',
    body: '창작실 3에 물건 1개(가방)가 남아 있어요. 퇴실 3시간 안에 가져가지 않으면 대표자에게 경고가 남아요.',
  }]
}

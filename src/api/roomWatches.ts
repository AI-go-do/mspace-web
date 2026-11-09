import { demoOn } from '../lib/demo'
import { api } from './client'

/**
 * 빈방 알림 (core #109, core docs/결정.md 24번). 사용 중인 방에 "비면 알려 줘요"를 켜 두면
 * 예약이 끝나 방이 빌 때 core 1분 정리가 알림함으로 한 번 알린다(ROOM_FREE). 켠 날(서울) 하루만.
 * 앱을 닫아 둬도 알림함·바깥 채널로 오는 것이 이 화면만으로 하던 지켜보기와 다른 점이다
 *
 * GET  /api/room-watches/me             오늘 켜 둔 방 (아직 알리지 않은 것만) [{ roomId, since }]
 * POST /api/room-watches { roomId }     켜기. 이미 켜져 있어도 200 / 409 ROOM_WATCH_FREE 지금 비어 있음
 * POST /api/room-watches/{roomId}/cancel 끄기. 켜져 있지 않아도 204
 *
 * 빌드 때 VITE_ROOM_WATCH_SOURCE=api면 core를 쓴다(개발 서버만). 아니면 지금처럼 이 폰에만 둔다. ?demo=1은 늘 이 폰에만
 */
export interface RoomWatch {
  roomId: number
  since: string
}

const BUILD_API = import.meta.env.VITE_ROOM_WATCH_SOURCE === 'api'
let apiOverride: boolean | null = null

/** 켜고 끄기를 core에도 보낼지 */
export const watchApiOn = () => !demoOn() && (apiOverride ?? BUILD_API)

/** 테스트에서 빌드 값을 바꾼다. null이면 빌드 값으로 */
export function _setWatchApiForTest(on: boolean | null): void {
  apiOverride = on
}

/** 지금 비어 있어 켤 수 없음. 화면은 비서 카드가 바로 "비었어요"라고 하니 실패로 보지 않는다 */
export const WATCH_FREE = 'ROOM_WATCH_FREE'

/** 오늘 켜 둔 방(아직 알리지 않은 것만) */
export function getMyWatches(member: number, signal?: AbortSignal): Promise<RoomWatch[]> {
  return api('/api/room-watches/me', { member, signal })
}

/** 켜기. 이미 켜져 있어도 성공 */
export function watchRoom(member: number, roomId: number): Promise<RoomWatch> {
  return api('/api/room-watches', { method: 'POST', member, body: JSON.stringify({ roomId }) })
}

/** 끄기. 켜져 있지 않아도 성공 */
export function unwatchRoom(member: number, roomId: number): Promise<void> {
  return api(`/api/room-watches/${roomId}/cancel`, { method: 'POST', member })
}

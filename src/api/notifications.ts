import { api } from './client'

/**
 * 알림 종류. 서버가 새 종류를 보내도 화면이 깨지지 않게 string도 받는다
 * START_SOON 입실 10분 전 · END_SOON 종료 10분 전 · NO_SHOW_SOON 노쇼 직전 · AWAY_SOON 자리 비움 (FR-NTF-101·102·104, FR-DEV-103)
 * REPORT_RESULT 신고 판정 결과 · WARNING 경고 (FR-RPT-104, core #70) · FORCED_CHECKOUT 관리자 퇴실 처리 (core #73)
 */
export type NotificationKind = 'START_SOON' | 'END_SOON' | 'NO_SHOW_SOON' | 'AWAY_SOON'
  | 'REPORT_RESULT' | 'WARNING' | 'FORCED_CHECKOUT' | (string & {})

/** GET /api/notifications/me 한 줄 (core NotificationController, 최근 50개) */
export interface AppNotification {
  id: number
  reservationId: number | null
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
}

/** 내 알림함 (FR-NTF-103) */
export function getMyNotifications(signal?: AbortSignal, member?: number | null): Promise<AppNotification[]> {
  // member를 주면 다른 탭에서 다른 회원으로 바뀐 토큰으로는 보내지 않는다(남의 알림을 받지 않게)
  return api('/api/notifications/me', { signal, member })
}

/** 안 읽은 알림 개수 (홈 종 버튼 점, core #69). 예: {"count":3} */
export function getUnreadCount(signal?: AbortSignal, member?: number | null): Promise<{ count: number }> {
  return api('/api/notifications/me/unread-count', { signal, member })
}

/** 알림 하나 읽음 (core #69). 이미 읽었어도 204. 없거나 남의 알림이면 404 NOTIFICATION_NOT_FOUND */
export function markNotificationRead(id: number, member?: number | null): Promise<void> {
  return api(`/api/notifications/${id}/read`, { method: 'POST', member })
}

/** 내 알림 모두 읽음 (core #69). 이번에 읽음으로 바뀐 개수를 돌려준다 */
export function markAllNotificationsRead(member?: number | null): Promise<{ count: number }> {
  return api('/api/notifications/read-all', { method: 'POST', member })
}

/** 읽음 상태가 바뀌었다고 홈 종 버튼에 알리는 브라우저 이벤트 이름 */
export const UNREAD_CHANGED = 'mspace:unread-changed'

/** 알림함에서 읽음으로 바꾼 뒤 부른다. 종 버튼 점이 다음 조회(1분)를 기다리지 않고 바로 다시 센다 */
export function announceUnreadChanged(): void {
  window.dispatchEvent(new Event(UNREAD_CHANGED))
}

/** 목록에서 읽음으로 표시한 모양. id가 null이면 전부. 서버 응답을 기다리지 않고 화면을 먼저 바꿀 때 쓴다 */
export function withRead(list: AppNotification[], id: number | null): AppNotification[] {
  return list.map((n) => (n.read || (id !== null && n.id !== id) ? n : { ...n, read: true }))
}

/** 알림에서 바로 갈 곳. 예약과 상관없거나 갈 곳이 없으면 null */
export function notificationAction(n: AppNotification): { to: string; label: string } | null {
  if (n.reservationId == null) return null
  switch (n.kind) {
    case 'START_SOON':
    case 'NO_SHOW_SOON':
      return { to: `/reservations/${n.reservationId}`, label: '입실 번호 보기' }
    case 'AWAY_SOON':
      return { to: `/me/${n.reservationId}/checkout`, label: '퇴실할게요' }
    // 끝나기 10분 전: 연장 버튼은 사용 중 카드(마이 탭 맨 위)에 있다
    case 'END_SOON':
      return { to: '/me', label: '연장하기' }
    case 'FORCED_CHECKOUT':
      return { to: `/me/${n.reservationId}`, label: '예약 보기' }
    default:
      return null
  }
}

/** "방금" / "5분 전" / "3시간 전" / "11월 4일 14:20" (Asia/Seoul) */
export function agoLabel(iso: string, now = new Date()): string {
  const t = new Date(iso)
  const min = Math.floor((now.getTime() - t.getTime()) / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(t).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {})
  return `${p.month}월 ${p.day}일 ${p.hour}:${p.minute}`
}

/** 배너(앱 안 알림)를 눌렀을 때 갈 곳. 자리 비움은 "아직 있어요"·"퇴실할게요"를 고를 수 있게 알림함으로 */
export function toastTarget(n: AppNotification): string {
  if (n.kind === 'AWAY_SOON') return '/alerts'
  return notificationAction(n)?.to ?? '/alerts'
}

/**
 * 배너를 미뤄 둘 화면. 예약·지금 바로 쓰기·입실 번호·퇴실 화면은 위쪽 머리글에 [뒤로]·날짜 칩이 있어
 * 배너가 가리고, 잘못 누르면 고른 시간·사람을 잃고 떠난다(UX 점검 11/6). 이 화면을 나오면 그때 띄운다
 */
export function bannerHeld(pathname: string): boolean {
  return pathname === '/now' || pathname.startsWith('/rooms/') || pathname.startsWith('/reservations/') || pathname.endsWith('/checkout')
}

/** 처음 받은 목록 뒤로 새로 생긴 알림만 (최신 것이 앞). seen이 null이면 첫 조회라 아무것도 새것으로 보지 않는다 */
export function freshNotifications(list: AppNotification[], seen: ReadonlySet<number> | null): AppNotification[] {
  if (!seen) return []
  return list.filter((n) => !seen.has(n.id)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

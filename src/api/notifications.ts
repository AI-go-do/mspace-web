import { api } from './client'

/**
 * 알림 종류. 서버가 새 종류를 보내도 화면이 깨지지 않게 string도 받는다
 * START_SOON 입실 10분 전 · END_SOON 종료 10분 전 · NO_SHOW_SOON 노쇼 직전 · AWAY_SOON 자리 비움 (FR-NTF-101·102·104, FR-DEV-103)
 */
export type NotificationKind = 'START_SOON' | 'END_SOON' | 'NO_SHOW_SOON' | 'AWAY_SOON' | (string & {})

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

/** 알림에서 바로 갈 곳. 예약과 상관없거나 갈 곳이 없으면 null */
export function notificationAction(n: AppNotification): { to: string; label: string } | null {
  if (n.reservationId == null) return null
  switch (n.kind) {
    case 'START_SOON':
    case 'NO_SHOW_SOON':
      return { to: `/reservations/${n.reservationId}`, label: '입실 번호 보기' }
    case 'AWAY_SOON':
      return { to: `/me/${n.reservationId}/checkout`, label: '퇴실할게요' }
    case 'END_SOON':
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

/** 처음 받은 목록 뒤로 새로 생긴 알림만 (최신 것이 앞). seen이 null이면 첫 조회라 아무것도 새것으로 보지 않는다 */
export function freshNotifications(list: AppNotification[], seen: ReadonlySet<number> | null): AppNotification[] {
  if (!seen) return []
  return list.filter((n) => !seen.has(n.id)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

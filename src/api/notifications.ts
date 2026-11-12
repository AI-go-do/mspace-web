import { demoOn } from '../lib/demo'
import { demoApologies, isApology, isDemoId, mergeDemo, readDemo } from './apology'
import { api } from './client'
import { CO2_ALERT_KIND, demoCo2Alerts, isCo2DemoId, readCo2Demo } from './co2Alert'
import { demoLeftItemAlerts, isLeftItemDemoId, readLeftItemDemo } from './retrievePass'

/**
 * 알림 종류. 서버가 새 종류를 보내도 화면이 깨지지 않게 string도 받는다
 * START_SOON 입실 10분 전 · END_SOON 종료 10분 전 · NO_SHOW_SOON 노쇼 직전 · AWAY_SOON 자리 비움 (FR-NTF-101·102·104, FR-DEV-103)
 * REPORT_RESULT 신고 판정 결과 · WARNING 경고 (FR-RPT-104, core #70) · FORCED_CHECKOUT 관리자 퇴실 처리 (core #73)
 * DEVICE_APOLOGY 방의 사과: 문 장치 문제로 생긴 노쇼를 물렀음 (Q-19, core #99. api/apology.ts)
 * CO2_SOON 숨 막히기 N분 전: 창문을 열어 달라는 알림 (회의용 Q, core 초안. api/co2Alert.ts)
 * RELAY_OFFER 빈방 릴레이: 기다리던 자리가 나에게 넘어옴, 5분 안에 받기 (Q-18, core #101. 예약 번호 없음)
 * ROOM_FREE 빈방 알림: 지켜보던 방이 비었음 (core #109. 예약 번호 없음, api/roomWatches.ts)
 * LEFT_ITEM 두고 간 물건: 퇴실 직후 확인에서 물건이 남음, [찾으러 갈게요] 10분 QR (FR-DEV-105, core #112·#114. api/retrievePass.ts)
 * RESERVATION_INVITED 대표자가 나를 참여자로 넣어 예약함 (core #108, "홍*동님이 … 함께 예약했어요")
 * VENT_SOON 곧 환기가 필요해요 · ROOM_HOT 방이 더워요 · OVERTIME 이용 시간이 지났어요 (AI 자동 처리, core #136)
 */
export type NotificationKind = 'START_SOON' | 'END_SOON' | 'NO_SHOW_SOON' | 'AWAY_SOON'
  | 'REPORT_RESULT' | 'WARNING' | 'FORCED_CHECKOUT' | 'DEVICE_APOLOGY' | 'CO2_SOON' | 'RELAY_OFFER' | 'ROOM_FREE'
  | 'RESERVATION_INVITED' | 'LEFT_ITEM' | 'VENT_SOON' | 'ROOM_HOT' | 'OVERTIME' | (string & {})

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
  const real = api<AppNotification[]>('/api/notifications/me', { signal, member })
  if (!demoOn()) return real
  // 예시 화면(?demo=1): core가 없거나 실패해도 예시는 보인다. 끊은 요청(화면 떠남)은 그대로 끊는다
  return real
    .catch((e) => { if (signal?.aborted) throw e; return [] as AppNotification[] })
    .then((list) => mergeDemo(list, [...demoApologies(), ...demoCo2Alerts(), ...demoLeftItemAlerts()]))
}

/** 안 읽은 알림 개수 (홈 종 버튼 점, core #69). 예: {"count":3} */
export function getUnreadCount(signal?: AbortSignal, member?: number | null): Promise<{ count: number }> {
  const real = api<{ count: number }>('/api/notifications/me/unread-count', { signal, member })
  if (!demoOn()) return real
  const extra = [...demoApologies(), ...demoCo2Alerts(), ...demoLeftItemAlerts()].filter((n) => !n.read).length
  return real
    .catch((e) => { if (signal?.aborted) throw e; return { count: 0 } })
    .then((r) => ({ count: r.count + extra }))
}

/** 알림 하나 읽음 (core #69). 이미 읽었어도 204. 없거나 남의 알림이면 404 NOTIFICATION_NOT_FOUND */
export function markNotificationRead(id: number, member?: number | null): Promise<void> {
  // 예시 알림(음수 번호)은 서버에 없어서 이 탭에서만 읽음으로 둔다
  if (isLeftItemDemoId(id)) return Promise.resolve(readLeftItemDemo())
  if (isDemoId(id)) return Promise.resolve(isCo2DemoId(id) ? readCo2Demo(id) : readDemo())
  return api(`/api/notifications/${id}/read`, { method: 'POST', member })
}

/** 내 알림 모두 읽음 (core #69). 이번에 읽음으로 바뀐 개수를 돌려준다 */
export function markAllNotificationsRead(member?: number | null): Promise<{ count: number }> {
  const real = api<{ count: number }>('/api/notifications/read-all', { method: 'POST', member })
  if (!demoOn()) return real
  // 서버가 읽음으로 바꿨을 때만 예시도 읽음으로(실패하면 화면이 "못 바꿨어요"를 보이고 아무것도 바뀌지 않게)
  return real.then((r) => { readDemo(); readCo2Demo(null); readLeftItemDemo(); return r })
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
  // 방의 사과는 예약이 없어도(예시) 경고 수가 돌아왔는지 보러 간다
  if (isApology(n)) return { to: '/me/warnings', label: '내 경고 보기' }
  // 경고를 받았다: 횟수·근거·철회 요청은 마이 맨 아래 '내 경고'에 있다(11/10 재웅: 이용 규칙에서 뺌)
  if (n.kind === 'WARNING') return { to: '/me/warnings', label: '내 경고 보기' }
  // 숨 막히기: 홈 맨 위 "내 방 공기" 카드(공기청정기·에어컨 버튼)로
  // 미리 환기(VENT_SOON)·방이 더움(ROOM_HOT)도 같은 카드에서 환기·에어컨을 켠다 (core #136)
  if (n.kind === CO2_ALERT_KIND || n.kind === 'VENT_SOON' || n.kind === 'ROOM_HOT') return { to: '/', label: '내 방 공기 보기' }
  // 빈방 릴레이: 홈 맨 위 릴레이 카드에 남은 받을 시간과 [받을게요]·[넘길게요]가 있다
  if (n.kind === 'RELAY_OFFER') return { to: '/', label: '받으러 가기' }
  // 빈방 알림: 지켜보던 방이 비었으니 지금 바로 쓰기로(알림에는 방 번호 칸이 없어 방은 그 화면에서 고른다)
  if (n.kind === 'ROOM_FREE') return { to: '/now', label: '빈 방 바로 쓰기' }
  if (n.reservationId == null) return null
  switch (n.kind) {
    case 'START_SOON':
    case 'NO_SHOW_SOON':
      return { to: `/reservations/${n.reservationId}`, label: '입실 QR 보기' }
    case 'AWAY_SOON':
    // 시간 넘김(core #136): 바로 퇴실하게
    case 'OVERTIME':
      return { to: `/me/${n.reservationId}/checkout`, label: '퇴실할게요' }
    // 끝나기 10분 전: 연장 버튼은 사용 중 카드(마이 탭 맨 위)에 있다.
    // 어느 예약의 알림인지 같이 넘겨, 지난 알림으로 다른 예약을 연장하지 않게 마이가 맞춰 본다
    case 'END_SOON':
      return { to: `/me?end=${n.reservationId}`, label: '연장하기' }
    case 'FORCED_CHECKOUT':
    // 함께 쓰는 예약: 참여자도 예약 상세(시간·방·함께 쓰는 사람)를 볼 수 있다. 입실 번호는 대표자만 받는다
    case 'RESERVATION_INVITED':
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

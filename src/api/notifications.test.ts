import { describe, expect, it } from 'vitest'
import { agoLabel, freshNotifications, notificationAction, toastTarget, type AppNotification } from './notifications'

const n = (kind: string, reservationId: number | null = 12): AppNotification =>
  ({ id: 1, reservationId, kind, title: 't', body: 'b', createdAt: '2026-11-05T14:00:00+09:00', read: false })

describe('알림에서 갈 곳', () => {
  it('자리 비움 알림은 퇴실 화면으로 간다 (FR-NTF-103)', () => {
    expect(notificationAction(n('AWAY_SOON'))).toEqual({ to: '/me/12/checkout', label: '퇴실할게요' })
  })
  it('입실 전 알림은 입실 번호로 간다', () => {
    expect(notificationAction(n('START_SOON'))?.to).toBe('/reservations/12')
    expect(notificationAction(n('NO_SHOW_SOON'))?.to).toBe('/reservations/12')
  })
  it('예약이 없거나 모르는 종류면 버튼이 없다', () => {
    expect(notificationAction(n('START_SOON', null))).toBeNull()
    expect(notificationAction(n('VENTILATE'))).toBeNull()
  })
})

describe('알림 시각', () => {
  const now = new Date('2026-11-05T14:30:00+09:00')
  it('1분 안은 방금, 1시간 안은 분, 하루 안은 시간', () => {
    expect(agoLabel('2026-11-05T14:29:40+09:00', now)).toBe('방금')
    expect(agoLabel('2026-11-05T14:25:00+09:00', now)).toBe('5분 전')
    expect(agoLabel('2026-11-05T11:30:00+09:00', now)).toBe('3시간 전')
  })
  it('하루가 넘으면 서울 날짜와 시각', () => {
    expect(agoLabel('2026-11-03T09:05:00+09:00', now)).toBe('11월 3일 09:05')
  })
})

describe('앱 안 알림 배너', () => {
  const at = (id: number, kind: string, iso: string): AppNotification =>
    ({ id, reservationId: 5, kind, title: 't', body: 'b', createdAt: iso, read: false })
  it('처음 받은 목록은 배너로 띄우지 않고, 그 뒤 새로 생긴 것만 최신순으로 띄운다', () => {
    const first = [at(1, 'END_SOON', '2026-11-05T10:00:00+09:00')]
    expect(freshNotifications(first, null)).toEqual([])
    const next = [...first, at(2, 'START_SOON', '2026-11-05T10:01:00+09:00'), at(3, 'AWAY_SOON', '2026-11-05T10:02:00+09:00')]
    expect(freshNotifications(next, new Set([1])).map((n) => n.id)).toEqual([3, 2])
  })
  it('자리 비움 배너는 두 버튼이 있는 알림함으로, 나머지는 알림의 갈 곳으로', () => {
    expect(toastTarget(at(1, 'AWAY_SOON', '2026-11-05T10:00:00+09:00'))).toBe('/alerts')
    expect(toastTarget(at(1, 'START_SOON', '2026-11-05T10:00:00+09:00'))).toBe('/reservations/5')
    expect(toastTarget({ ...at(1, 'END_SOON', '2026-11-05T10:00:00+09:00'), reservationId: null })).toBe('/alerts')
  })
})

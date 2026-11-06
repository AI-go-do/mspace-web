import { describe, expect, it } from 'vitest'
import { agoLabel, bannerHeld, freshNotifications, notificationAction, toastTarget, withRead, type AppNotification } from './notifications'

const n = (kind: string, reservationId: number | null = 12): AppNotification =>
  ({ id: 1, reservationId, kind, title: 't', body: 'b', createdAt: '2026-11-05T14:00:00+09:00', read: false })

describe('알림에서 갈 곳', () => {
  it('자리 비움 알림은 퇴실 화면으로 간다 (FR-NTF-103)', () => {
    expect(notificationAction(n('AWAY_SOON'))).toEqual({ to: '/me/12/checkout', label: '퇴실할게요' })
    expect(notificationAction(n('END_SOON'))).toEqual({ to: '/me?end=12', label: '연장하기' })
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

describe('읽음 표시 (core #69)', () => {
  const list = [{ ...n('START_SOON'), id: 1 }, { ...n('END_SOON'), id: 2 }, { ...n('AWAY_SOON'), id: 3, read: true }]
  it('하나만 읽음으로 바꾸고 나머지는 그대로 둔다', () => {
    const next = withRead(list, 2)
    expect(next.map((x) => x.read)).toEqual([false, true, true])
    expect(next[0]).toBe(list[0])
  })
  it('id가 null이면 전부 읽음', () => {
    expect(withRead(list, null).every((x) => x.read)).toBe(true)
  })
  it('관리자 퇴실 처리 알림은 그 예약으로 간다 (core #73)', () => {
    expect(notificationAction(n('FORCED_CHECKOUT'))?.to).toBe('/me/12')
  })
  it('예약·지금 바로 쓰기·입실 번호·퇴실 화면에서는 배너를 미뤄 둔다', () => {
    for (const p of ['/rooms/3', '/now', '/reservations/101', '/me/101/checkout']) expect(bannerHeld(p)).toBe(true)
    for (const p of ['/', '/me', '/me/101', '/alerts', '/assistant', '/map']) expect(bannerHeld(p)).toBe(false)
  })
})

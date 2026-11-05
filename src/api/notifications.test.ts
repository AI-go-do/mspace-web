import { describe, expect, it } from 'vitest'
import { agoLabel, notificationAction, type AppNotification } from './notifications'

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

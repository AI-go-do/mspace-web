import { describe, expect, it } from 'vitest'
import { minutesLeft } from './retrievePass'
import { notificationAction } from './notifications'

describe('찾으러 가기 QR', () => {
  const now = Date.parse('2026-11-10T18:00:00+09:00')

  it('남은 분은 올려서 센다', () => {
    expect(minutesLeft('2026-11-10T18:09:01+09:00', now)).toBe(10)
    expect(minutesLeft('2026-11-10T18:00:30+09:00', now)).toBe(1)
  })

  it('지난 QR은 0분', () => {
    expect(minutesLeft('2026-11-10T17:59:00+09:00', now)).toBe(0)
  })

  it('두고 간 물건 알림은 다른 화면으로 보내지 않고 알림 안에서 QR을 받는다', () => {
    expect(notificationAction({ id: 1, reservationId: 9, kind: 'LEFT_ITEM', title: '', body: '', createdAt: '', read: false })).toBeNull()
  })
})

describe('경고 알림', () => {
  it('경고를 받으면 마이 맨 아래 내 경고로 간다(이용 규칙에서는 뺌)', () => {
    expect(notificationAction({ id: 2, reservationId: 9, kind: 'WARNING', title: '', body: '', createdAt: '', read: false }))
      .toEqual({ to: '/me/warnings', label: '내 경고 보기' })
  })
})

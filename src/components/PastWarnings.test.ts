import { describe, expect, it } from 'vitest'
import type { WarningRecord } from '../lib/appeal'
import { matchWarnings, openAppealCount } from './PastWarnings'

const w = (id: number, reservationId: number | null, issuedAt: string, over: Partial<WarningRecord> = {}): WarningRecord => ({
  id, kind: 'MESSY', roomId: 3, reservationId,
  startAt: '2026-11-06T14:00:00+09:00', endAt: '2026-11-06T16:00:00+09:00', issuedAt,
  why: '퇴실 뒤 방 카메라가 정리 필요로 봤어요', evidence: [], appeal: null, ...over,
})

describe('내 예약 화면 경고 철회 요청 (FR-RPT-105)', () => {
  it('지난 예약 목록에 있는 예약의 경고는 그 카드 아래로, 나머지는 따로 (최근 것부터)', () => {
    const list = [
      w(1, 51, '2026-11-06T16:10:00+09:00'),
      w(2, null, '2026-11-07T16:10:00+09:00'),
      w(3, 99, '2026-11-05T16:10:00+09:00'),
    ]
    const { byReservation, loose } = matchWarnings(list, [51, 52])
    expect(byReservation.get(51)?.id).toBe(1)
    expect(byReservation.has(52)).toBe(false)
    expect(loose.map((x) => x.id)).toEqual([2, 3])
  })

  it('한 예약에 경고가 둘이면 최근 것만 카드 아래, 앞 것은 따로', () => {
    const { byReservation, loose } = matchWarnings([w(1, 51, '2026-11-06T16:10:00+09:00'), w(2, 51, '2026-11-06T17:00:00+09:00')], [51])
    expect(byReservation.get(51)?.id).toBe(2)
    expect(loose.map((x) => x.id)).toEqual([1])
  })

  it('지금 요청할 수 있는 경고만 센다 (7일 안, 아직 안 보냄)', () => {
    const now = new Date('2026-11-08T22:00:00+09:00')
    const sent = { status: 'SENT' as const, text: 'x', sentAt: now.toISOString(), evidence: [], answer: null }
    expect(openAppealCount([
      w(1, 1, '2026-11-07T10:00:00+09:00'),
      w(2, 2, '2026-10-20T10:00:00+09:00'),
      w(3, 3, '2026-11-07T10:00:00+09:00', { appeal: sent }),
    ], now)).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { tidyPair, tidyReason } from './AdminInsights'
import type { TidyCheckRow } from '../api/admin'

const base = { result: 'LEFT_ITEMS' as const, leftItems: [], items: [{ name: 'cup', confidence: 0.55 }] }

describe('정리 확인 판단 글', () => {
  it('3시간 뒤에 남았어도 신고가 없으면 경고 보냈다고 하지 않는다', () => {
    const r = tidyReason({ ...base, phase: 'RECHECK', reportId: null })
    expect(r.actions.map((a) => a.done)).toEqual(['경고는 안 했어요'])
  })

  it('3시간 뒤 신고가 있으면 신고 번호와 대표자 경고', () => {
    const r = tidyReason({ ...base, phase: 'RECHECK', reportId: 56 })
    expect(r.actions.map((a) => a.done)).toEqual(['신고 #56 만들었어요', '대표자에게 경고 보냈어요'])
  })

  it('퇴실 직후 두고 간 물품은 알림 → 3시간 뒤 다시 확인(이미 했으면 했다고)', () => {
    expect(tidyReason({ ...base, phase: 'FIRST', reportId: null }).actions.map((a) => a.done))
      .toEqual(['대표자·참여자에게 알림 보냈어요', '3시간 뒤 다시 확인할게요'])
    expect(tidyReason({ ...base, phase: 'FIRST', reportId: null }, true).actions[1].done).toBe('3시간 뒤 다시 확인했어요')
  })

  it('11/10 전 NEEDS_CLEANING 기록은 3시간 뒤 확인을 약속하지 않는다', () => {
    const r = tidyReason({ result: 'NEEDS_CLEANING', leftItems: [], items: [], phase: 'FIRST', reportId: 12 })
    expect(r.verdict).toBe('치워야 해요')
    expect(r.actions.map((a) => a.done)).toEqual(['신고 #12 만들었어요'])
  })
})

const row = (o: Partial<TidyCheckRow>): TidyCheckRow => ({
  reservationId: 26, roomId: 1, roomName: '1번 방', endedAt: '2026-11-09T10:59:00+09:00', phase: 'FIRST',
  result: 'CLEAN', items: [], leftItems: [], reportId: null, observedAt: '2026-11-09T11:00:00+09:00', ...o,
} as TidyCheckRow)

describe('정리 확인 비교 사진 (core #125)', () => {
  it('카메라 사진이 있으면 그 주소, 학생 사진이면 학생 사진 표시', () => {
    const r = row({
      before: { source: 'CAMERA', takenAt: '2026-11-09T09:58:00+09:00', url: '/api/reservations/26/tidy-photos/ENTRY' },
      after: { source: 'STUDENT', takenAt: '2026-11-09T10:58:00+09:00', url: '/api/reservations/26/photos/CHECK_OUT' },
    })
    const [b, a] = tidyPair([r], r)
    expect(b).toMatchObject({ url: '/api/reservations/26/tidy-photos/ENTRY', label: '입실 전', student: false })
    expect(a).toMatchObject({ url: '/api/reservations/26/photos/CHECK_OUT', label: '퇴실 뒤', student: true })
  })

  it('둘 다 없으면(null) 빈칸 → "사진을 못 받았어요"', () => {
    const r = row({ before: null, after: null, phase: 'RECHECK' })
    expect(tidyPair([r], r)).toEqual([null, null])
  })

  it('예전 core(칸 없음)는 같은 방 앞 줄의 퇴실 사진으로 대신', () => {
    const r = row({})
    const prev = row({ reservationId: 25, observedAt: '2026-11-09T10:54:00+09:00' })
    const [b, a] = tidyPair([r, prev], r)
    expect(b?.url).toBe('/api/reservations/25/tidy-photos/FIRST')
    expect(a?.url).toBe('/api/reservations/26/tidy-photos/FIRST')
  })
})

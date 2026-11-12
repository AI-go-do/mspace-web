import { describe, expect, it } from 'vitest'
import { tidyPair, tidyReason, tidySteps } from './AdminInsights'

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

describe('정리 확인 비교 사진 (core #125)', () => {
  it('카메라 사진이 있으면 그 주소, 학생 사진이면 학생 사진 표시', () => {
    const [b, a] = tidyPair({
      reservationId: 26, phase: 'FIRST',
      before: { source: 'CAMERA', takenAt: '2026-11-09T09:58:00+09:00', url: '/api/reservations/26/tidy-photos/ENTRY' },
      after: { source: 'STUDENT', takenAt: '2026-11-09T10:58:00+09:00', url: '/api/reservations/26/photos/CHECK_OUT' },
    })
    expect(b).toMatchObject({ url: '/api/reservations/26/tidy-photos/ENTRY', label: '입실 전', student: false })
    expect(a).toMatchObject({ url: '/api/reservations/26/photos/CHECK_OUT', label: '퇴실 뒤', student: true })
  })

  it('둘 다 없으면(null) 빈칸 → "사진을 못 받았어요"', () => {
    expect(tidyPair({ reservationId: 26, phase: 'RECHECK', before: null, after: null })).toEqual([null, null])
  })

  it('예전 core(칸 없음) 퇴실 직후 줄은 같은 예약의 입실 직전 사진과 퇴실 뒤 사진', () => {
    const [b, a] = tidyPair({ reservationId: 7, phase: 'FIRST' })
    expect([b?.url, b?.label]).toEqual(['/api/reservations/7/tidy-photos/ENTRY', '입실 전'])
    expect([a?.url, a?.label]).toEqual(['/api/reservations/7/tidy-photos/FIRST', '퇴실 뒤'])
  })

  it('예전 core 3시간 뒤 줄은 퇴실 직후와 3시간 뒤 사진', () => {
    expect(tidyPair({ reservationId: 7, phase: 'RECHECK' }).map((s) => s?.label)).toEqual(['퇴실 직후', '3시간 뒤'])
  })
})

describe('오디 AI 판단 상자 줄 (기록에 있는 시각만)', () => {
  const row = { reservationId: 41, roomId: 1, roomName: '1번 방', phase: 'FIRST' as const, result: 'LEFT_ITEMS' as const, leftItems: [],
    items: [{ name: 'cup', confidence: 0.82 }], observedAt: '2026-11-12T11:02:10+09:00', endedAt: '2026-11-12T11:01:30+09:00', reportId: null }
  const acts = tidyReason(row).actions

  it('퇴실 → 젯슨 판단(퇴실 몇 초 뒤) → 알림 → 3시간 뒤 예정', () => {
    const s = tidySteps(row, null, acts, Date.parse('2026-11-12T11:05:00+09:00'))
    expect(s.map((x) => x.text)).toEqual(['퇴실', '젯슨이 판단', '대표자·참여자에게 알림 보냈어요', '3시간 뒤 다시 확인'])
    expect(s[1]).toMatchObject({ at: row.observedAt, note: '퇴실 40초 뒤' })
    expect(s[3]).toMatchObject({ at: null, note: '14:01쯤', later: true })
  })

  it('3시간 뒤 다시 확인을 했으면 그 실제 시각', () => {
    const recheck = { ...row, phase: 'RECHECK' as const, observedAt: '2026-11-12T14:02:40+09:00' }
    const s = tidySteps(row, recheck, tidyReason(row, true).actions)
    expect(s[3]).toMatchObject({ at: recheck.observedAt, text: '3시간 뒤 다시 확인했어요' })
  })

  it('3시간이 지났는데 다시 확인 기록이 없으면 예정이라고 하지 않는다', () => {
    const s = tidySteps(row, null, acts, Date.parse('2026-11-12T15:00:00+09:00'))
    expect(s[3]).toEqual({ at: null, text: '다시 확인 기록 없음' })
  })
})

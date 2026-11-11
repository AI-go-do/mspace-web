import { describe, expect, it } from 'vitest'
import { NO_PHOTO, tidyReason } from './AdminInsights'

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

describe('사진 없을 때 글', () => {
  it('없음과 실패를 다르게 말하고, 모델 판단 완료라고 하지 않는다', () => {
    expect(NO_PHOTO.none.done).not.toContain('판단 완료')
    expect(NO_PHOTO.failed.done).not.toBe(NO_PHOTO.none.done)
  })
})

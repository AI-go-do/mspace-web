import { describe, expect, it } from 'vitest'
import { sureNote, tidyReason } from './AdminInsights'

const base = { result: 'LEFT_ITEMS' as const, leftItems: [], items: [{ name: 'cup', confidence: 0.55 }] }

describe('정리 확인 판단 글', () => {
  it('확신도는 경고 기준(80%)과 같이 보여 준다', () => {
    expect(sureNote(0.88, false)).toBe('경고 기준 넘음')
    expect(sureNote(0.55, false)).toBe('경고 기준(80%) 아래라 알림만')
    expect(sureNote(0.55, false, 'RECHECK')).toBe('경고 기준(80%) 아래')
    expect(sureNote(0.9, true)).toBeNull()
    expect(sureNote(null, false)).toBeNull()
  })

  it('3시간 뒤에 남았어도 신고가 없으면 경고 보냈다고 하지 않는다', () => {
    const r = tidyReason({ ...base, phase: 'RECHECK', reportId: null })
    expect(r.actions.map((a) => a.done)).toEqual(['확신이 기준 아래라 경고는 안 했어요'])
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
})

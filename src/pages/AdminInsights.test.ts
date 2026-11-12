import { describe, expect, it } from 'vitest'
import { modelScoreView, tidyBoxState, tidyPair, tidyReason, tidySteps } from './AdminInsights'

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

describe('정리 확인 비교 사진', () => {
  it('퇴실 직후 줄은 같은 예약의 입실 직전 사진과 퇴실 뒤 사진을 나란히 둔다', () => {
    const [before, after] = tidyPair({ reservationId: 7, phase: 'FIRST' })
    expect([before.reservationId, before.phase, before.label]).toEqual([7, 'ENTRY', '입실 전'])
    expect([after.reservationId, after.phase, after.label]).toEqual([7, 'FIRST', '퇴실 뒤'])
  })

  it('3시간 뒤 줄은 퇴실 직후와 3시간 뒤 사진', () => {
    expect(tidyPair({ reservationId: 7, phase: 'RECHECK' }).map((s) => s.phase)).toEqual(['FIRST', 'RECHECK'])
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

describe('모델 시험 정확도 글', () => {
  it('젯슨 채점 값이 오면 그 값과 잰 날짜를 쓴다', () => {
    const v = modelScoreView({ kind: 'TIDY', model: 'yolov8m', accuracy: 0.8723, cases: 60, medianSeconds: 2.46, measuredAt: '2026-11-12T13:00:00+09:00' })
    expect(v).toMatchObject({ model: 'YOLOv8m', pct: '87.2%', cases: 60, seconds: '2.5', when: '11/12 젯슨 채점', live: true })
  })

  it('아직 없으면 기록해 둔 값을 "기록"이라고 밝힌다', () => {
    expect(modelScoreView(null)).toMatchObject({ model: 'YOLOv8s', pct: '76.6%', cases: 47, when: '11/11 기록', live: false })
  })
})

describe('찾으러 들어온 뒤 다시 확인', () => {
  const first = {
    reservationId: 41, roomId: 1, roomName: '창작실 1', phase: 'FIRST' as const, result: 'LEFT_ITEMS',
    items: [{ name: 'cup', confidence: 0.57 }], leftItems: [], reportId: null,
    endedAt: '2026-11-12T13:01:18+09:00', observedAt: '2026-11-12T13:01:21+09:00', retrievedAt: '2026-11-12T13:19:18+09:00',
  }

  it('QR로 들어오고 아직 다시 안 찍었으면 10분 뒤 예정을 보여 준다', () => {
    const s = tidySteps(first, null, tidyReason(first).actions, Date.parse('2026-11-12T13:20:00+09:00'))
    expect(s.map((x) => x.text)).toContain('찾으러 들어왔어요')
    expect(s.at(-1)).toMatchObject({ text: '10분 뒤 다시 찍어 확인', note: '13:29쯤', later: true })
  })

  it('다시 찍어 비었으면 가져갔다고 끝낸다', () => {
    const recheck = { ...first, phase: 'RECHECK' as const, result: 'CLEAN', items: [], observedAt: '2026-11-12T13:29:28+09:00' }
    const s = tidySteps(first, recheck, tidyReason(first, true).actions)
    expect(s.at(-2)).toMatchObject({ text: '젯슨이 다시 찍어 확인', note: '들어온 지 10분 뒤' })
    expect(s.at(-1)).toMatchObject({ text: '두고 간 물품 가져갔어요', got: true })
  })

  it('QR로 안 들어왔으면 지금처럼 3시간 뒤 다시 확인', () => {
    const plain = { ...first, retrievedAt: null }
    const s = tidySteps(plain, null, tidyReason(plain).actions, Date.parse('2026-11-12T13:20:00+09:00'))
    expect(s.at(-1)?.text).toBe('3시간 뒤 다시 확인')
  })
})

describe('재입장 뒤 사진', () => {
  it('찾으러 들어와 다시 찍었으면 퇴실 뒤 자리를 재입장 뒤 사진으로 바꾼다', () => {
    const [before, after] = tidyPair({ reservationId: 7, phase: 'FIRST' }, { reentered: true, rechecked: true })
    expect(before.phase).toBe('ENTRY')
    expect(after).toMatchObject({ phase: 'RECHECK', label: '재입장 뒤' })
  })

  it('들어왔지만 아직 안 찍었으면 퇴실 뒤 사진 그대로', () => {
    expect(tidyPair({ reservationId: 7, phase: 'FIRST' }, { reentered: true, rechecked: false })[1]).toMatchObject({ phase: 'FIRST', label: '퇴실 뒤' })
  })

  it('다시 확인 줄도 재입장이면 3시간 뒤라고 하지 않는다', () => {
    expect(tidyPair({ reservationId: 7, phase: 'RECHECK' }, { reentered: true, rechecked: true })[1].label).toBe('재입장 뒤')
    const r = tidyReason({ phase: 'RECHECK', result: 'CLEAN', leftItems: [], items: [], reportId: null }, false, true)
    expect(r.verdict).toBe('가져갔어요')
  })

  it('사진이 재입장 뒤로 바뀌면 첫 판단은 퇴실 직후 사진 기준이라고 밝히고, 가져갔으면 주의 색을 끈다', () => {
    const taken = tidyBoxState({ phase: 'FIRST' }, { result: 'CLEAN', leftItems: [] }, true, true)
    expect(taken).toEqual({ basis: '퇴실 직후 사진 기준', warn: false })
    const still = tidyBoxState({ phase: 'FIRST' }, { result: 'LEFT_ITEMS', leftItems: [] }, true, true)
    expect(still).toEqual({ basis: '퇴실 직후 사진 기준', warn: true })
    expect(tidyBoxState({ phase: 'FIRST' }, null, true, true)).toEqual({ basis: null, warn: true })
    expect(tidyBoxState({ phase: 'FIRST' }, { result: 'CLEAN', leftItems: [] }, false, true)).toEqual({ basis: null, warn: true })
  })

  it('QR 10분이 지났는데 다시 찍은 기록이 없으면 예정이라고 하지 않는다', () => {
    const first = {
      reservationId: 41, roomId: 1, roomName: '창작실 1', phase: 'FIRST' as const, result: 'LEFT_ITEMS',
      items: [{ name: 'cup', confidence: 0.57 }], leftItems: [], reportId: null,
      endedAt: '2026-11-12T13:01:18+09:00', observedAt: '2026-11-12T13:01:21+09:00', retrievedAt: '2026-11-12T13:19:18+09:00',
    }
    const s = tidySteps(first, null, tidyReason(first).actions, Date.parse('2026-11-12T15:00:00+09:00'))
    expect(s.at(-1)).toMatchObject({ text: '다시 확인 기록 없음' })
    expect(s.at(-1)?.later).toBeFalsy()
  })
})

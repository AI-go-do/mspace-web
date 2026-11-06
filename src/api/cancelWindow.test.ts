import { describe, expect, it } from 'vitest'
import { cancelDeadline, canCancel } from './reservations'

const base = { owner: true, status: 'BOOKED' as const, startAt: '2026-11-06T17:00:00+09:00' }
const at = (iso: string) => Date.parse(iso)

describe('취소 마감 (FR-RSV-007, 즉시 시작은 누른 뒤 5분)', () => {
  it('서버 값이 없으면(예전 core) 시작 시각까지', () => {
    expect(cancelDeadline(base).toISOString()).toBe(new Date(base.startAt).toISOString())
    expect(canCancel(base, at('2026-11-06T16:59:59+09:00'))).toBe(true)
    expect(canCancel(base, at('2026-11-06T17:00:00+09:00'))).toBe(false)
  })

  it('지금 바로 쓰기는 시작 뒤에도 cancelableUntil 전이면 취소 버튼', () => {
    const r = { ...base, startAt: '2026-11-06T17:03:20+09:00', cancelableUntil: '2026-11-06T17:08:20+09:00' }
    expect(canCancel(r, at('2026-11-06T17:06:00+09:00'))).toBe(true)
    expect(canCancel(r, at('2026-11-06T17:08:20+09:00'))).toBe(false)
  })

  it('참여자이거나 입실했으면 버튼 없음', () => {
    const r = { ...base, cancelableUntil: '2026-11-06T17:05:00+09:00' }
    expect(canCancel({ ...r, owner: false }, at('2026-11-06T16:00:00+09:00'))).toBe(false)
    expect(canCancel({ ...r, status: 'IN_USE' }, at('2026-11-06T17:01:00+09:00'))).toBe(false)
  })
})

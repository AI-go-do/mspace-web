import { describe, expect, it } from 'vitest'
import type { RoomSlots, Slot } from '../api/rooms'
import type { RoomBlock } from './roomBlocks'
import { applyBlocks, applyBlocksAll, applySlotBlocks, blockedSegments, blockLabel, blockRuns, normalizeBlocks, untilLabel } from './studentBlocks'

const t = (s: string) => new Date(`${s}+09:00`)
const iso = (s: string) => t(s).toISOString()

/** 2026-11-09 하루 48칸, 모두 빈 칸 */
function day(date = '2026-11-09'): Slot[] {
  const day0 = t(`${date}T00:00:00`).getTime()
  return Array.from({ length: 48 }, (_, i) => ({
    startAt: new Date(day0 + i * 1_800_000).toISOString(),
    endAt: new Date(day0 + (i + 1) * 1_800_000).toISOString(),
    available: true,
  }))
}
const room = (o: Partial<RoomSlots> = {}): RoomSlots => ({ roomId: 5, roomName: '창작실 5', minPeople: 5, maxPeople: 8, occupiedNow: false, slots: day(), ...o })
const block = (o: Partial<RoomBlock> = {}): RoomBlock => ({
  id: 1, roomId: 5, startAt: iso('2026-11-09T09:00:00'), endAt: iso('2026-11-09T12:00:00'),
  reason: 'INSPECTION', memo: '에어컨 점검', createdAt: iso('2026-11-08T10:00:00'), releasedAt: null, ...o,
})

describe('applySlotBlocks (칸에 막힌 기간 덮기)', () => {
  it('막힌 기간과 겹치는 칸만 예약 불가 + 사유가 된다', () => {
    const out = applySlotBlocks(5, day(), [block()])
    const blocked = out.filter((s) => s.block)
    expect(blocked).toHaveLength(6) // 09:00–12:00 = 30분 6칸
    expect(blocked.every((s) => !s.available && s.block?.reason === 'INSPECTION' && s.block.memo === '에어컨 점검')).toBe(true)
    expect(out[17].block).toBeUndefined() // 08:30 칸
    expect(out[24].block).toBeUndefined() // 12:00 칸 (끝은 들어가지 않음)
  })

  it('다른 방·풀린 기간은 덮지 않고 받은 배열을 그대로 돌려준다', () => {
    const slots = day()
    expect(applySlotBlocks(5, slots, [block({ roomId: 1 })])).toBe(slots)
    expect(applySlotBlocks(5, slots, [block({ releasedAt: iso('2026-11-08T11:00:00') })])).toBe(slots)
  })
})

describe('applyBlocks (방 현황)', () => {
  it('지금 막혀 있으면 blockedNow와 occupiedNow=true', () => {
    const out = applyBlocks(room(), [block()], t('2026-11-09T10:10:00'))
    expect(out.blockedNow).toEqual({ reason: 'INSPECTION', memo: '에어컨 점검', endAt: iso('2026-11-09T12:00:00') })
    expect(out.occupiedNow).toBe(true)
  })

  it('막히기 전이면 칸만 바뀌고 지금 상태는 그대로', () => {
    const out = applyBlocks(room(), [block()], t('2026-11-09T08:00:00'))
    expect(out.blockedNow).toBeUndefined()
    expect(out.occupiedNow).toBe(false)
    expect(out.slots[18].available).toBe(false)
  })

  it('막힌 기간이 없으면 같은 객체를 돌려준다(다시 그리기 줄이기)', () => {
    const r = room()
    expect(applyBlocks(r, [], t('2026-11-09T10:00:00'))).toBe(r)
    const list = [r]
    expect(applyBlocksAll(list, [], t('2026-11-09T10:00:00'))).toBe(list)
  })

  it('이미 예약된 칸도 막힌 사유를 붙인다', () => {
    const slots = day()
    slots[18] = { ...slots[18], available: false }
    const out = applyBlocks(room({ slots }), [block()], t('2026-11-09T08:00:00'))
    expect(out.slots[18].block?.reason).toBe('INSPECTION')
  })
})

describe('보이는 글', () => {
  it('blockLabel: 같은 날이면 시각만, 다른 날이면 날짜까지', () => {
    const b = { reason: 'INSPECTION' as const, memo: null, endAt: iso('2026-11-09T12:00:00') }
    expect(blockLabel(b, t('2026-11-09T10:00:00'))).toBe('점검 중 · 12:00까지')
    expect(blockLabel({ ...b, reason: 'RENTAL', endAt: iso('2026-11-12T18:00:00') }, t('2026-11-09T10:00:00'))).toBe('대관 중 · 11/12 18:00까지')
  })

  it('untilLabel: 자정에 끝나면 그 날 24:00', () => {
    expect(untilLabel(iso('2026-11-10T00:00:00'), t('2026-11-09T12:00:00'))).toBe('24:00')
  })

  it('blockRuns: 이어진 막힌 칸을 하나로 묶는다', () => {
    const out = applySlotBlocks(5, day(), [block(), block({ id: 2, startAt: iso('2026-11-09T20:00:00'), endAt: iso('2026-11-09T21:00:00'), reason: 'RENTAL', memo: null })])
    expect(blockRuns(out).map((r) => [r.from, r.to, r.block.reason])).toEqual([[18, 24, 'INSPECTION'], [40, 42, 'RENTAL']])
  })

  it('blockedSegments: 지난 칸은 빼고 몇 시간째로', () => {
    const out = applySlotBlocks(5, day(), [block()])
    expect(blockedSegments(out, t('2026-11-09T08:00:00'))).toEqual([{ from: 9, to: 12 }])
    expect(blockedSegments(out, t('2026-11-09T10:10:00'))).toEqual([{ from: 10, to: 12 }])
  })
})

describe('normalizeBlocks (core가 사유를 준 응답)', () => {
  it('blockedNow가 있으면 occupiedNow=true, block이 있는 칸은 예약 불가로 맞춘다', () => {
    const slots = day()
    slots[18] = { ...slots[18], block: { reason: 'INSPECTION', memo: null, endAt: iso('2026-11-09T12:00:00') } }
    const r = room({ occupiedNow: false, blockedNow: { reason: 'INSPECTION', memo: null, endAt: iso('2026-11-09T12:00:00') }, slots })
    const out = normalizeBlocks(r)
    expect(out.occupiedNow).toBe(true)
    expect(out.slots[18].available).toBe(false)
    // 막힌 기간 목록이 비어 있어도(예시 화면이 아니어도) 같은 모양
    expect(applyBlocksAll([r], [], t('2026-11-09T10:00:00'))[0].occupiedNow).toBe(true)
  })

  it('맞출 게 없으면 같은 객체', () => {
    const r = room()
    expect(normalizeBlocks(r)).toBe(r)
  })
})

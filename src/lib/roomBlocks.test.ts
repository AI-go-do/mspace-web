import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetBlocksForTest, blockConflicts, cancelConflicts, createBlock, mockReservations, previewReservations, releaseBlock, resetBlocks,
} from '../api/roomBlocks'
import { blockNow, conflictsOf, isActive, reasonStatus, validateBlock, type BlockInput, type RoomBlock } from './roomBlocks'

const now = new Date('2026-11-08T14:41:00+09:00')
const t = (s: string) => new Date(`${s}+09:00`)
const input = (o: Partial<BlockInput> = {}): BlockInput => ({
  roomId: 1, startAt: t('2026-11-09T09:00:00'), endAt: t('2026-11-09T12:00:00'), reason: 'INSPECTION', memo: '', ...o,
})
const block = (o: Partial<RoomBlock> = {}): RoomBlock => ({
  id: 1, roomId: 1, startAt: t('2026-11-09T09:00:00').toISOString(), endAt: t('2026-11-09T12:00:00').toISOString(),
  reason: 'INSPECTION', memo: null, createdAt: now.toISOString(), releasedAt: null, ...o,
})

describe('validateBlock (막기 값 검사)', () => {
  it('맞는 값이면 null', () => {
    expect(validateBlock(input(), [], now)).toBeNull()
  })

  it('30분 칸이 아니면 막는다', () => {
    expect(validateBlock(input({ startAt: t('2026-11-09T09:10:00') }), [], now)).toContain('30분 단위')
  })

  it('끝이 시작보다 앞이거나 같으면 막는다', () => {
    expect(validateBlock(input({ endAt: t('2026-11-09T09:00:00') }), [], now)).toContain('끝이 시작보다')
  })

  it('이미 지난 기간은 막을 수 없다', () => {
    expect(validateBlock(input({ startAt: t('2026-11-08T09:00:00'), endAt: t('2026-11-08T12:00:00') }), [], now)).toContain('이미 지난')
  })

  it('지금 걸쳐 있는 기간(시작은 지났고 끝은 안 지남)은 된다', () => {
    expect(validateBlock(input({ startAt: t('2026-11-08T14:00:00'), endAt: t('2026-11-08T16:00:00') }), [], now)).toBeNull()
  })

  it('31일을 넘으면 나눠 넣으라고 한다', () => {
    expect(validateBlock(input({ endAt: t('2026-12-11T09:00:00') }), [], now)).toContain('31일')
  })

  it('메모는 100자까지', () => {
    expect(validateBlock(input({ memo: '가'.repeat(101) }), [], now)).toContain('100자')
  })

  it('같은 방에 이미 막힌 기간과 겹치면 막고, 풀었거나 다른 방이면 된다', () => {
    const i = input({ startAt: t('2026-11-09T11:00:00'), endAt: t('2026-11-09T13:00:00') })
    expect(validateBlock(i, [block()], now)).toContain('이미 그 시간에 막혀')
    expect(validateBlock(i, [block({ releasedAt: now.toISOString() })], now)).toBeNull()
    expect(validateBlock(i, [block({ roomId: 2 })], now)).toBeNull()
    // 끝과 시작이 딱 붙은 건 겹침이 아니다
    expect(validateBlock(input({ startAt: t('2026-11-09T12:00:00'), endAt: t('2026-11-09T13:00:00') }), [block()], now)).toBeNull()
  })
})

describe('conflictsOf · blockNow · isActive', () => {
  const res = [
    { reservationId: 3, roomId: 1, startAt: t('2026-11-09T11:30:00').toISOString(), endAt: t('2026-11-09T13:00:00').toISOString(), people: 4 },
    { reservationId: 1, roomId: 1, startAt: t('2026-11-09T08:00:00').toISOString(), endAt: t('2026-11-09T09:30:00').toISOString(), people: 3 },
    { reservationId: 2, roomId: 1, startAt: t('2026-11-09T12:00:00').toISOString(), endAt: t('2026-11-09T13:00:00').toISOString(), people: 5 },
    { reservationId: 4, roomId: 2, startAt: t('2026-11-09T10:00:00').toISOString(), endAt: t('2026-11-09T11:00:00').toISOString(), people: 3 },
  ]

  it('같은 방에서 조금이라도 겹친 예약만, 시작 순서로', () => {
    expect(conflictsOf(block(), res).map((r) => r.reservationId)).toEqual([1, 3])
  })

  it('지금 걸린 기간만 방 현황에 보인다', () => {
    const b = block({ startAt: t('2026-11-08T14:00:00').toISOString(), endAt: t('2026-11-08T16:00:00').toISOString() })
    expect(blockNow(1, [b], now)?.id).toBe(1)
    expect(blockNow(2, [b], now)).toBeNull()
    expect(blockNow(1, [block()], now)).toBeNull() // 내일 것
    expect(blockNow(1, [{ ...b, releasedAt: now.toISOString() }], now)).toBeNull()
  })

  it('풀었거나 끝났으면 활성 아님', () => {
    expect(isActive(block(), now)).toBe(true)
    expect(isActive(block({ releasedAt: now.toISOString() }), now)).toBe(false)
    expect(isActive(block({ endAt: t('2026-11-08T14:00:00').toISOString() }), now)).toBe(false)
  })

  it('학생 화면 말은 "점검 중"처럼', () => {
    expect(reasonStatus('INSPECTION')).toBe('점검 중')
    expect(reasonStatus('OTHER')).toBe('이용 불가')
  })
})

describe('가짜 기간 막기 저장소', () => {
  beforeEach(() => {
    _resetBlocksForTest('mock')
    resetBlocks()
  })

  it('가짜 예약은 이미 끝난 것을 빼고 이름·학번 없이 번호·시간·인원만', () => {
    const list = mockReservations(now)
    expect(list.every((r) => new Date(r.endAt).getTime() > now.getTime())).toBe(true)
    expect(Object.keys(list[0]).sort()).toEqual(['endAt', 'people', 'reservationId', 'roomId', 'startAt'])
  })

  it('가짜 예약 번호는 자정이 지나도 같은 예약이면 같다', () => {
    const today = mockReservations(now)
    const tomorrow = mockReservations(new Date(now.getTime() + 86_400_000))
    const tomorrowSlot = today.find((r) => r.startAt === t('2026-11-09T13:00:00').toISOString())!
    expect(tomorrow.find((r) => r.startAt === tomorrowSlot.startAt)?.reservationId).toBe(tomorrowSlot.reservationId)
    expect(new Set(today.map((r) => r.reservationId)).size).toBe(today.length)
  })

  it('막으면 겹친 예약을 지우지 않고 보여 주고, 확인 뒤 취소하면 목록에서 빠진다', async () => {
    // 1번 방 내일 13~15시 예약이 있다
    const r = await createBlock(input({ startAt: t('2026-11-09T12:00:00'), endAt: t('2026-11-09T16:00:00') }), now)
    if ('error' in r) throw new Error(r.error)
    expect(r.conflicts.length).toBe(1)
    expect(blockConflicts(r.block.id, now).length).toBe(1)
    expect(await cancelConflicts(r.block.id, now)).toBe(1)
    expect(blockConflicts(r.block.id, now)).toEqual([])
    // 두 번 눌러도 다시 취소하지 않는다
    expect(await cancelConflicts(r.block.id, now)).toBe(0)
  })

  it('틀린 값은 { error }로 돌려주고 저장하지 않는다', async () => {
    const r = await createBlock(input({ endAt: t('2026-11-09T09:00:00') }), now)
    expect('error' in r).toBe(true)
  })

  it('풀면 겹친 예약 목록도 사라지고 같은 시간을 다시 막을 수 있다', async () => {
    const r = await createBlock(input({ startAt: t('2026-11-09T12:00:00'), endAt: t('2026-11-09T16:00:00') }), now)
    if ('error' in r) throw new Error(r.error)
    expect('error' in await createBlock(input({ startAt: t('2026-11-09T13:00:00'), endAt: t('2026-11-09T14:00:00') }), now)).toBe(true)
    expect(await releaseBlock(r.block.id, now)).toBeNull()
    expect(blockConflicts(r.block.id, now)).toEqual([])
    expect('error' in await createBlock(input({ startAt: t('2026-11-09T13:00:00'), endAt: t('2026-11-09T14:00:00') }), now)).toBe(false)
  })

  it('가짜 저장소에서는 막기 전 겹칠 예약을 미리 센다', () => {
    expect(previewReservations(now).length).toBeGreaterThan(0)
  })
})

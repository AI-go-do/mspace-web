import type { RoomSlots, Slot, SlotBlock } from '../api/rooms'
import { blockNow, reasonStatus, type RoomBlock } from './roomBlocks'
import { seoulClock, seoulDate } from './time'

/**
 * 학생 화면의 "막힌 기간" 표시 (요구사항 Q-23 제안, core #95 초안).
 * core가 빈방 조회 응답에 칸별 `block`과 방별 `blockedNow`를 넣어 주면 화면은 그것만 읽는다.
 * 그 전에는 예시 화면(?demo=1)에서만 관리자 "기간 막기" 탭의 가짜 기록을 응답 위에 덮어 같은 모양을 만든다.
 * 시각은 밖에서 받는 순수 함수만 둔다
 */

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

const live = (b: RoomBlock) => b.releasedAt === null

const toSlotBlock = (b: RoomBlock): SlotBlock => ({ reason: b.reason, memo: b.memo, endAt: b.endAt })

/** 한 방의 칸들 중 막힌 기간과 겹치는 칸을 예약 불가 + 사유로 바꾼다. 바꿀 게 없으면 받은 배열을 그대로 돌려준다 */
export function applySlotBlocks(roomId: number, slots: Slot[], blocks: RoomBlock[]): Slot[] {
  const mine = blocks.filter((b) => b.roomId === roomId && live(b))
  if (!mine.length || !slots.length) return slots
  let changed = false
  const out = slots.map((s) => {
    const a = Date.parse(s.startAt)
    const z = Date.parse(s.endAt)
    const b = mine.find((x) => overlaps(a, z, Date.parse(x.startAt), Date.parse(x.endAt)))
    if (!b) return s
    changed = true
    return { ...s, available: false, block: toSlotBlock(b) }
  })
  return changed ? out : slots
}

/** 방 하나에 막힌 기간을 덮는다. 지금 막혀 있으면 지금 쓸 수 없는 방(occupiedNow)으로도 본다 */
export function applyBlocks(room: RoomSlots, blocks: RoomBlock[], now: Date): RoomSlots {
  const slots = applySlotBlocks(room.roomId, room.slots, blocks)
  const nowBlock = blockNow(room.roomId, blocks, now)
  if (slots === room.slots && !nowBlock) return room
  return {
    ...room,
    slots,
    ...(nowBlock ? { blockedNow: toSlotBlock(nowBlock), occupiedNow: true } : {}),
  }
}

export function applyBlocksAll(rooms: RoomSlots[], blocks: RoomBlock[], now: Date): RoomSlots[] {
  if (!blocks.length) return rooms
  return rooms.map((r) => applyBlocks(r, blocks, now))
}

/** 끝 시각: 기준 날(ref)과 같은 날이면 "12:00", 다른 날이면 "11/12 18:00". 자정에 끝나면 그 전날 "24:00"으로 본다 */
export function untilLabel(endAt: string, ref: Date): string {
  const end = new Date(endAt)
  const day = seoulDate(end)
  if (day === seoulDate(ref)) return seoulClock(end)
  if (seoulClock(end) === '00:00' && seoulDate(new Date(end.getTime() - 1)) === seoulDate(ref)) return '24:00'
  const [, m, d] = day.split('-')
  return `${Number(m)}/${Number(d)} ${seoulClock(end)}`
}

/** 방 현황 한 줄: "점검 중 · 12:00까지" */
export function blockLabel(b: SlotBlock, now: Date): string {
  return `${reasonStatus(b.reason)} · ${untilLabel(b.endAt, now)}까지`
}

/** 시간표에서 이어진 막힌 칸 묶음 (예약 화면 안내 줄용). from·to는 칸 번호, to는 들어가지 않는다 */
export interface BlockRun {
  from: number
  to: number
  block: SlotBlock
}

export function blockRuns(slots: Slot[]): BlockRun[] {
  const runs: BlockRun[] = []
  slots.forEach((s, i) => {
    if (!s.block) return
    const last = runs[runs.length - 1]
    if (last && last.to === i && last.block.endAt === s.block.endAt && last.block.reason === s.block.reason) last.to = i + 1
    else runs.push({ from: i, to: i + 1, block: s.block })
  })
  return runs
}

/** 홈 하루 막대에 그릴 막힌 구간 (0시부터 몇 시간째). 지난 칸은 뺀다 */
export function blockedSegments(slots: Slot[], now: Date): { from: number; to: number }[] {
  if (!slots.length) return []
  const day0 = Date.parse(slots[0].startAt)
  const segs: { from: number; to: number }[] = []
  for (const s of slots) {
    if (!s.block || Date.parse(s.endAt) <= now.getTime()) continue
    const from = Math.max(0, (Date.parse(s.startAt) - day0) / 3_600_000)
    const to = (Date.parse(s.endAt) - day0) / 3_600_000
    const last = segs[segs.length - 1]
    if (last && last.to === from) last.to = to
    else segs.push({ from, to })
  }
  return segs
}

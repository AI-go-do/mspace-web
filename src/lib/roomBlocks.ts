/**
 * 관리자 기간 막기 (요구사항 Q-23 제안, core #95 초안). 공사·점검·대관 같은 이유로 방을 일정 기간 예약 못 하게 막는다.
 * - 막힌 칸은 학생이 예약·즉시 시작·연장할 수 없다(core가 409 ROOM_BLOCKED)
 * - 그 기간에 이미 잡힌 예약은 바로 지우지 않고 목록으로 보여 준다. 관리자가 확인하면 취소 + 대표자·참여자 알림
 * 화면과 가짜 저장소가 같이 쓰는 순수 함수만 둔다(시각은 밖에서 받는다)
 */
export type BlockReason = 'CONSTRUCTION' | 'INSPECTION' | 'RENTAL' | 'OTHER'

export const BLOCK_REASONS: { value: BlockReason; label: string; status: string }[] = [
  { value: 'CONSTRUCTION', label: '공사', status: '공사 중' },
  { value: 'INSPECTION', label: '점검', status: '점검 중' },
  { value: 'RENTAL', label: '대관', status: '대관 중' },
  { value: 'OTHER', label: '기타', status: '이용 불가' },
]

export const reasonLabel = (r: BlockReason) => BLOCK_REASONS.find((x) => x.value === r)?.label ?? r
/** 학생 화면·방 현황에 보일 말 ("점검 중") */
export const reasonStatus = (r: BlockReason) => BLOCK_REASONS.find((x) => x.value === r)?.status ?? '이용 불가'

export interface RoomBlock {
  id: number
  roomId: number
  startAt: string
  endAt: string
  reason: BlockReason
  /** 학생 알림·방 현황에 같이 보일 짧은 말. 이름·학번은 적지 않는다 */
  memo: string | null
  createdAt: string
  /** 관리자가 풀었으면 그 시각 */
  releasedAt: string | null
}

/** 막은 기간과 겹친 예약 (가짜 단계에서는 이름·학번 없이 번호·시간·인원만) */
export interface BlockConflict {
  reservationId: number
  roomId: number
  startAt: string
  endAt: string
  people: number
}

export interface BlockInput {
  roomId: number
  startAt: Date
  endAt: Date
  reason: BlockReason
  memo: string
}

export const BLOCK_RULES = {
  /** 예약과 같은 30분 칸 */
  slotMinutes: 30,
  /** 잘못 눌러 몇 달을 막지 않게 (대관도 한 학기 단위면 나눠서) */
  maxDays: 31,
  memoMax: 100,
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

export function isActive(b: RoomBlock, now: Date): boolean {
  return b.releasedAt === null && new Date(b.endAt).getTime() > now.getTime()
}

/** 넣은 값이 맞는지. 틀리면 화면에 보일 문장, 맞으면 null */
export function validateBlock(input: BlockInput, blocks: RoomBlock[], now: Date, rules = BLOCK_RULES): string | null {
  const s = input.startAt.getTime()
  const e = input.endAt.getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '시작과 끝 시각을 넣어 주세요.'
  const slot = rules.slotMinutes * 60_000
  if (s % slot !== 0 || e % slot !== 0) return `시각은 ${rules.slotMinutes}분 단위(정각·30분)로 넣어 주세요.`
  if (e <= s) return '끝이 시작보다 뒤여야 해요.'
  if (e <= now.getTime()) return '이미 지난 기간은 막을 수 없어요.'
  if (e - s > rules.maxDays * 86_400_000) return `한 번에 ${rules.maxDays}일까지 막을 수 있어요. 더 길면 나눠서 넣어 주세요.`
  if (input.memo.trim().length > rules.memoMax) return `메모는 ${rules.memoMax}자까지예요.`
  const clash = blocks.find((b) => b.roomId === input.roomId && isActive(b, now)
    && overlaps(s, e, new Date(b.startAt).getTime(), new Date(b.endAt).getTime()))
  if (clash) return '이 방은 이미 그 시간에 막혀 있어요. 먼저 풀거나 시간을 바꿔 주세요.'
  return null
}

/** 막은 기간과 겹치는 예약 (같은 방, 시간이 조금이라도 겹치면) */
export function conflictsOf(block: Pick<RoomBlock, 'roomId' | 'startAt' | 'endAt'>, reservations: BlockConflict[]): BlockConflict[] {
  const s = new Date(block.startAt).getTime()
  const e = new Date(block.endAt).getTime()
  return reservations
    .filter((r) => r.roomId === block.roomId && overlaps(s, e, new Date(r.startAt).getTime(), new Date(r.endAt).getTime()))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
}

/** 지금 그 방을 막고 있는 기간 (방 현황 "점검 중" 표시용) */
export function blockNow(roomId: number, blocks: RoomBlock[], now: Date): RoomBlock | null {
  const t = now.getTime()
  return blocks.find((b) => b.roomId === roomId && b.releasedAt === null
    && new Date(b.startAt).getTime() <= t && t < new Date(b.endAt).getTime()) ?? null
}

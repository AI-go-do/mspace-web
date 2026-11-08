import { useSyncExternalStore } from 'react'
import { seoulDate } from '../lib/time'
import { conflictsOf, isActive, validateBlock, type BlockConflict, type BlockInput, type RoomBlock } from '../lib/roomBlocks'

/**
 * 기간 막기 데이터 창구 (가짜 단계). 화면은 useRoomBlocks()와 아래 함수만 쓴다.
 * core #95가 정해지면 이 파일 안쪽만 API 호출로 바꾼다(예상: GET·POST /api/admin/room-blocks, POST …/{id}/release,
 * 겹친 예약 취소). 지금은 이 브라우저에만 기록하고, 겹친 예약 "취소"도 가짜라 학생에게 아무것도 가지 않는다
 */
interface BlocksState {
  blocks: RoomBlock[]
  /** 가짜 예약 중 관리자가 취소한 번호 */
  canceled: number[]
  seq: number
}

const KEY = 'mspace.admin.roomBlocks.v1'

/** 가짜 예약: 오늘부터 7일, 날마다 같은 모양 [방, 시작 시, 끝 시, 예약 인원] (서울 시각) */
const PATTERN: [number, number, number, number][] = [
  [1, 13, 15, 4], [1, 19, 21, 5], [2, 10, 12, 3], [2, 16, 18, 4], [3, 14, 16, 4],
  [3, 18, 20.5, 3], [4, 20, 22, 5], [5, 15, 17, 6], [5, 21.5, 23.5, 7],
]

export function mockReservations(now: Date, days = 7): BlockConflict[] {
  const out: BlockConflict[] = []
  const today = new Date(`${seoulDate(now)}T00:00:00+09:00`).getTime()
  for (let d = 0; d < days; d++) {
    PATTERN.forEach(([roomId, a, b, people], i) => {
      const start = today + d * 86_400_000 + a * 3_600_000
      const end = today + d * 86_400_000 + b * 3_600_000
      if (end <= now.getTime()) return
      out.push({ reservationId: 2000 + d * 20 + i, roomId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), people })
    })
  }
  return out
}

function seed(now: Date): BlocksState {
  // 예시 하나: 내일 오전 5번 방 점검
  const tomorrow = new Date(`${seoulDate(new Date(now.getTime() + 86_400_000))}T09:00:00+09:00`)
  return {
    blocks: [{ id: 1, roomId: 5, startAt: tomorrow.toISOString(), endAt: new Date(tomorrow.getTime() + 3 * 3_600_000).toISOString(),
      reason: 'INSPECTION', memo: '에어컨 점검', createdAt: now.toISOString(), releasedAt: null }],
    canceled: [],
    seq: 1,
  }
}

function isState(s: unknown): s is BlocksState {
  const v = s as BlocksState | null
  return !!v && typeof v === 'object' && Array.isArray(v.blocks) && Array.isArray(v.canceled) && typeof v.seq === 'number'
    && v.blocks.every((b) => !!b && typeof b.id === 'number' && typeof b.roomId === 'number' && typeof b.startAt === 'string'
      && typeof b.endAt === 'string' && typeof b.reason === 'string')
}

let state: BlocksState | null = null
const listeners = new Set<() => void>()

function load(): BlocksState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s: unknown = JSON.parse(raw)
      if (isState(s)) return s
    }
  } catch {
    /* 저장소 없음·깨짐: 처음부터 */
  }
  return seed(new Date())
}

function get(): BlocksState {
  if (!state) state = load()
  return state
}

function set(next: BlocksState) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 화면은 그대로 */ }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 아직 취소 안 된 가짜 예약 */
function liveReservations(s: BlocksState, now: Date): BlockConflict[] {
  return mockReservations(now).filter((r) => !s.canceled.includes(r.reservationId))
}

/** 기간 막기. 틀리면 { error }, 되면 막은 기간과 겹친 예약 목록 */
export function createBlock(input: BlockInput, now = new Date()): { error: string } | { block: RoomBlock; conflicts: BlockConflict[] } {
  const s = get()
  const error = validateBlock(input, s.blocks, now)
  if (error) return { error }
  const block: RoomBlock = {
    id: s.seq + 1, roomId: input.roomId, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(),
    reason: input.reason, memo: input.memo.trim() || null, createdAt: now.toISOString(), releasedAt: null,
  }
  set({ ...s, blocks: [block, ...s.blocks], seq: block.id })
  return { block, conflicts: conflictsOf(block, liveReservations(get(), now)) }
}

/** 막은 기간 풀기 (기록은 남긴다) */
export function releaseBlock(id: number, now = new Date()): void {
  const s = get()
  set({ ...s, blocks: s.blocks.map((b) => (b.id === id && b.releasedAt === null ? { ...b, releasedAt: now.toISOString() } : b)) })
}

/** 막은 기간과 겹친 예약 (아직 안 지운 것) */
export function blockConflicts(id: number, now = new Date()): BlockConflict[] {
  const s = get()
  const b = s.blocks.find((x) => x.id === id)
  if (!b || !isActive(b, now)) return []
  return conflictsOf(b, liveReservations(s, now))
}

/** 관리자가 확인한 뒤 겹친 예약 취소 (가짜: 학생에게 보내지 않음). 취소한 건수 */
export function cancelConflicts(id: number, now = new Date()): number {
  const list = blockConflicts(id, now)
  if (!list.length) return 0
  const s = get()
  set({ ...s, canceled: [...s.canceled, ...list.map((r) => r.reservationId)] })
  return list.length
}

export function resetBlocks(): void {
  set(seed(new Date()))
}

/** 화면용: 기록이 바뀌면(막기·풀기·취소) 다시 그린다 */
export function useRoomBlocks(): { blocks: RoomBlock[]; canceled: number[] } {
  return useSyncExternalStore(subscribe, get, get)
}

/** 테스트용 */
export function _resetBlocksForTest(): void {
  state = null
}

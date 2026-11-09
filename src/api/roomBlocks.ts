import { useEffect, useSyncExternalStore } from 'react'
import { demoOn } from '../lib/demo'
import { seoulDate } from '../lib/time'
import { conflictsOf, isActive, validateBlock, type BlockConflict, type BlockInput, type RoomBlock } from '../lib/roomBlocks'
import { api, ApiError, currentMemberId } from './client'

/**
 * 기간 막기 데이터 창구. 화면은 useRoomBlocks()와 아래 함수만 쓴다.
 * - 'api': core #98 관리자 기간 막기 API (GET·POST /api/admin/room-blocks, POST …/{id}/release,
 *   GET …/{id}/conflicts, POST …/{id}/cancel-conflicts). 개발 서버(develop 이미지)만 이렇게 빌드한다(deploy.yml)
 * - 'mock': 이 브라우저에만 기록하는 가짜 저장소. 시연 서버와 ?demo=1. 겹친 예약 "취소"도 가짜라 학생에게 아무것도 가지 않는다
 * 학생 화면의 막힌 칸은 core 빈방 조회(core #103의 block·blockedNow)가 주므로 여기서 읽지 않는다(useStudentBlocks)
 */
const BUILD_SOURCE: 'api' | 'mock' = import.meta.env.VITE_ADMIN_BLOCKS_SOURCE === 'api' ? 'api' : 'mock'
let sourceOverride: 'api' | 'mock' | null = null

/** 지금 쓸 창구. 'api'로 빌드했어도 시연 모드(?demo=1)면 가짜 저장소 */
export function blocksSource(): 'api' | 'mock' {
  const built = sourceOverride ?? BUILD_SOURCE
  return built === 'api' && !demoOn() ? 'api' : 'mock'
}

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
      // 번호는 오늘 기준이 아니라 그 날짜로 정한다(자정이 지나도 같은 예약은 같은 번호, 취소 기록이 어긋나지 않게)
      const day = Math.round((today + d * 86_400_000) / 86_400_000)
      out.push({ reservationId: day * 20 + i, roomId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), people })
    })
  }
  return out
}

/** 처음 가짜 기록: 내일 오전 5번 방 점검 하나 */
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

/** 저장된 값이 가짜 기록 모양인지 */
function isState(s: unknown): s is BlocksState {
  const v = s as BlocksState | null
  return !!v && typeof v === 'object' && Array.isArray(v.blocks) && Array.isArray(v.canceled) && typeof v.seq === 'number'
    && v.blocks.every((b) => !!b && typeof b.id === 'number' && typeof b.roomId === 'number' && typeof b.startAt === 'string'
      && typeof b.endAt === 'string' && typeof b.reason === 'string')
}

let state: BlocksState | null = null
const listeners = new Set<() => void>()

/** 이 브라우저에 남긴 가짜 기록을 읽는다. 없거나 깨졌으면 예시 하나로 시작 */
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

/** 가짜 기록 (처음 부를 때 읽는다) */
function get(): BlocksState {
  if (!state) state = load()
  return state
}

/** 가짜 기록을 바꾸고 저장한 뒤 화면에 알린다 */
function set(next: BlocksState) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 화면은 그대로 */ }
  listeners.forEach((fn) => fn())
}

/** 기록이 바뀔 때 부를 함수를 건다. 돌려준 함수로 뗀다 */
function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 아직 취소 안 된 가짜 예약. 미리 예약은 시작이 오늘부터 7일 안이라(예약 규칙) 그 뒤 날짜에는 겹칠 예약이 생길 수 없어요 */
function liveReservations(s: BlocksState, now: Date): BlockConflict[] {
  return mockReservations(now).filter((r) => !s.canceled.includes(r.reservationId))
}

/** 가짜 저장소에 막기. 틀리면 { error }, 되면 막은 기간과 겹친 가짜 예약 */
function mockCreate(input: BlockInput, now: Date): { error: string } | { block: RoomBlock; conflicts: BlockConflict[] } {
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

/** 가짜 저장소에서 풀기 (기록은 남긴다) */
function mockRelease(id: number, now: Date): void {
  const s = get()
  set({ ...s, blocks: s.blocks.map((b) => (b.id === id && b.releasedAt === null ? { ...b, releasedAt: now.toISOString() } : b)) })
}

/** 가짜 저장소에서 막은 기간과 겹친 가짜 예약 (아직 취소 안 한 것) */
function mockConflicts(id: number, now: Date): BlockConflict[] {
  const s = get()
  const b = s.blocks.find((x) => x.id === id)
  if (!b || !isActive(b, now)) return []
  return conflictsOf(b, liveReservations(s, now))
}

/** 가짜 저장소에서 겹친 예약 취소 (학생에게 보내지 않음). 취소한 건수 */
function mockCancel(id: number, now: Date): number {
  const list = mockConflicts(id, now)
  if (!list.length) return 0
  const s = get()
  set({ ...s, canceled: [...s.canceled, ...list.map((r) => r.reservationId)] })
  return list.length
}

// ---- core API (개발 서버) ----

/** 화면이 읽는 모양. mock이면 loaded는 늘 true */
export interface BlocksView {
  source: 'api' | 'mock'
  blocks: RoomBlock[]
  /** 가짜 예약 중 관리자가 취소한 번호 (mock만) */
  canceled: number[]
  /** 막기 번호별 겹친 예약 (api만. mock은 blockConflicts()가 계산) */
  conflicts: Record<number, BlockConflict[]>
  loaded: boolean
  /** 목록을 못 읽었을 때 화면에 보일 말 */
  error: string | null
}

let apiView: BlocksView = { source: 'api', blocks: [], canceled: [], conflicts: {}, loaded: false, error: null }
let mockView: BlocksView | null = null
let loadedAt = 0
let inflight: Promise<void> | null = null

/** api 상태를 바꾸고 화면에 알린다 */
function setApi(next: Partial<BlocksView>) {
  apiView = { ...apiView, ...next }
  listeners.forEach((fn) => fn())
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요')

/** core Block 모양인지 (memo·releasedAt은 null일 수 있다) */
function isBlock(v: unknown): v is RoomBlock {
  const b = v as RoomBlock | null
  return !!b && typeof b === 'object' && typeof b.id === 'number' && typeof b.roomId === 'number'
    && typeof b.startAt === 'string' && typeof b.endAt === 'string' && typeof b.reason === 'string'
}

/** core Conflict 모양인지 */
function isConflict(v: unknown): v is BlockConflict {
  const c = v as BlockConflict | null
  return !!c && typeof c === 'object' && typeof c.reservationId === 'number' && typeof c.roomId === 'number'
    && typeof c.startAt === 'string' && typeof c.endAt === 'string' && typeof c.people === 'number'
}

const badShape = () => new ApiError(0, 'INVALID_RESPONSE', '기간 막기 응답 모양이 달라요(core API 확인 필요).')

/** 서버 값을 화면 모양으로. 모양이 다르면 INVALID_RESPONSE */
function toBlock(v: unknown): RoomBlock {
  if (!isBlock(v)) throw badShape()
  return { ...v, memo: v.memo ?? null, releasedAt: v.releasedAt ?? null }
}

/** 서버 겹친 예약 목록을 검사해 그대로 돌려준다 */
function toConflicts(v: unknown): BlockConflict[] {
  if (!Array.isArray(v) || !v.every(isConflict)) throw badShape()
  return v
}

/** 막기 하나와 겹친 끝나지 않은 예약 */
async function fetchConflicts(id: number): Promise<BlockConflict[]> {
  return toConflicts(await api<unknown>(`/api/admin/room-blocks/${id}/conflicts`, { member: currentMemberId() }))
}

/** 목록 + 활성 막기마다 겹친 예약을 다시 읽는다. 여러 화면이 같이 불러도 한 번만, 30초 안에 다시 부르면 건너뛴다(force 빼고) */
export function refreshBlocks(force = false): Promise<void> {
  if (blocksSource() !== 'api') return Promise.resolve()
  if (inflight) return inflight
  if (!force && apiView.loaded && Date.now() - loadedAt < 30_000) return Promise.resolve()
  const run = (async () => {
    try {
      const raw = await api<unknown>('/api/admin/room-blocks', { member: currentMemberId() })
      if (!Array.isArray(raw)) throw badShape()
      const blocks = raw.map(toBlock)
      const now = new Date()
      const pairs = await Promise.all(blocks.filter((b) => isActive(b, now))
        .map(async (b) => [b.id, await fetchConflicts(b.id)] as const))
      loadedAt = Date.now()
      setApi({ blocks, conflicts: Object.fromEntries(pairs), loaded: true, error: null })
    } catch (e) {
      // 읽었던 목록은 두고 오류만 보여 준다
      setApi({ loaded: true, error: `막힌 기간을 못 읽었어요. ${message(e)}` })
    } finally {
      inflight = null
    }
  })()
  inflight = run
  return run
}

// ---- 화면이 쓰는 함수 (api·mock 같은 모양) ----

/** 기간 막기. 틀리면 { error }, 되면 막은 기간과 겹친 예약 목록 */
export async function createBlock(input: BlockInput, now = new Date()): Promise<{ error: string } | { block: RoomBlock; conflicts: BlockConflict[] }> {
  if (blocksSource() === 'mock') return mockCreate(input, now)
  // 서버도 같은 규칙으로 막지만, 먼저 걸러 왕복 없이 알려 준다
  const invalid = validateBlock(input, apiView.blocks, now)
  if (invalid) return { error: invalid }
  try {
    const res = await api<{ block: unknown; conflicts: unknown }>('/api/admin/room-blocks', {
      method: 'POST',
      member: currentMemberId(),
      body: JSON.stringify({
        roomId: input.roomId, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(),
        reason: input.reason, memo: input.memo.trim() || null,
      }),
    })
    const block = toBlock(res?.block)
    const conflicts = toConflicts(res?.conflicts)
    setApi({ blocks: [block, ...apiView.blocks.filter((b) => b.id !== block.id)], conflicts: { ...apiView.conflicts, [block.id]: conflicts } })
    return { block, conflicts }
  } catch (e) {
    return { error: message(e) }
  }
}

/** 막은 기간 풀기 (기록은 남긴다). 못 풀었으면 화면에 보일 말 */
export async function releaseBlock(id: number, now = new Date()): Promise<string | null> {
  if (blocksSource() === 'mock') { mockRelease(id, now); return null }
  try {
    const block = toBlock(await api<unknown>(`/api/admin/room-blocks/${id}/release`, { method: 'POST', member: currentMemberId() }))
    const conflicts = Object.fromEntries(Object.entries(apiView.conflicts).filter(([k]) => Number(k) !== id))
    setApi({ blocks: apiView.blocks.map((b) => (b.id === id ? block : b)), conflicts })
    return null
  } catch (e) {
    return message(e)
  }
}

/** 막은 기간과 겹친 예약 (아직 안 지운 것). api는 마지막으로 읽은 목록 */
export function blockConflicts(id: number, now = new Date()): BlockConflict[] {
  if (blocksSource() === 'mock') return mockConflicts(id, now)
  const b = apiView.blocks.find((x) => x.id === id)
  if (!b || !isActive(b, now)) return []
  return apiView.conflicts[id] ?? []
}

/** 관리자가 확인한 뒤 겹친 예약 중 시작 전인 것 취소. 취소한 건수, 못 했으면 { error } */
export async function cancelConflicts(id: number, now = new Date()): Promise<number | { error: string }> {
  if (blocksSource() === 'mock') return mockCancel(id, now)
  try {
    const res = await api<{ canceled?: unknown }>(`/api/admin/room-blocks/${id}/cancel-conflicts`, { method: 'POST', member: currentMemberId() })
    const n = typeof res?.canceled === 'number' ? res.canceled : 0
    // 사용 중인 예약은 남으므로 목록을 다시 읽는다
    try { setApi({ conflicts: { ...apiView.conflicts, [id]: await fetchConflicts(id) } }) } catch { /* 다음 새로 읽기에서 맞춘다 */ }
    return n
  } catch (e) {
    return { error: message(e) }
  }
}

/**
 * 막기 전에 겹칠 예약을 미리 셀 때 쓰는 예약 목록(공지 막기안·휴업안). core에는 관리자용 예약 목록 API가 없어서
 * api일 때는 빈 목록이고, 겹친 예약은 막은 뒤 서버가 돌려준 목록으로 보여 준다
 */
export function previewReservations(now = new Date()): BlockConflict[] {
  if (blocksSource() === 'api') return []
  return liveReservations(get(), now)
}

/** 가짜 기록 처음으로 (mock만) */
export function resetBlocks(): void {
  set(seed(new Date()))
}

/** useSyncExternalStore용: 바뀌지 않았으면 같은 객체를 돌려준다 */
function snapshot(): BlocksView {
  if (blocksSource() === 'api') return apiView
  const s = get()
  if (!mockView || mockView.blocks !== s.blocks || mockView.canceled !== s.canceled) {
    mockView = { source: 'mock', blocks: s.blocks, canceled: s.canceled, conflicts: {}, loaded: true, error: null }
  }
  return mockView
}

/**
 * 화면용: 기록이 바뀌면(막기·풀기·취소) 다시 그린다. load가 true면(관리자 화면) api일 때 목록을 읽는다.
 * 학생 화면은 관리자 API를 부르면 안 되므로 load=false로 쓴다
 */
export function useRoomBlocks(load = true): BlocksView {
  const view = useSyncExternalStore(subscribe, snapshot, snapshot)
  const source = view.source
  useEffect(() => {
    if (!load || source !== 'api') return
    void refreshBlocks()
    // 다른 관리자가 막거나 푼 것도 보이게 1분마다(화면이 보일 때만)
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshBlocks(true) }, 60_000)
    return () => clearInterval(t)
  }, [load, source])
  return view
}

/** 테스트용 */
export function _resetBlocksForTest(source: 'api' | 'mock' | null = null): void {
  state = null
  mockView = null
  sourceOverride = source
  apiView = { source: 'api', blocks: [], canceled: [], conflicts: {}, loaded: false, error: null }
  loadedAt = 0
  inflight = null
}

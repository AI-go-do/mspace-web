import type { AdminReport } from '../api/admin'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { conflictsOf, isActive, type BlockConflict, type RoomBlock } from './roomBlocks'

/**
 * 아픈 방 휴업안 (웹 화면만, 11/8 재웅 승인. 토너먼트 3위 "아픈 방은 스스로 쉰다"를 사람이 누르는 단계로).
 * 한 방에 비품 고장 신고가 짧은 시간에 쌓이면 "이 방을 쉬게 할까요?"를 할 일 맨 위에 올린다.
 * 쉬게 하기는 기간 막기(점검)로 하고, 늘 관리자가 누른다(경고·벌과는 상관없음). 순수 함수만 둔다(시각은 밖에서)
 */
export const REST_RULES = {
  /** 이 시간 안의 신고만 센다 */
  windowHours: 24,
  /** 판정 안 된 비품 고장 신고가 이만큼 쌓이면 제안 */
  minReports: 2,
  /** 제안하는 쉬는 시간 (고치면 관리자가 [막기 풀기]) */
  restHours: 24,
}

/** 방 인원 (요구사항 4장: 1–4번 3–5명, 5번 5–8명). 옆방 옮기기 제안에만 쓴다 */
export const roomCapacity = (roomId: number): [number, number] => (roomId === 5 ? [5, 8] : [3, 5])

export interface MoveHint {
  reservation: BlockConflict
  /** 그 시간에 비어 있고 인원이 맞는 방. 없으면 빈 배열 */
  rooms: number[]
}

export interface RestProposal {
  /** 같은 신고 묶음에는 한 번만 묻는다(새 신고가 오면 다시) */
  key: string
  roomId: number
  reports: AdminReport[]
  startAt: string
  endAt: string
  moves: MoveHint[]
}

const SLOT = 30 * 60_000
const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE

/**
 * 판정 안 된 신고 → 방마다 휴업안. 이미 막혀 있거나 막힐 예정인 방은 뺀다.
 * reservations는 앞으로 잡힌 예약(가짜 단계는 mockReservations), 옆방을 고를 때도 쓴다
 */
export function proposeRests(
  reports: AdminReport[], blocks: RoomBlock[], reservations: BlockConflict[], now: Date, rules = REST_RULES,
): RestProposal[] {
  const since = now.getTime() - rules.windowHours * 3_600_000
  const byRoom = new Map<number, AdminReport[]>()
  for (const r of reports) {
    if (r.category !== 'BROKEN' || r.verdict !== 'OPEN' || Date.parse(r.createdAt) < since) continue
    byRoom.set(r.roomId, [...(byRoom.get(r.roomId) ?? []), r])
  }
  const start = Math.ceil((now.getTime() + 1) / SLOT) * SLOT
  const end = start + rules.restHours * 3_600_000
  const out: RestProposal[] = []
  for (const [roomId, list] of byRoom) {
    if (list.length < rules.minReports) continue
    const blocked = blocks.some((b) => b.roomId === roomId && isActive(b, now)
      && overlaps(start, end, Date.parse(b.startAt), Date.parse(b.endAt)))
    if (blocked) continue
    const sorted = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const window = { roomId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }
    const moves = conflictsOf(window, reservations).map((res) => ({ reservation: res, rooms: freeRooms(res, roomId, blocks, reservations, now) }))
    out.push({ key: `${roomId}:${sorted.map((r) => r.id).join(',')}`, reports: sorted, ...window, moves })
  }
  return out.sort((a, b) => b.reports.length - a.reports.length || a.roomId - b.roomId)
}

/**
 * [아직 괜찮아요]로 넘긴 묶음인가. 넘긴 묶음의 신고 일부가 판정되거나 24시간이 지나 빠져도 다시 묻지 않고,
 * 넘긴 뒤 새 신고가 들어왔을 때만 다시 묻는다(키는 "방:신고id,신고id")
 */
export function isSkipped(p: RestProposal, skippedKeys: string[]): boolean {
  const ids = p.reports.map((r) => String(r.id))
  return skippedKeys.some((k) => {
    const [room, list = ''] = k.split(':')
    if (Number(room) !== p.roomId) return false
    const seen = new Set(list.split(','))
    return ids.every((id) => seen.has(id))
  })
}

/** 그 예약 시간에 비어 있고(예약·막기 없음) 인원이 맞는 다른 방 */
function freeRooms(res: BlockConflict, sick: number, blocks: RoomBlock[], reservations: BlockConflict[], now: Date): number[] {
  const s = Date.parse(res.startAt)
  const e = Date.parse(res.endAt)
  return ADMIN_ROOMS.map((r) => r.roomId).filter((id) => {
    if (id === sick) return false
    const [min, max] = roomCapacity(id)
    if (res.people < min || res.people > max) return false
    if (reservations.some((r) => r.roomId === id && overlaps(s, e, Date.parse(r.startAt), Date.parse(r.endAt)))) return false
    return !blocks.some((b) => b.roomId === id && isActive(b, now) && overlaps(s, e, Date.parse(b.startAt), Date.parse(b.endAt)))
  })
}

/** 예시 신고 (주소에 ?demo=1일 때만). 3번 방에 6시간 안 비품 고장 3건 */
export function demoBrokenReports(now: Date): AdminReport[] {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const r = (id: number, content: string, min: number): AdminReport => ({
    id, roomId: 3, category: 'BROKEN', content, verdict: 'OPEN', reporterReservationId: 900 + id, createdAt: ago(min), judgedAt: null,
  })
  return [r(-31, '의자 다리 하나가 흔들려요', 340), r(-32, '천장 전등이 계속 깜빡여요', 150), r(-33, '모니터 HDMI가 안 잡혀요', 25)]
}

import type { Friend } from '../api/friends'

/**
 * "누구랑 하실 건가요?"에서 고른 친구를 다음 확인 카드까지 들고 간다 (FR-AGT-105).
 * 비서(모델)에는 "나 포함 N명"만 보내고, 누구인지는 이 화면에만 둔다(친구 이름·학번이 외부 AI로 가지 않게).
 * 회원별로 두고, 카드가 한 번 꺼내 쓰면 지운다. 10분이 지나면 버린다(오래된 선택이 엉뚱한 카드에 들어가지 않게)
 */
const TTL_MS = 10 * 60_000
const picked = new Map<number, { friends: Friend[]; at: number }>()

export function savePicked(owner: number | null, friends: Friend[], now = Date.now()): void {
  if (owner === null) return
  picked.set(owner, { friends: [...friends], at: now })
}

/** 고른 친구를 꺼낸다(꺼내면 지움). 없거나 오래됐으면 빈 목록 */
export function takePicked(owner: number | null, now = Date.now()): Friend[] {
  if (owner === null) return []
  const p = picked.get(owner)
  picked.delete(owner)
  if (!p || now - p.at > TTL_MS) return []
  return p.friends
}

/** 카드를 그리기 전에 몇 명 골랐는지 본다(지우지 않음) */
export function peekPicked(owner: number | null, now = Date.now()): Friend[] {
  if (owner === null) return []
  const p = picked.get(owner)
  return p && now - p.at <= TTL_MS ? p.friends : []
}

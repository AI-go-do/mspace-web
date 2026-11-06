import { api, ApiError } from './client'

/**
 * 친구 (FR-RSV-004 변경, core #68). 서로 수락해야 친구이고, 친구만 예약 참여자로 넣을 수 있다.
 * 이름은 가려서 온다(김*영). 시각은 +09:00
 */
export interface Friend {
  studentId: string
  name: string
  since: string
}

/** 받은·보낸 친구 요청 한 줄 */
export interface FriendRequest {
  requestId: number
  studentId: string
  name: string
  requestedAt: string
}

/** GET /api/friends */
export interface FriendList {
  friends: Friend[]
  received: FriendRequest[]
  sent: FriendRequest[]
}

/** 친구 요청 결과. 상대가 먼저 나에게 보내 둔 요청이 있으면 바로 친구(ACCEPTED) */
export interface FriendRequestResult {
  requestId: number
  studentId: string
  name: string
  status: 'PENDING' | 'ACCEPTED'
}

/** 친구 창 (친구·받은 요청·보낸 요청). member를 주면 다른 탭에서 바뀐 회원 토큰으로는 보내지 않는다 */
export function getFriends(signal?: AbortSignal, member?: number | null): Promise<FriendList> {
  return api('/api/friends', { signal, member })
}

/** 학번으로 친구 요청. 없는 학번 404 MEMBER_NOT_FOUND, 나 400 FRIEND_SELF, 이미 친구·이미 보냄 409 */
export function requestFriend(studentId: string, member?: number | null): Promise<FriendRequestResult> {
  return api('/api/friends/requests', { method: 'POST', body: JSON.stringify({ studentId }), member })
}

/** 받은 요청 수락 → 친구 */
export function acceptFriend(requestId: number, member?: number | null): Promise<Friend> {
  return api(`/api/friends/requests/${requestId}/accept`, { method: 'POST', member })
}

/** 받은 요청 거절 (상대는 나중에 다시 보낼 수 있다) */
export function declineFriend(requestId: number, member?: number | null): Promise<void> {
  return api(`/api/friends/requests/${requestId}/decline`, { method: 'POST', member })
}

/** 보낸 요청 취소 */
export function cancelFriendRequest(requestId: number, member?: number | null): Promise<void> {
  return api(`/api/friends/requests/${requestId}/cancel`, { method: 'POST', member })
}

/** 친구 끊기 (양쪽 목록에서 빠짐. 이미 잡은 예약은 그대로) */
export function removeFriend(studentId: string, member?: number | null): Promise<void> {
  return api(`/api/friends/${encodeURIComponent(studentId)}`, { method: 'DELETE', member })
}

/**
 * 학번이 내 친구인지 친구 목록에서 찾는다. 친구가 아니면 404 NOT_FRIEND를 던진다.
 * 예약 참여자 검색은 친구만 보여 준다(아무 학번이나 쳐서 남의 이름을 보지 않게, 재웅 11/6)
 */
export async function findFriend(studentId: string, member?: number | null): Promise<Friend> {
  const { friends } = await getFriends(undefined, member)
  const f = friends.find((x) => x.studentId === studentId)
  if (!f) throw new ApiError(404, 'NOT_FRIEND', '친구 목록에 없는 학번이에요')
  return f
}

/** 학번 앞부분이나 이름 글자로 친구 거르기. 빈 검색어면 전부 */
export function filterFriends(friends: Friend[], query: string): Friend[] {
  const q = query.trim()
  if (!q) return friends
  return friends.filter((f) => f.studentId.startsWith(q) || f.name.includes(q))
}

/** 친구 API 오류를 학생이 읽을 문장으로 */
export function friendErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 시도해 주세요.'
  switch (e.code) {
    case 'MEMBER_NOT_FOUND': return '찾을 수 없는 학번이에요. 학교 메일로 가입한 사람에게만 보낼 수 있어요.'
    case 'FRIEND_SELF': return '나에게는 친구 요청을 보낼 수 없어요.'
    case 'FRIEND_ALREADY': return '이미 친구예요.'
    case 'FRIEND_REQUEST_ALREADY_SENT': return '이미 친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.'
    case 'FRIEND_REQUEST_NOT_FOUND': return '이미 처리된 요청이에요. 목록을 새로 받을게요.'
    case 'FRIEND_NOT_FOUND': return '이미 친구 목록에 없어요.'
    default: return e.message
  }
}

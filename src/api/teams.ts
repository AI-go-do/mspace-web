import { api } from './client'
import type { Friend } from './friends'

/**
 * 내 팀 (FR-AGT-105, 11/9 영준 "팀 A랑 내일 3시"). 비서 서버(agent)에 학생별로 저장하고 core는 그대로다.
 * 모델에는 팀 이름·인원만 가고, 팀원은 화면이 확인 카드에 채운다
 */
export interface TeamMember { studentId: string; name: string }
export interface Team { name: string; members: TeamMember[] }

export const TEAM_NAME_MAX = 12

/** 마지막으로 받은 팀 목록(회원별). 말을 보낼 때 기다리지 않고 "팀 A랑"을 알아보려고 둔다 */
const known = new Map<number, Team[]>()

/** 받아 둔 팀 목록. 아직 모르면 빈 목록 */
export function knownTeams(member: number | null): Team[] {
  return member === null ? [] : known.get(member) ?? []
}

// 학생별 마지막 요청 번호. 늦게 도착한 앞 요청 응답(예: 저장 전에 보낸 GET)이 새 목록을 덮지 않게
const seq = new Map<number, number>()

function nextSeq(member: number | null | undefined): number {
  if (member === null || member === undefined) return 0
  const n = (seq.get(member) ?? 0) + 1
  seq.set(member, n)
  return n
}

function remember(member: number | null | undefined, n: number, r: { teams: Team[] }) {
  if (member !== null && member !== undefined && seq.get(member) === n) known.set(member, r.teams)
  return r
}

export function getTeams(member?: number | null): Promise<{ teams: Team[] }> {
  const n = nextSeq(member)
  return api<{ teams: Team[] }>('/api/agent/teams', { member }).then((r) => remember(member, n, r))
}

/** 같은 이름이면 바꾸고 없으면 추가. 바뀐 전체 목록을 돌려준다 */
export function saveTeam(name: string, members: TeamMember[], member?: number | null): Promise<{ teams: Team[] }> {
  const n = nextSeq(member)
  return api<{ teams: Team[] }>(`/api/agent/teams/${encodeURIComponent(name.trim())}`, { method: 'PUT', body: JSON.stringify({ members }), member })
    .then((r) => remember(member, n, r))
}

export function deleteTeam(name: string, member?: number | null): Promise<void> {
  return api(`/api/agent/teams/${encodeURIComponent(name.trim())}`, { method: 'DELETE', member })
}

/**
 * 학생이 보낸 말에 팀 이름이 들어 있으면 그 팀(가장 긴 이름 우선: "팀 A"와 "팀 AB"가 있으면 "팀 AB").
 * 띄어쓰기는 무시한다("팀A랑" = "팀 A")
 */
export function teamInMessage(message: string, teams: Team[]): Team | null {
  const squash = (s: string) => s.replace(/\s+/g, '')
  const m = squash(message)
  const hits = teams.filter((t) => squash(t.name).length > 0 && m.includes(squash(t.name)))
  if (hits.length === 0) return null
  return hits.reduce((a, b) => (squash(b.name).length > squash(a.name).length ? b : a))
}

/** 팀원을 친구 모양으로(가린 이름 그대로). 지금 친구 목록에 없는 팀원은 빼고 돌려준다 */
export function teamFriends(team: Team, friends: Friend[] | null): Friend[] {
  const now = friends === null ? null : new Set(friends.map((f) => f.studentId))
  return team.members
    .filter((m) => now === null || now.has(m.studentId))
    .map((m) => ({ studentId: m.studentId, name: m.name, since: '' }))
}

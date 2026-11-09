import { describe, expect, it, vi } from 'vitest'
import { getTeams, knownTeams, saveTeam, teamFriends, teamInMessage, type Team } from './teams'

const api = vi.hoisted(() => vi.fn())
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), api }))

const A: Team = { name: '팀 A', members: [{ studentId: '99999002', name: '김*영' }, { studentId: '99999003', name: '박*웅' }] }
const AB: Team = { name: '팀 AB', members: [{ studentId: '99999004', name: '이*연' }] }
const STUDY: Team = { name: '알고리즘 스터디', members: [{ studentId: '99999005', name: '최*수' }] }

describe('teamInMessage 말에서 팀 찾기', () => {
  it('띄어쓰기가 달라도 찾는다', () => {
    expect(teamInMessage('팀A랑 내일 3시에 잡아 줘', [A, STUDY])).toBe(A)
    expect(teamInMessage('알고리즘스터디 내일', [A, STUDY])).toBe(STUDY)
  })
  it('겹치면 더 긴 이름', () => {
    expect(teamInMessage('팀 AB랑 내일', [A, AB])).toBe(AB)
  })
  it('없으면 null', () => {
    expect(teamInMessage('내일 3시 빈방', [A])).toBeNull()
  })
})

describe('teamFriends', () => {
  it('친구 목록에서 빠진 팀원은 뺀다', () => {
    expect(teamFriends(A, [{ studentId: '99999003', name: '박*웅', since: '' }]).map((f) => f.studentId)).toEqual(['99999003'])
  })
  it('친구 목록을 모르면 그대로', () => {
    expect(teamFriends(A, null)).toHaveLength(2)
  })
})

describe('팀 목록 기억', () => {
  it('저장 뒤에 늦게 도착한 앞 GET 응답은 새 목록을 덮지 않는다', async () => {
    // given: GET이 먼저 나가고, 저장(PUT)이 먼저 끝난다
    let finishGet: (v: { teams: Team[] }) => void = () => {}
    api.mockImplementationOnce(() => new Promise((ok) => { finishGet = ok }))
    const saved = [{ name: '팀 A', members: [{ studentId: '99999002', name: '김*영' }] }]
    api.mockImplementationOnce(() => Promise.resolve({ teams: saved }))

    // when
    const pending = getTeams(7)
    await saveTeam('팀 A', saved[0].members, 7)
    finishGet({ teams: [] })
    await pending

    // then
    expect(knownTeams(7)).toEqual(saved)
  })
})

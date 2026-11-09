import { describe, expect, it } from 'vitest'
import { teamFriends, teamInMessage, type Team } from './teams'

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

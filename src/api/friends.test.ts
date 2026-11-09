import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { filterFriends, friendErrorMessage, type Friend } from './friends'

const f = (studentId: string, name: string): Friend => ({ studentId, name, since: '2026-11-06T10:00:00+09:00' })
const list = [f('20230001', '김*영'), f('20230002', '박*수'), f('20241234', '이*')]

describe('친구 거르기 (FR-RSV-004)', () => {
  it('빈 검색어면 친구 전부', () => {
    expect(filterFriends(list, '  ')).toHaveLength(3)
  })
  it('학번 앞부분으로 거른다', () => {
    expect(filterFriends(list, '2023').map((x) => x.studentId)).toEqual(['20230001', '20230002'])
  })
  it('친구가 아닌 학번은 나오지 않는다', () => {
    expect(filterFriends(list, '20239999')).toEqual([])
  })
  it('이름 글자로도 거른다', () => {
    expect(filterFriends(list, '박')).toEqual([list[1]])
  })
})

describe('친구 오류 문구', () => {
  it('아는 code는 해요체 안내로 바꾼다', () => {
    expect(friendErrorMessage(new ApiError(409, 'FRIEND_ALREADY', 'x'))).toBe('이미 친구예요.')
  })
  it('모르는 code는 서버 문구, 네트워크 오류는 연결 안내', () => {
    expect(friendErrorMessage(new ApiError(500, 'X', '서버 문구'))).toBe('서버 문구')
    expect(friendErrorMessage(new TypeError('fetch'))).toContain('연결')
  })
})

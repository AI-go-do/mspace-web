import { describe, expect, it } from 'vitest'
import { peekPicked, savePicked, takePicked } from './pickedFriends'

const f = (id: string) => ({ studentId: id, name: '김*영', since: '' })

describe('pickedFriends 고른 친구를 카드까지', () => {
  it('꺼내면 지워져 두 번째 카드에는 안 들어간다', () => {
    savePicked(1, [f('99999002')], 0)
    expect(peekPicked(1, 0)).toHaveLength(1)
    expect(takePicked(1, 0).map((x) => x.studentId)).toEqual(['99999002'])
    expect(takePicked(1, 0)).toEqual([])
  })
  it('회원마다 따로 둔다', () => {
    savePicked(1, [f('a')], 0)
    expect(takePicked(2, 0)).toEqual([])
    expect(takePicked(1, 0)).toHaveLength(1)
  })
  it('10분이 지나면 버린다', () => {
    savePicked(1, [f('a')], 0)
    expect(takePicked(1, 10 * 60_000 + 1)).toEqual([])
  })
  it('회원을 모르면 저장하지 않는다', () => {
    savePicked(null, [f('a')], 0)
    expect(takePicked(null, 0)).toEqual([])
  })
})

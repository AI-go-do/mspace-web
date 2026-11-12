import { describe, expect, it } from 'vitest'
import type { Friend } from '../api/friends'
import { matchFriends, nameFits } from './friendMatch'

const f = (studentId: string, name: string): Friend => ({ studentId, name, since: '2026-11-06T10:00:00+09:00' })
const KIM = f('99999002', '김*영')
const PARK = f('99999003', '박*웅')
const LEE = f('99999004', '이*연')
const CHOI = f('99999005', '최*영')

describe('nameFits 가린 이름 맞추기', () => {
  it('성+이름은 보이는 글자(성·끝)를 모두 비교한다', () => {
    expect(nameFits('김지영', '김*영')).toBe(true)
    expect(nameFits('박지영', '김*영')).toBe(false)
  })
  it('이름만 말하면 성 뒤 글자들과 비교한다', () => {
    expect(nameFits('지영', '김*영')).toBe(true)
    expect(nameFits('재웅', '김*영')).toBe(false)
  })
  it('보이는 글자가 하나도 비교되지 않으면 맞지 않는다', () => {
    expect(nameFits('민', '이*')).toBe(false)
  })
})

describe('matchFriends 말한 이름 → 친구', () => {
  it('"지영이랑 재웅이 그리고 이수연"을 세 친구로 채운다', () => {
    const r = matchFriends('지영이랑 재웅이 그리고 이수연', [KIM, PARK, LEE])
    expect(r.picked.map((x) => x.studentId)).toEqual(['99999002', '99999003', '99999004'])
    expect(r.ambiguous).toEqual([])
    expect(r.unknown).toEqual([])
  })

  it('끝 글자가 같은 친구가 둘이면 채우지 않고 후보로 돌려준다', () => {
    const r = matchFriends('지영', [KIM, CHOI])
    expect(r.picked).toEqual([])
    expect(r.ambiguous).toEqual([{ spoken: '지영', candidates: [KIM, CHOI] }])
  })

  it('성까지 말하면 둘 중 하나로 정해진다', () => {
    expect(matchFriends('최지영', [KIM, CHOI]).picked).toEqual([CHOI])
  })

  it('친구가 아닌 이름은 채우지 않고 모르는 이름으로 알린다', () => {
    const r = matchFriends('민수랑 지영', [KIM])
    expect(r.picked).toEqual([KIM])
    expect(r.unknown).toEqual(['민수'])
  })

  it('이미 넣은 친구는 다시 고르지 않고 모르는 이름으로도 보지 않는다', () => {
    const r = matchFriends('지영 재웅', [KIM, PARK], ['99999002'])
    expect(r.picked).toEqual([PARK])
    expect(r.unknown).toEqual([])
  })

  it('"나 포함 친구 3명" 같은 덧말·숫자는 무시한다', () => {
    const r = matchFriends('나 포함 친구 3명 재웅', [PARK])
    expect(r.picked).toEqual([PARK])
    expect(r.unknown).toEqual([])
  })
})

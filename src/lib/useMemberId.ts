import { useEffect, useState } from 'react'
import { currentMemberId } from '../api/client'
import { onMemberChange } from '../auth/tokens'

/**
 * 지금 로그인한 회원 번호(모르면 null). 다른 회원 토큰으로 바뀌거나 로그아웃하면 다시 그린다.
 * 회원별 데이터를 보여 주는 화면에 key로 걸면, 바뀌는 순간 앞 사람 데이터와 진행 중 요청을 함께 버린다
 */
export function useMemberId(): number | null {
  const [member, setMember] = useState<number | null>(() => currentMemberId())
  useEffect(() => {
    // 구독한 뒤 다시 읽는다(그 사이 바뀐 값을 놓치지 않게)
    const stop = onMemberChange(() => setMember(currentMemberId()))
    setMember(currentMemberId())
    return stop
  }, [])
  return member
}

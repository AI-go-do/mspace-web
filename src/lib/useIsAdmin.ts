import { useEffect, useState } from 'react'
import { ApiError, currentMemberId } from '../api/client'
import { getReports } from '../api/admin'

/** 회원별로 한 번만 확인한 결과. 화면을 옮겨 다녀도 다시 묻지 않는다 */
const known = new Map<number, boolean>()

/**
 * 관리자인지. 토큰에 역할이 없어서 관리자만 열리는 대기 신고 목록을 한 번 불러 본다(200이면 관리자, 403이면 아님).
 * 모르면(확인 중·네트워크 실패) null. 관리자 화면 링크만 숨기고 보이는 데 쓰며, 권한은 core가 막는다
 */
export function useIsAdmin(): boolean | null {
  const memberId = currentMemberId()
  const [admin, setAdmin] = useState<boolean | null>(() => (memberId === null ? null : known.get(memberId) ?? null))

  useEffect(() => {
    if (memberId === null) return
    const cached = known.get(memberId)
    if (cached !== undefined) { setAdmin(cached); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    getReports('OPEN', ctrl.signal, memberId)
      .then(() => { known.set(memberId, true); setAdmin(true) })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) { known.set(memberId, false); setAdmin(false) }
      })
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [memberId])

  return admin
}

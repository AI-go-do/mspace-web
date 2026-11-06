import { useEffect, useState } from 'react'
import { ApiError, currentMemberId } from '../api/client'
import { getReports } from '../api/admin'

/** 회원별로 확인이 끝난 결과(관리자/아님). 화면을 옮겨 다녀도 다시 묻지 않는다. 실패는 담지 않아 다음에 다시 묻는다 */
const known = new Map<number, boolean>()
/** 확인이 실패(시간 초과·네트워크)했을 때 다시 물어보는 간격 */
const RETRY_MS = 30_000

/**
 * 관리자인지. 토큰에 역할이 없어서 관리자만 열리는 대기 신고 목록을 한 번 불러 본다(200이면 관리자, 403이면 아님).
 * 모르면(확인 중·네트워크 실패) null. 실패하면 화면에 있는 동안 RETRY_MS마다, 그리고 화면이 다시 보일 때 다시 묻는다.
 * 관리자 화면 링크만 숨기고 보이는 데 쓰며, 권한은 core가 막는다
 */
export function useIsAdmin(): boolean | null {
  const memberId = currentMemberId()
  const [admin, setAdmin] = useState<boolean | null>(() => (memberId === null ? null : known.get(memberId) ?? null))

  useEffect(() => {
    if (memberId === null) { setAdmin(null); return }
    const cached = known.get(memberId)
    if (cached !== undefined) { setAdmin(cached); return }
    setAdmin(null)
    let stale = false
    let ctrl: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined

    const check = () => {
      if (stale || ctrl || known.has(memberId)) return
      clearTimeout(retry)
      const mine = new AbortController()
      ctrl = mine
      timer = setTimeout(() => mine.abort(), 15_000)
      getReports('OPEN', mine.signal, memberId)
        .then(() => { known.set(memberId, true); if (!stale) setAdmin(true) })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 403) { known.set(memberId, false); if (!stale) setAdmin(false); return }
          // 모름: 링크는 숨긴 채로 두고 잠시 뒤 다시 묻는다
          if (!stale) retry = setTimeout(check, RETRY_MS)
        })
        .finally(() => { clearTimeout(timer); if (ctrl === mine) ctrl = null })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }

    check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stale = true
      clearTimeout(timer)
      clearTimeout(retry)
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [memberId])

  return admin
}

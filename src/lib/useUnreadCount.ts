import { useEffect, useState } from 'react'
import { currentMemberId } from '../api/client'
import { getUnreadCount, UNREAD_CHANGED } from '../api/notifications'

const POLL_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 안 읽은 알림 개수 (홈 종 버튼 점, core #69). 1분마다, 화면으로 돌아올 때, 알림함에서 읽음으로 바꿨을 때 다시 센다.
 * 모르면(아직 못 받음·실패·로그인 전) null. 요청은 한 번에 하나, 새로 시작하면 앞 요청을 끊는다
 */
export function useUnreadCount(): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let current: AbortController | null = null
    const load = () => {
      if (document.visibilityState !== 'visible') return
      // 다른 탭에서 다른 회원으로 바뀌면 api가 막는다. 토큰이 아직 없으면 다음 확인을 기다린다
      const memberId = currentMemberId()
      if (memberId === null) return
      current?.abort()
      const ctrl = new AbortController()
      current = ctrl
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      getUnreadCount(ctrl.signal, memberId)
        .then((r) => { if (current === ctrl) setCount(r.count) })
        // 실패하면 점을 숨긴다(틀린 숫자를 남기지 않게)
        .catch(() => { if (current === ctrl && !ctrl.signal.aborted) setCount(null) })
        .finally(() => { clearTimeout(timer); if (current === ctrl) current = null })
    }
    load()
    const t = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', load)
    window.addEventListener(UNREAD_CHANGED, load)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', load)
      window.removeEventListener(UNREAD_CHANGED, load)
      current?.abort()
      current = null
    }
  }, [])

  return count
}

import { useCallback, useEffect, useState } from 'react'
import { pickApology } from '../api/apology'
import { currentMemberId, onSessionEnd } from '../api/client'
import { announceUnreadChanged, getMyNotifications, markNotificationRead, UNREAD_CHANGED, type AppNotification } from '../api/notifications'

const POLL_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 홈 맨 위 "방의 사과" 카드에 띄울 알림 하나 (Q-19). 1분마다, 화면으로 돌아올 때, 알림함에서 읽었을 때 다시 받는다.
 * 회원이 바뀌면(같은 브라우저 다른 탭에서 다른 학생이 로그인) 앞 사람 사과를 지운다. close는 읽음으로 보내고 카드를 바로 내린다
 */
export function useApology(): { apology: AppNotification | null; close: (id: number) => void } {
  const [state, setState] = useState<{ member: number; list: AppNotification[] } | null>(null)
  // 이 화면에서 닫은 사과. 서버에 읽음이 닿기 전에 받은 목록이 카드를 되살리지 않게. 보내기에 실패하면 빼서 다시 보이게 한다
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    let current: AbortController | null = null
    // 지금 보이는 목록이 누구의 것인지
    let shownFor: number | null = null
    const clear = () => {
      current?.abort()
      current = null
      shownFor = null
      setHidden(new Set())
      setState(null)
    }
    const load = () => {
      if (document.visibilityState !== 'visible') return
      const memberId = currentMemberId()
      if (memberId === null) return
      current?.abort()
      const ctrl = new AbortController()
      current = ctrl
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      getMyNotifications(ctrl.signal, memberId)
        .then((list) => {
          if (current !== ctrl) return
          // 기다리는 사이 회원이 바뀌었으면 이 목록은 버린다
          if (currentMemberId() !== memberId) return clear()
          if (shownFor !== null && shownFor !== memberId) setHidden(new Set())
          shownFor = memberId
          setState({ member: memberId, list })
        })
        // 못 받으면 보이던 카드는 그대로 둔다(사과는 급한 일이 아니라 다음 확인을 기다린다)
        .catch(() => undefined)
        .finally(() => { clearTimeout(timer); if (current === ctrl) current = null })
    }
    load()
    const t = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', load)
    window.addEventListener(UNREAD_CHANGED, load)
    const stopSession = onSessionEnd(clear)
    return () => {
      stopSession()
      clearInterval(t)
      document.removeEventListener('visibilitychange', load)
      window.removeEventListener(UNREAD_CHANGED, load)
      current?.abort()
      current = null
    }
  }, [])

  const close = useCallback((id: number) => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setHidden((h) => new Set(h).add(id))
    markNotificationRead(id, memberId)
      .then(announceUnreadChanged)
      .catch(() => setHidden((h) => { const next = new Set(h); next.delete(id); return next }))
  }, [])

  // 목록 주인이 지금 회원일 때만 보여 준다(바뀐 직후 앞 사람 사과가 남지 않게)
  const mine = state !== null && state.member === currentMemberId()
  return { apology: mine ? pickApology(state.list, hidden) : null, close }
}

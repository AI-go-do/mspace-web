import { useCallback, useEffect, useRef, useState } from 'react'
import { currentMemberId, onSessionEnd } from '../api/client'
import { addWait, cancelWait, declineOffer, getMyOffers, getMyWaits, relayOn, type RelayOffer, type RelayWait } from '../api/relay'

const POLL_MS = 15_000
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 홈 맨 위 "빈방 릴레이" 카드에 띄울, 나에게 넘어온 칸 하나(Q-18). 15초마다, 화면으로 돌아올 때 다시 받는다.
 * 회원이 바뀌면 앞 사람 것을 지운다. 받을 시간이 지난 것은 화면이 바로 내린다(다음 조회를 기다리지 않게)
 */
export function useRelayOffer(now: Date): { offer: RelayOffer | null; decline: (id: number) => void } {
  const [state, setState] = useState<{ member: number; list: RelayOffer[] } | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    if (!relayOn()) return
    let current: AbortController | null = null
    const clear = () => { current?.abort(); current = null; setState(null) }
    const load = () => {
      if (document.visibilityState !== 'visible') return
      const memberId = currentMemberId()
      if (memberId === null) return
      current?.abort()
      const ctrl = new AbortController()
      current = ctrl
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      getMyOffers(memberId, ctrl.signal)
        .then((list) => {
          if (current !== ctrl) return
          if (currentMemberId() !== memberId) return clear()
          setState({ member: memberId, list })
        })
        .catch(() => undefined)
        .finally(() => { clearTimeout(timer); if (current === ctrl) current = null })
    }
    load()
    const t = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', load)
    const stop = onSessionEnd(clear)
    return () => {
      stop()
      clearInterval(t)
      document.removeEventListener('visibilitychange', load)
      current?.abort()
    }
  }, [])

  const decline = useCallback((id: number) => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setHidden((h) => new Set(h).add(id))
    declineOffer(memberId, id).catch(() => setHidden((h) => { const next = new Set(h); next.delete(id); return next }))
  }, [])

  const mine = state !== null && state.member === currentMemberId()
  const offer = mine
    ? state.list
      .filter((o) => !hidden.has(o.id) && Date.parse(o.expiresAt) > now.getTime())
      .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0] ?? null
    : null
  return { offer, decline }
}

/** 예약 화면의 내 기다리기 목록과 걸기·그만두기. 릴레이가 꺼져 있으면 늘 빈 목록 */
export function useWaits(): {
  waits: RelayWait[]
  add: (roomId: number, startAt: string, endHint: string) => Promise<void>
  cancel: (id: number) => Promise<void>
} {
  const [state, setState] = useState<{ member: number; list: RelayWait[] } | null>(null)
  // 겹친 다시 받기 중 마지막 요청만 반영한다(늦게 온 옛 목록이 방금 건·그만둔 기다리기를 되돌리지 않게)
  const seq = useRef(0)

  const reload = useCallback(() => {
    const memberId = currentMemberId()
    if (memberId === null || !relayOn()) return Promise.resolve()
    const mine = ++seq.current
    return getMyWaits(memberId).then((list) => {
      if (mine === seq.current && currentMemberId() === memberId) setState({ member: memberId, list })
    })
  }, [])

  useEffect(() => { reload().catch(() => undefined) }, [reload])

  const add = useCallback(async (roomId: number, startAt: string, endHint: string) => {
    const memberId = currentMemberId()
    if (memberId === null) throw new Error('다시 로그인해 주세요')
    await addWait(memberId, roomId, startAt, endHint)
    // 걸기는 이미 됐다. 목록 다시 받기가 실패해도 실패로 알리지 않는다(다시 눌러 두 번 걸지 않게)
    await reload().catch(() => undefined)
  }, [reload])

  const cancel = useCallback(async (id: number) => {
    const memberId = currentMemberId()
    if (memberId === null) return
    await cancelWait(memberId, id)
    await reload().catch(() => undefined)
  }, [reload])

  const mine = state !== null && state.member === currentMemberId()
  return { waits: mine ? state.list : [], add, cancel }
}

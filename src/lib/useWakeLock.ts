import { useEffect } from 'react'

/** 브라우저의 화면 켜 두기(Screen Wake Lock). 없는 브라우저(예전 iOS)에서는 아무것도 안 한다 */
type Lock = { readonly released: boolean; release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void }
type WakeLockApi = { request(type: 'screen'): Promise<Lock> }

/**
 * on인 동안 폰 화면이 꺼지지 않게 한다(문 앞에서 QR을 보여 주는 동안). 화면이 사라지거나 on이 꺼지면 푼다.
 * 탭을 숨기면 브라우저가 알아서 풀므로, 다시 보일 때 한 번 더 잡는다. 실패(저전력 모드 등)는 조용히 넘긴다
 */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined') return
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!api) return
    let lock: Lock | null = null
    let pending = false
    let alive = true
    const grab = () => {
      // 이미 잡고 있거나 잡는 중이면 또 요청하지 않는다(두 개가 겹치면 하나가 안 풀린 채 남는다)
      if (!alive || pending || (lock && !lock.released) || document.visibilityState !== 'visible') return
      pending = true
      api.request('screen').then((l) => {
        pending = false
        if (l.released) return
        if (!alive || (lock && !lock.released)) {
          void l.release().catch(() => {})
          return
        }
        lock = l
        // 브라우저가 먼저 풀면(탭 숨김 등) 비워 두어 다음 grab이 다시 잡을 수 있게
        l.addEventListener('release', () => { if (lock === l) lock = null })
      }).catch(() => { pending = false /* 저전력 모드·권한 없음: 그냥 꺼지게 둔다 */ })
    }
    grab()
    document.addEventListener('visibilitychange', grab)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', grab)
      void lock?.release().catch(() => {})
      lock = null
    }
  }, [on])
}

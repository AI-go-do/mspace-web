import { useEffect } from 'react'

/** 브라우저의 화면 켜 두기(Screen Wake Lock). 없는 브라우저(예전 iOS)에서는 아무것도 안 한다 */
type Lock = { release(): Promise<void> }
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
    let alive = true
    const grab = () => {
      if (!alive || document.visibilityState !== 'visible') return
      api.request('screen').then((l) => {
        if (alive) lock = l
        else void l.release()
      }).catch(() => { /* 저전력 모드·권한 없음: 그냥 꺼지게 둔다 */ })
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

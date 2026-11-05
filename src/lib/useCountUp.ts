import { useEffect, useRef, useState } from 'react'

/** 0→1 사이 진행을 끝에서 부드럽게 멈추는 곡선 */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3)

/**
 * 숫자가 바뀌면 앞 값에서 새 값까지 짧게 세어 올라간다(홈 "빈 방 N개").
 * 같은 값으로 다시 그려지면(1분마다 새로 받기) 움직이지 않는다. "동작 줄이기"를 켰으면 바로 새 값.
 * 화면 읽기 프로그램용 글은 이 값이 아니라 목표 값을 쓴다
 */
export function useCountUp(target: number | null, ms = 650): number | null {
  const [shown, setShown] = useState(target === null ? null : 0)
  const from = useRef(0)
  useEffect(() => {
    if (target === null) return
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = from.current
    if (reduce || start === target || typeof requestAnimationFrame !== 'function') {
      from.current = target
      setShown(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = easeOutCubic((now - t0) / ms)
      setShown(Math.round(start + (target - start) * p))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = target
    }
  }, [target, ms])
  return target === null ? null : (shown ?? 0)
}

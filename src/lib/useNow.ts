import { useEffect, useRef, useState } from 'react'

/** ms마다 바뀌는 지금 시각 (남은 시간·마감 표시용) */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  const first = useRef(true)
  useEffect(() => {
    // 간격이 바뀌면(예: 취소 마감이 지나 1초→30초) 그 순간 시각을 바로 새로 잡는다.
    // 안 그러면 마감 전 시각이 다음 30초까지 남아 지난 버튼이 보일 수 있다
    if (first.current) first.current = false
    else setNow(new Date())
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

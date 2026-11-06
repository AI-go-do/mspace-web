import { useEffect, useState } from 'react'

/** ms마다 바뀌는 지금 시각 (남은 시간·마감 표시용) */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

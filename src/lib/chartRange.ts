import { useCallback, useState } from 'react'
import { CHART_RANGES, ENV_RULES, type ChartRange } from '../config/adminRooms'

const KEY = 'mspace.admin.chartRange'

function read(): ChartRange {
  try {
    const n = Number(localStorage.getItem(KEY))
    return (CHART_RANGES as readonly number[]).includes(n) ? (n as ChartRange) : (ENV_RULES.historyMinutes as ChartRange)
  } catch {
    return ENV_RULES.historyMinutes as ChartRange
  }
}

/** 관리자 그래프 범위(분). 고른 값은 이 브라우저에 기억한다(못 쓰면 기본 1시간) */
export function useChartRange() {
  const [range, setRange] = useState<ChartRange>(read)
  const choose = useCallback((r: ChartRange) => {
    setRange(r)
    try { localStorage.setItem(KEY, String(r)) } catch { /* 저장 못 해도 이번 화면에서는 바뀐다 */ }
  }, [])
  return [range, choose] as const
}

export const rangeLabel = (m: number) => (m < 60 ? `${m}분` : `${m / 60}시간`)

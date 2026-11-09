import type { CSSProperties } from 'react'
import { CHART_RANGES, type ChartRange } from '../config/adminRooms'
import { rangeLabel } from '../lib/chartRange'

/** 그래프 범위 단추 [10분 · 30분 · 1시간 · 2시간]. 전체 분석·방별 센서·방 상세가 같은 값을 쓴다 */
export function ChartRangeSeg({ value, onChange }: { value: ChartRange; onChange: (r: ChartRange) => void }) {
  return (
    <div className="ov-seg rg-seg" role="group" aria-label="그래프 범위" style={{ '--i': CHART_RANGES.indexOf(value) } as CSSProperties}>
      <span className="ov-seg-glow" aria-hidden="true" />
      {CHART_RANGES.map((r) => (
        <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(r)}>{rangeLabel(r)}</button>
      ))}
    </div>
  )
}

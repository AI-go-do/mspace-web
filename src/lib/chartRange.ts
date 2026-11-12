/** 관제 화면 그래프 위아래 끝 정하기. 방 칸 작은 그래프와 다섯 방 한 그래프가 같이 쓴다 */
export type ChartMetric = 'co2' | 'temp' | 'hum' | 'light'

/** 작은 그래프가 적어도 보여 줄 폭. 이보다 좁게 확대하면 센서 잡음이 큰 출렁임처럼 보인다 */
const MIN_SPAN: Record<ChartMetric, number> = { co2: 160, temp: 1.6, hum: 8, light: 100 }

/**
 * 그래프 위아래 끝. 값 둘레로 확대해 1초마다 움직이는 게 보이게 한다(재웅 11/12 "심심한 그래프 싫음, 진짜 실시간 차트 느낌").
 * 기준(CO2 1000 등)이 가까워지면 그때부터 기준선이 같이 보이게 넓힌다. 여섯째 칸 다섯 방 한 그래프도 같은 규칙을 쓴다(다섯 방 값을 함께 넣어 같은 눈금)
 */
export function rangeOf(m: ChartMetric, values: number[], limit: number): [number, number] {
  if (m === 'light') return [0, 100]
  const span = MIN_SPAN[m]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.15, span * 0.1)
  lo -= pad
  hi += pad
  if (hi - lo < span) {
    const mid = (hi + lo) / 2
    lo = mid - span / 2
    hi = mid + span / 2
  }
  // 기준까지 그래프 높이의 절반 안이면 기준선이 보이게 넓힌다(습도는 아래 기준)
  const h = hi - lo
  if (m === 'hum') { if (lo - limit < h * 0.5) lo = Math.min(lo, limit - h * 0.08) }
  else if (limit - hi < h * 0.5) hi = Math.max(hi, limit + h * 0.08)
  if (m === 'co2' && lo < 380) { hi += 380 - lo; lo = 380 }
  return [lo, hi]
}

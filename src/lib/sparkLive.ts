/**
 * 방 칸 작은 그래프의 "실시간" 점(재웅 11/12 "센서 값이 몇 초마다 움직이는 걸 보고 싶다").
 * 분 기록만 그리면 1분 동안 선이 그대로라, 초 단위로 밀려온 값을 시각 축에 이어 붙인다.
 * 초 값이 시작된 뒤의 분 기록은 초 값으로 갈음한다(AdminOverview 큰 그래프와 같은 방식).
 */
export interface SparkTick { t: number; co2: number | null; temp: number | null; hum: number | null }
export type SparkMetric = 'co2' | 'temp' | 'hum' | 'light'
export interface SparkPt { t: number; v: number | null }

/** 작은 그래프가 보여 주는 지난 시간. 짧게 잡아 1초마다 선이 옆으로 흐르고 흔들림이 보이게 */
export const SPARK_PAST_MS = 10 * 60_000

const pick = (k: SparkTick, m: SparkMetric) => (m === 'co2' ? k.co2 : m === 'temp' ? k.temp : m === 'hum' ? k.hum : null)

/** 초 값이 2개 이상 있으면 [지금-pastMs, 지금] 구간의 점(빈 분은 v=null로 선을 끊음). 없으면 null(분 기록 그래프 그대로) */
export function sparkPoints(times: string[], past: (number | null)[], ticks: SparkTick[] | undefined, metric: SparkMetric,
  now: number, pastMs = SPARK_PAST_MS): SparkPt[] | null {
  if (metric === 'light' || !ticks) return null
  const from = now - pastMs
  const live = ticks.filter((k) => k.t >= from && k.t <= now + 5_000 && pick(k, metric) !== null)
  if (live.length < 2) return null
  const cut = live[0].t
  const out: SparkPt[] = []
  past.forEach((v, i) => {
    const t = Date.parse(times[i] ?? '')
    if (!Number.isFinite(t) || t < from - 60_000 || t >= cut) return
    out.push({ t, v })
  })
  for (const k of live) out.push({ t: k.t, v: pick(k, metric) })
  return out
}

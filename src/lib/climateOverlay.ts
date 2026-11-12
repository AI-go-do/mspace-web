import type { ClimateRoom, MetricKey, Series } from '../api/climate'
import type { EnvPoint, RoomsEnvironment } from '../api/environment'

/**
 * core 방 환경(재실·조도·문·예약)에 climate 공기 값(CO2·온도·습도·예측)을 얹는다 (재웅 11/12 "디자인은 기존 그대로").
 * - 지금 값과 1분 그래프의 CO2·온도·습도는 climate 값이 있으면 그것으로 바꾼다. 없는 분은 core 값을 둔다
 * - core 그래프 끝보다 뒤에 밀려온 climate 값은 새 분 점으로 붙인다(10초 조회를 기다리지 않게)
 * - 예측(점선)은 climate CO2 예측
 * climate에 없는 방은 그대로 둔다
 */
type SeriesMap = Record<number, Partial<Record<MetricKey, Series>>>

const minuteOf = (iso: string) => Math.floor(Date.parse(iso) / 60_000)

export function overlayClimate(env: RoomsEnvironment, rooms: ClimateRoom[], series: SeriesMap): RoomsEnvironment {
  return {
    ...env,
    rooms: env.rooms.map((r) => {
      const c = rooms.find((x) => x.roomId === r.roomId)
      if (!c) return r
      const per = series[r.roomId] ?? {}
      const byMin = new Map<number, { ppm?: number; t?: number; h?: number }>()
      const put = (k: MetricKey, field: 'ppm' | 't' | 'h') => {
        for (const p of per[k]?.points ?? []) {
          const m = minuteOf(p.at)
          byMin.set(m, { ...byMin.get(m), [field]: p.value })
        }
      }
      put('CO2', 'ppm')
      put('TEMPERATURE', 't')
      put('HUMIDITY', 'h')
      const seen = new Set<number>()
      const merged: EnvPoint[] = r.series.map((p) => {
        const m = minuteOf(p.at)
        seen.add(m)
        const v = byMin.get(m)
        if (!v) return p
        return {
          ...p,
          ppm: v.ppm !== undefined ? Math.round(v.ppm) : p.ppm,
          temperatureC: v.t ?? p.temperatureC,
          humidityPct: v.h ?? p.humidityPct,
        }
      })
      const last = r.series.length ? minuteOf(r.series[r.series.length - 1].at) : -Infinity
      const extra = [...byMin.entries()].filter(([m]) => m > last && !seen.has(m)).sort((a, b) => a[0] - b[0])
      for (const [m, v] of extra) {
        merged.push({ at: new Date(m * 60_000).toISOString(), ppm: v.ppm !== undefined ? Math.round(v.ppm) : null, temperatureC: v.t ?? null, humidityPct: v.h ?? null })
      }
      // 앞쪽을 잘라 길이를 그대로 둔다(그래프 칸 수가 늘지 않게)
      const series2 = r.series.length ? merged.slice(Math.max(0, merged.length - r.series.length)) : merged
      const co2 = c.metrics.CO2
      const fc = per.CO2?.forecast ?? []
      return {
        ...r,
        // core 값이 더 새것이면 core 값을 둔다
        co2: co2?.value != null && co2.at && (!r.co2 || Date.parse(co2.at) >= Date.parse(r.co2.at)) ? { ppm: Math.round(co2.value), at: co2.at } : r.co2,
        temperatureC: c.metrics.TEMPERATURE?.value ?? r.temperatureC,
        humidityPct: c.metrics.HUMIDITY?.value ?? r.humidityPct,
        series: series2,
        forecast: fc.length ? fc.map((p) => ({ at: p.at, ppm: Math.round(p.value) })) : r.forecast,
        // 가상 센서(SIM) 방은 climate가 받은 재실(core 실제 예약·입실)을 그대로 써서 칸의 "있음/없음"과 입실 시각이 서로 다르지 않게
        ...(c.source === 'SIM' && c.occupied !== null ? { presence: c.occupied ? 'OCCUPIED' as const : 'EMPTY' as const } : {}),
      }
    }),
  }
}

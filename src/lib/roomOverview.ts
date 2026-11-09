import { ENV_RULES, type EnvRules } from '../config/adminRooms'
import type { RoomView } from './roomHealth'

/**
 * 관제실 "전체 실시간 분석" 계산. 방 1~5를 한 판에 놓고 비교할 숫자만 뽑는다(화면과 따로 두어 시험한다).
 *  - 평균·가장 높은 방 CO2 (값이 있는 방만)
 *  - 환기 순서: 이미 넘은 방 → 넘을 때가 가까운 방 → 15분 뒤 예측이 높은 방
 *  - 방마다 지난 시간 동안 기준을 넘은 분, 15분 뒤 예측 값
 *  - 열지도 칸: 분마다 단계(0 낮음 ~ 3 기준 가까움, 4 넘음, null 값 없음)
 */
export type Level = 0 | 1 | 2 | 3 | 4

export interface RoomOverviewRow {
  roomId: number
  name: string
  co2: number | null
  /** 지난 시간 중 기준 이상이었던 분 */
  overMinutes: number
  /** 15분 뒤 예측(없으면 null) */
  later: number | null
  etaMinutes: number | null
  over: boolean
  /** 지난 값 + 예측 칸(예측 칸은 past 뒤에 이어 붙는다) */
  past: (Level | null)[]
  ahead: Level[]
}

export interface Overview {
  /** 값이 있는 방 수 */
  measured: number
  avg: number | null
  top: { roomId: number; co2: number } | null
  /** 기준을 이미 넘었거나 warnWithinMinutes(15분) 안에 넘을 방 */
  soon: number
  /** 환기 먼저 볼 방 순서 (괜찮은 방은 빠진다) */
  order: { roomId: number; why: string }[]
  rows: RoomOverviewRow[]
}

/** 끊김·센서 멈춤인 방은 값을 믿지 않는다(평균·열지도·그래프 모두 같은 기준) */
export const isTrusted = (v: RoomView) => !v.flags.offline && !v.flags.stuck

/** CO2 값 하나의 단계. 기준 앞 200ppm부터 "가까움" */
export function levelOf(ppm: number | null, rules: EnvRules = ENV_RULES): Level | null {
  if (ppm === null) return null
  const limit = rules.co2LimitPpm
  if (ppm >= limit) return 4
  if (ppm >= limit - 200) return 3
  if (ppm >= limit - 350) return 2
  if (ppm >= limit - 450) return 1
  return 0
}

export function overview(views: readonly RoomView[], rules: EnvRules = ENV_RULES): Overview {
  const limit = rules.co2LimitPpm
  const rows: RoomOverviewRow[] = views.map((v) => {
    // 끊김·센서 멈춤인 방은 지난 값을 믿을 수 없어 넘은 분·열지도를 비워 둔다
    const trusted = isTrusted(v)
    const past = trusted ? v.history.map((p) => levelOf(p, rules)) : v.history.map(() => null)
    return {
      roomId: v.roomId,
      name: v.name,
      co2: trusted ? v.co2 : null,
      overMinutes: trusted ? v.history.filter((p) => p !== null && p >= limit).length : 0,
      later: v.forecast.length ? v.forecast[v.forecast.length - 1] : null,
      etaMinutes: v.etaMinutes,
      over: trusted && v.flags.co2Over,
      past,
      ahead: v.forecast.map((p) => levelOf(p, rules) as Level),
    }
  })
  const measured = rows.filter((r) => r.co2 !== null)
  const avg = measured.length ? Math.round(measured.reduce((s, r) => s + (r.co2 as number), 0) / measured.length) : null
  const top = measured.reduce<{ roomId: number; co2: number } | null>(
    (best, r) => (best === null || (r.co2 as number) > best.co2 ? { roomId: r.roomId, co2: r.co2 as number } : best), null)

  const rank = (r: RoomOverviewRow) => (r.over ? -1000 + -(r.co2 ?? 0) / 1000 : r.etaMinutes ?? 1000)
  const order = rows
    .filter((r) => r.over || (r.etaMinutes !== null && r.etaMinutes <= rules.warnWithinMinutes))
    .sort((a, b) => rank(a) - rank(b))
    .map((r) => ({ roomId: r.roomId, why: r.over ? `지금 ${r.co2} · 기준 넘음` : `${r.etaMinutes}분 뒤 ${limit} 넘음` }))

  return { measured: measured.length, avg, top, soon: order.length, order, rows }
}

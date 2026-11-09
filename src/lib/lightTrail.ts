import type { RoomsEnvironment } from '../api/environment'

/**
 * core가 조도를 최신 값 하나만 줄 때(분마다의 series[].light가 없을 때) 화면이 받은 값을 모아
 * 조도 그래프를 그린다. 10초마다 받은 값 중 그 분의 마지막 값을 그 분 칸에 넣는다.
 * 화면을 연 뒤부터만 쌓이고(탭을 옮겨도 남음), 새로 고치면 처음부터다. core가 분별 값을 주면 이 함수는 아무것도 안 한다.
 */

export interface TrailSample { minute: number; light: number | null; occupied: boolean | null }
/** 방 번호 → 분마다 마지막 값 (오래된 것이 앞) */
export type LightTrail = Map<number, TrailSample[]>

const MIN = 60_000
const minuteOf = (iso: string) => Math.floor(new Date(iso).getTime() / MIN)
/** 조도 측정 시각(lightAt)이 이만큼(분) 넘게 지났으면 그 값을 지금 분의 새 값으로 쌓지 않는다. 장치는 10초마다 보낸다 */
export const LIGHT_STALE_MINUTES = 2

/** 관리자 탭을 옮겼다 돌아와도 모은 값이 남게 화면 밖에 둔다. 로그인한 사람마다 따로 */
const trails = new Map<number, LightTrail>()
export function trailFor(memberId: number): LightTrail {
  let t = trails.get(memberId)
  if (!t) { t = new Map(); trails.set(memberId, t) }
  return t
}

/** 이 응답을 trail에 쌓고, series에 조도·재실이 비어 있으면 trail 값으로 채운 응답을 돌려준다 */
export function withLightTrail(data: RoomsEnvironment, trail: LightTrail, keepMinutes: number): RoomsEnvironment {
  const nowMinute = minuteOf(data.now)
  return {
    ...data,
    rooms: data.rooms.map((r) => {
      // core가 분별 조도를 이미 주면 손대지 않는다
      if (r.series.some((p) => p.light !== undefined)) return r
      // 조도 보고가 끊긴 채 같은 값이 계속 오면, 측정하지 않은 분을 그 값으로 채우지 않는다
      const fresh = !r.lightAt || nowMinute - minuteOf(r.lightAt) <= LIGHT_STALE_MINUTES
      const light = fresh ? r.light ?? null : null
      const occupied = r.presence === 'UNKNOWN' ? null : r.presence === 'OCCUPIED'
      const list = (trail.get(r.roomId) ?? []).filter((s) => s.minute > nowMinute - keepMinutes)
      // 조도 값이 한 번도 안 왔으면 쌓지 않는다(조도 센서 없는 방은 "센서 없음/값 없음" 그대로)
      if (light !== null || list.length) {
        // 최신 값은 지금 분의 값으로 본다(장치가 10초마다 보내서, 값이 그대로면 시각만 늦게 바뀐다)
        const sample = { minute: nowMinute, light, occupied }
        const last = list[list.length - 1]
        if (last && last.minute === sample.minute) list[list.length - 1] = sample
        else if (!last || last.minute < sample.minute) list.push(sample)
      }
      trail.set(r.roomId, list)
      if (!list.length) return r
      const byMinute = new Map(list.map((s) => [s.minute, s]))
      return {
        ...r,
        series: r.series.map((p) => {
          const s = byMinute.get(minuteOf(p.at))
          return s ? { ...p, light: s.light, occupied: p.occupied ?? s.occupied } : p
        }),
      }
    }),
  }
}

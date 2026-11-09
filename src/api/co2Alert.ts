import { CLIMATE_RULES } from '../config/appliances'
import { ENV_RULES } from '../config/adminRooms'
import type { RoomView } from '../lib/roomHealth'
import type { AppNotification } from './notifications'

/**
 * "숨 막히기 N분 전" 알림 (11/9 재웅: 창문은 자동으로 못 여니 알림으로 알린다).
 * 입실한 예약 방의 CO2가 곧 기준을 넘을 것 같거나 넘으면, 그 예약 대표자의 알림함(종 모양)에 한 번 넣는다.
 * 한 예약에 최대 2번: 처음 한 번, 창문을 열어 내려갔다가 10분 넘게 괜찮은 뒤 다시 오를 때 한 번. 그 뒤로는 화면 카드로만 보인다.
 *
 * 지금은 예시 화면(?demo=1)에서 이 탭 안에만 쌓는다. 실제로는 core가 센서 값을 받을 때 같은 규칙으로 알림(CO2_SOON)을 만들고,
 * 앱을 닫아도 오게 하는 웹 푸시는 회의 안건이다(core-API-초안.md)
 */
export const CO2_ALERT_KIND = 'CO2_SOON'

export const isCo2Alert = (n: AppNotification) => n.kind === CO2_ALERT_KIND

/** 예약 하나의 알림 기록. armed: 지금 경고가 뜨면 보낼 수 있는지. clearSince: 경고가 사라진 시각 */
export interface Co2Track { sent: number; armed: boolean; clearSince: number | null }

const FRESH: Co2Track = { sent: 0, armed: true, clearSince: null }

/** 경고가 떠 있는지(urgent)를 받아 다음 기록과 지금 알림을 보낼지를 정한다. 저장소를 건드리지 않는 순수 함수 */
export function stepCo2Alert(t: Co2Track | undefined, urgent: boolean, now: number, rules = CLIMATE_RULES): { track: Co2Track; fire: boolean } {
  const cur = t ?? FRESH
  const clearSince = urgent ? cur.clearSince : (cur.clearSince ?? now)
  // 경고가 사라진 뒤 충분히 괜찮았으면 다시 보낼 수 있다(다시 오르는 그 순간까지 센다)
  const armed = cur.armed || (clearSince !== null && now - clearSince >= rules.co2AlertRearmMinutes * 60_000)
  if (!urgent) return { track: { sent: cur.sent, armed, clearSince }, fire: false }
  const fire = armed && cur.sent < rules.co2AlertMax
  return { track: { sent: cur.sent + (fire ? 1 : 0), armed: fire ? false : armed, clearSince: null }, fire }
}

/** 알림 제목·본문. nth는 이 예약에서 몇 번째 알림인지(1부터) */
export function co2AlertText(v: Pick<RoomView, 'name' | 'co2' | 'etaMinutes' | 'flags'>, nth: number): { title: string; body: string } {
  const again = nth > 1 ? '다시 ' : ''
  const limit = ENV_RULES.co2LimitPpm
  const title = v.flags.co2Over
    ? `${v.name}: CO2가 ${again}기준을 넘었어요`
    : `${v.name}: ${again}숨 막히기 ${v.etaMinutes}분 전`
  const now = v.co2 !== null ? `지금 CO2 ${v.co2}ppm이에요. ` : ''
  const ahead = v.flags.co2Over ? '졸리고 머리가 아파지기 쉬워요. ' : `약 ${v.etaMinutes}분 뒤 ${limit}ppm을 넘을 것 같아요. `
  const last = nth >= CLIMATE_RULES.co2AlertMax ? ' 이번 예약에서 알림은 이게 마지막이고, 그 뒤로는 홈 카드에만 보여요.' : ''
  return { title, body: `${now}${ahead}창문을 조금 열어 주세요. 창문은 자동으로 못 열어서 알려 드려요.${last}` }
}

// ---- 예시 데이터 (주소에 ?demo=1일 때만). core가 CO2_SOON 알림을 만들면 이 아래만 지운다 ----

const DEMO_KEY = 'mspace:demo:co2'
/** 예시 알림 번호: -101, -102 … (방의 사과 예시 -1과 겹치지 않게) */
const ID_BASE = -100

interface DemoStore { tracks: Record<string, Co2Track>; list: AppNotification[] }

function load(): DemoStore {
  try {
    const raw = sessionStorage.getItem(DEMO_KEY)
    const s = raw ? (JSON.parse(raw) as Partial<DemoStore>) : null
    if (s && s.tracks && typeof s.tracks === 'object' && Array.isArray(s.list)) return { tracks: s.tracks, list: s.list }
  } catch { /* 처음이거나 저장소를 못 씀 */ }
  return { tracks: {}, list: [] }
}

function save(s: DemoStore): void {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* 이 화면에서만 기억 */ }
}

/** 이 예시 알림 번호가 CO2 알림인지 (읽음 처리를 어느 저장소에 할지 고를 때) */
export const isCo2DemoId = (id: number) => id <= ID_BASE

/**
 * 홈이 1분마다 내 방 공기를 다시 볼 때 부른다. 보낼 차례면 알림함에 하나 넣고 그 알림을 돌려준다(아니면 null)
 */
export function noteCo2Demo(reservationId: number, v: RoomView, now: Date): AppNotification | null {
  const s = load()
  const key = String(reservationId)
  const urgent = v.flags.co2Over || (v.flags.co2Soon && v.etaMinutes !== null)
  const { track, fire } = stepCo2Alert(s.tracks[key], urgent, now.getTime())
  s.tracks[key] = track
  let made: AppNotification | null = null
  if (fire) {
    const { title, body } = co2AlertText(v, track.sent)
    made = { id: ID_BASE - 1 - s.list.length, reservationId, kind: CO2_ALERT_KIND, title, body, createdAt: now.toISOString(), read: false }
    s.list = [made, ...s.list]
  }
  save(s)
  return made
}

/** 예시 CO2 알림들 (최신 것이 앞) */
export function demoCo2Alerts(): AppNotification[] {
  return load().list
}

/** 예시 CO2 알림 읽음. id가 null이면 전부 */
export function readCo2Demo(id: number | null): void {
  const s = load()
  s.list = s.list.map((n) => (id === null || n.id === id ? { ...n, read: true } : n))
  save(s)
}

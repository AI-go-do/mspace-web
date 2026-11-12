import { api, ApiError } from './client'
import { mockEnvironment } from './environmentMock'
import { ENV_RULES } from '../config/adminRooms'
import { demoOn } from '../lib/demo'

/**
 * 관리자 "지금" 탭 데이터 창구. 화면은 getRoomsEnvironment 하나만 부른다.
 * 지금은 core API가 없어 가짜 값(environmentMock)을 쓰고, core에 API가 생기면
 * VITE_ADMIN_ENV_SOURCE=api 로 빌드해 아래 모양 그대로 받는다(화면 코드는 그대로).
 * 모양은 core 요청 초안 GET /api/admin/rooms/environment?minutes= (관리자만, 아니면 403 ADMIN_ONLY)을 따른다.
 * current·next·forecast는 초안에 더해 달라고 할 칸이라 없어도 화면이 그려진다
 */

/** 1분 값 하나. 센서가 없거나 그 분에 값이 없으면 null */
export interface EnvPoint {
  at: string
  ppm: number | null
  temperatureC?: number | null
  humidityPct?: number | null
  /** 문 열림 센서(리드 스위치). 그 분에 한 번이라도 열려 있었으면 true. 장치가 없으면 빠진다 */
  doorOpen?: boolean | null
  /** 조도 1분 평균 (우노 CDS 0~1023, 밝을수록 큼, lux 아님). core가 아직 안 주면 빠진다 */
  light?: number | null
  /** 그 분에 재실이었는지 (조도 그래프의 재실 띠). core가 아직 안 주면 빠진다 */
  occupied?: boolean | null
}

export interface RoomEnvironment {
  roomId: number
  roomName: string
  /** 재실 (FR-DEV-101). 신호가 끊기면 UNKNOWN */
  presence: 'OCCUPIED' | 'EMPTY' | 'UNKNOWN'
  lastSignalAt: string | null
  /** 마지막 신호가 core 설정(offline-after-seconds)보다 오래됐으면 true */
  offline: boolean
  co2: { ppm: number; at: string } | null
  temperatureC: number | null
  humidityPct: number | null
  /**
   * 가장 최근 조도 (0~1023). core가 아직 안 주면 빠지거나 null.
   * core는 `{ raw, at }`로 준다(core feat/admin-light-pir). 받자마자 숫자로 펴고 시각은 lightAt에 둔다
   */
  light?: number | null
  lightAt?: string | null
  /** PIR 움직임 최신 값. 보여 주기만 하고 재실 판단에는 안 쓴다(재실은 presence). 없으면 빠지거나 null */
  pir?: { detected: boolean; at: string } | null
  /** 문 열림 지금 상태(since = 지금 상태가 된 시각). 문 장치가 없으면 빠지거나 null */
  door?: { open: boolean; since: string } | null
  /** 지난 N분 1분 값. 오래된 것이 앞 */
  series: EnvPoint[]
  /** 젯슨 CO2 예측(1분 간격). 없으면 화면이 최근 추세로 그린다 */
  forecast?: { at: string; ppm: number }[]
  /**
   * 지금 걸린 예약(people = 예약 인원). 끝난 뒤에도 재실이면 그대로 두어 "시간 넘김"을 알 수 있게 한다.
   * 방 안 사람 수(카메라)는 Q-17 결정 전이라 받지 않는다
   */
  current?: { reservationId: number; startAt: string; endAt: string; people: number } | null
  /** 다음 예약 (people = 예약 인원) */
  next?: { startAt: string; people: number } | null
  /**
   * 빈 방 불 켜짐 (core #124). 재실 없음 + 예약 없음 + 조도 기준 이상이 10분 이어지면 { since: 처음 켜짐을 본 시각 }, 아니면 null.
   * core가 아직 안 주면(가짜 값·예전 core) 빠지고, 화면이 조도 기록으로 직접 센다
   */
  lightLeftOn?: { since: string } | null
}

export interface RoomsEnvironment {
  now: string
  rooms: RoomEnvironment[]
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isNumOrNull = (v: unknown) => v === null || isNum(v)
const isOptNum = (v: unknown) => v === undefined || isNumOrNull(v)
const isOptBool = (v: unknown) => v === undefined || v === null || typeof v === 'boolean'
/** 조도는 숫자(가짜 값·예전 초안) 또는 { raw, at }(core) */
const isLight = (v: unknown) => {
  if (isOptNum(v)) return true
  const l = v as Record<string, unknown>
  return typeof v === 'object' && isNum(l.raw) && isDate(l.at)
}
const isPir = (v: unknown) => {
  if (v === undefined || v === null) return true
  const d = v as Record<string, unknown>
  return typeof v === 'object' && typeof d.detected === 'boolean' && isDate(d.at)
}
const isDate = (v: unknown) => typeof v === 'string' && Number.isFinite(new Date(v).getTime())
/** current·next는 없거나 null이어도 되고, 있으면 시각·인원이 맞아야 한다 */
const isCurrent = (v: unknown) => {
  if (v === undefined || v === null) return true
  const c = v as Record<string, unknown>
  return typeof v === 'object' && isNum(c.reservationId) && isDate(c.startAt) && isDate(c.endAt) && isNum(c.people)
}
const isDoor = (v: unknown) => {
  if (v === undefined || v === null) return true
  const d = v as Record<string, unknown>
  return typeof v === 'object' && typeof d.open === 'boolean' && isDate(d.since)
}
const isNext = (v: unknown) => {
  if (v === undefined || v === null) return true
  const n = v as Record<string, unknown>
  return typeof v === 'object' && isDate(n.startAt) && isNum(n.people)
}

const isLightLeftOn = (v: unknown) => {
  if (v === undefined || v === null) return true
  return typeof v === 'object' && isDate((v as Record<string, unknown>).since)
}

/** 화면이 읽는 칸이 다 있는지. current·next·forecast·light·pir만 빠져도 된다 */
export function isRoomsEnvironment(v: unknown): v is RoomsEnvironment {
  if (!v || typeof v !== 'object') return false
  const d = v as Partial<RoomsEnvironment>
  if (typeof d.now !== 'string' || !Array.isArray(d.rooms)) return false
  return d.rooms.every((r) => !!r && typeof r === 'object'
    && isNum(r.roomId) && typeof r.roomName === 'string'
    && ['OCCUPIED', 'EMPTY', 'UNKNOWN'].includes(r.presence)
    && typeof r.offline === 'boolean'
    && (r.co2 === null || (!!r.co2 && isNum(r.co2.ppm)))
    && isNumOrNull(r.temperatureC) && isNumOrNull(r.humidityPct) && isLight(r.light) && isPir(r.pir)
    && Array.isArray(r.series) && r.series.every((p) => !!p && isDate(p.at) && isNumOrNull(p.ppm) && isOptNum(p.light) && isOptBool(p.occupied))
    && (r.forecast === undefined || (Array.isArray(r.forecast) && r.forecast.every((f) => !!f && isDate(f.at) && isNum(f.ppm))))
    && isCurrent(r.current) && isNext(r.next) && isDoor(r.door) && isLightLeftOn(r.lightLeftOn))
}

/** 빌드할 때 정한 값. develop 이미지(개발 서버)만 'api'로 빌드한다(deploy.yml) */
const BUILD_SOURCE: 'api' | 'mock' = import.meta.env.VITE_ADMIN_ENV_SOURCE === 'api' ? 'api' : 'mock'

/**
 * 지금 화면이 쓸 값. 'api'로 빌드했어도 시연 모드(?demo=1)를 켜면 가짜 값으로 돌아간다.
 * 실제 장치가 1번 방에만 있어서, 발표 때는 다섯 방이 다 움직이는 가짜 값이 필요하다
 */
/**
 * 시연 시계(11/10 재웅 "관리자가 아무것도 안 해도 AI가 다 하는 걸 보여 주기"). 가짜 값일 때만 쓴다.
 * 빨리 감기를 켜면 가짜 값의 시각이 speed배로 흘러, 환기·시간 넘김·노쇼가 저절로 생기고 처리되는 걸 짧게 볼 수 있다
 */
let sim = { real: Date.now(), at: Date.now(), speed: 1 }
export const simNow = (): number => sim.at + (Date.now() - sim.real) * sim.speed
export function setSimSpeed(speed: number): void { sim = { real: Date.now(), at: simNow(), speed } }

export function envSource(): 'api' | 'mock' {
  return BUILD_SOURCE === 'api' && !demoOn() ? 'api' : 'mock'
}

export async function getRoomsEnvironment(
  signal?: AbortSignal,
  member?: number | null,
  minutes: number = ENV_RULES.historyMinutes,
): Promise<{ data: RoomsEnvironment; sample: boolean }> {
  if (envSource() === 'mock') return { data: mockEnvironment(new Date(simNow()), minutes), sample: true }
  const data = await api<unknown>(`/api/admin/rooms/environment?minutes=${minutes}`, { signal, member })
  // API 모양이 아직 초안이라, 칸이 빠진 응답은 화면을 깨뜨리지 않고 오류 문구로 보여 준다
  if (!isRoomsEnvironment(data)) throw new ApiError(0, 'INVALID_RESPONSE', '방 센서 응답 모양이 달라요(core API 확인 필요).')
  return { data: flattenLight(data), sample: false }
}

/** core의 light { raw, at }를 화면이 쓰는 숫자 + lightAt으로 편다. 숫자면 그대로. isRoomsEnvironment(isLight)로 검사한 값만 넣는다 */
export function flattenLight(d: RoomsEnvironment): RoomsEnvironment {
  return {
    ...d,
    rooms: d.rooms.map((r) => {
      const l = r.light as unknown
      if (!l || typeof l !== 'object') return r
      const { raw, at } = l as { raw: number; at: string }
      return { ...r, light: raw, lightAt: at }
    }),
  }
}

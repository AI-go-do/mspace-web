import { api } from './client'
import { mockEnvironment } from './environmentMock'
import { ENV_RULES } from '../config/adminRooms'

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
}

export interface RoomsEnvironment {
  now: string
  rooms: RoomEnvironment[]
}

/** 'api'로 빌드했을 때만 core를 부른다. 그 밖에는 가짜 값 */
export const ENV_SOURCE: 'api' | 'mock' = import.meta.env.VITE_ADMIN_ENV_SOURCE === 'api' ? 'api' : 'mock'

export async function getRoomsEnvironment(
  signal?: AbortSignal,
  member?: number | null,
  minutes: number = ENV_RULES.historyMinutes,
): Promise<{ data: RoomsEnvironment; sample: boolean }> {
  if (ENV_SOURCE === 'mock') return { data: mockEnvironment(new Date(), minutes), sample: true }
  const data = await api<RoomsEnvironment>(`/api/admin/rooms/environment?minutes=${minutes}`, { signal, member })
  return { data, sample: false }
}

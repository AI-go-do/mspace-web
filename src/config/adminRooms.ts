/**
 * 관리자 "지금" 탭에 보일 방과 방마다 붙은 센서 (설정값).
 * 방 이름·센서가 바뀌면 이 파일만 고친다. 센서 목록에 없는 값은 카드에 "센서 없음"으로 나온다.
 * 예: 실습실에 먼저 단 센서를 시연에서 "M-space 창작실 1"로 보여 줄 때 이름과 sensors만 바꾸면 된다.
 * 방 번호(roomId)는 core 방 번호와 같아야 한다(실제 API로 바꾸면 이 번호로 이름·센서를 붙인다)
 */
export type SensorKind = 'co2' | 'temperature' | 'humidity' | 'presence'

export interface AdminRoomConfig {
  roomId: number
  name: string
  sensors: readonly SensorKind[]
}

/**
 * 장치 하나(SCD40)가 CO2·온도·습도를 같이 잰다. 재실은 PIR·조도.
 * 방 안 사람 수(카메라)는 Q-17(카메라 인원 세기) 팀 결정 전이라 보여 주지 않는다
 */
const FULL: readonly SensorKind[] = ['co2', 'temperature', 'humidity', 'presence']

export const ADMIN_ROOMS: readonly AdminRoomConfig[] = [
  { roomId: 1, name: '창작실 1', sensors: FULL },
  { roomId: 2, name: '창작실 2', sensors: FULL },
  { roomId: 3, name: '창작실 3', sensors: FULL },
  { roomId: 4, name: '창작실 4', sensors: FULL },
  { roomId: 5, name: '창작실 5', sensors: FULL },
]

/** 이상 표시 기준. 숫자를 화면 코드에 박지 않고 여기서만 고친다 */
export const ENV_RULES = {
  /** 환기 기준 (FR-DEV-104와 같은 1000ppm) */
  co2LimitPpm: 1000,
  /** 이 시간 안에 기준을 넘을 것 같으면 노란 표시 */
  warnWithinMinutes: 15,
  /** 이 온도 이상이면 "더움" */
  hotC: 27.5,
  /** 이 습도 미만이면 "건조" */
  dryPct: 40,
  /** CO2가 이만큼 똑같으면 센서 고장 의심(빨간 표시) */
  stuckMinutes: 20,
  /** 예약이 끝나고 이만큼 지나도 사람이 있으면 "시간 넘김" */
  overtimeGraceMinutes: 5,
  /** 예약이 없는데 CO2가 1분에 이만큼 넘게 오르면 "예약 없이 사용?" (무단 사용 의심) */
  unbookedRisePpmPerMin: 3,
  /** 그래프에 그릴 지난 시간과 예측 시간 */
  historyMinutes: 60,
  forecastMinutes: 15,
  /** 새 값을 읽는 간격 (장치도 10초마다 보낸다) */
  pollMs: 10_000,
}

export type EnvRules = { readonly [K in keyof typeof ENV_RULES]: number }

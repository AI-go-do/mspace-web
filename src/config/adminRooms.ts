/**
 * 관리자 "지금" 탭에 보일 방과 방마다 붙은 센서 (설정값).
 * 방 이름·센서가 바뀌면 이 파일만 고친다. 센서 목록에 없는 값은 카드에 "센서 없음"으로 나온다.
 * 예: 실습실에 먼저 단 센서를 시연에서 "M-space 창작실 1"로 보여 줄 때 이름과 sensors만 바꾸면 된다.
 * 방 번호(roomId)는 core 방 번호와 같아야 한다(실제 API로 바꾸면 이 번호로 이름·센서를 붙인다)
 */
export type SensorKind = 'co2' | 'temperature' | 'humidity' | 'presence' | 'door' | 'light'

export interface AdminRoomConfig {
  roomId: number
  name: string
  sensors: readonly SensorKind[]
}

/**
 * 장치 하나(SCD40)가 CO2·온도·습도를 같이 잰다. 재실은 PIR, 조도(light)는 우노 A0의 CDS(0~1023, 밝을수록 큼, lux 아님).
 * 문 열림은 문틀 리드 스위치(door).
 * 방 안 사람 수(카메라)는 Q-17(카메라 인원 세기) 팀 결정 전이라 보여 주지 않는다
 */
const FULL: readonly SensorKind[] = ['co2', 'temperature', 'humidity', 'presence', 'door', 'light']

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
  /** 이 온도 이상이면 방 상세 창에 참고로 보인다(사람마다 느낌이 달라 경고는 아님) */
  hotC: 27.5,
  /** 이 습도 미만이면 방 상세 창에 참고로 보인다(경고는 아님) */
  dryPct: 40,
  /** CO2가 이만큼 똑같으면 센서 고장 의심(빨간 표시) */
  stuckMinutes: 20,
  /** 예약이 끝나고 이만큼 지나도 사람이 있으면 "시간 넘김" */
  overtimeGraceMinutes: 5,
  /** 예약이 없는데 CO2가 1분에 이만큼 넘게 오르면 "예약 없이 사용?" (무단 사용 의심) */
  unbookedRisePpmPerMin: 3,
  /** 빈 방 문이 이만큼 열려 있으면 "문 열림" (사람이 있으면 환기라 표시하지 않는다) */
  doorOpenEmptyMinutes: 10,
  /** 예약이 시작되고 이만큼 지나도 아무도 없으면 "입실 안 함" (노쇼는 core가 15분에 처리) */
  noEntryWarnMinutes: 5,
  noShowMinutes: 15,
  /**
   * 밝기(조도 원시값 0~1023을 0~100%로 바꾼 값)가 이 % 이상이면 "불 켜짐". 임시값이라
   * 실제 방에서 불을 켜고 끈 값을 재서 고친다(확인 필요, CDS 위치·햇빛에 따라 다름)
   */
  lightOnPct: 50,
  /** 빈 방에 불이 이만큼 켜져 있으면 "불 켜짐" 표시 */
  lightLeftOnMinutes: 10,
  /** 이 시각(서울)부터 다음 날 nightTo 전까지 문이 열리면 바로 알린다 */
  nightFromHour: 22,
  nightToHour: 7,
  /** 그래프에 그릴 지난 시간과 예측 시간 */
  historyMinutes: 60,
  forecastMinutes: 15,
  /** 새 값을 읽는 간격 (장치도 10초마다 보낸다) */
  pollMs: 10_000,
}

export type EnvRules = { readonly [K in keyof typeof ENV_RULES]: number }

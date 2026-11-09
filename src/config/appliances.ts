/**
 * 창작실 에어컨·공기청정기 (설정값). 창작실은 중앙 냉난방이 아니라 학생이 직접 켜고 끈다.
 * 시제품은 에어컨을 적외선(IR) 리모컨 신호로, 공기청정기를 스마트 플러그 전원으로 켠다.
 * 방마다 기기가 다르면 이 파일만 고친다. 목록에 없는 방은 카드에 기기 칸이 나오지 않는다
 */
export type ApplianceKind = 'ac' | 'purifier'

export interface ApplianceConfig {
  /** core에 보낼 기기 번호 (방 안에서 하나) */
  id: string
  kind: ApplianceKind
  name: string
  /** ir: 아두이노 적외선 LED로 리모컨 신호 · plug: 스마트 플러그 전원 */
  via: 'ir' | 'plug'
}

const BOTH = (roomId: number): readonly ApplianceConfig[] => [
  { id: `r${roomId}-ac`, kind: 'ac', name: '에어컨', via: 'ir' },
  { id: `r${roomId}-purifier`, kind: 'purifier', name: '공기청정기', via: 'plug' },
]

export const ROOM_APPLIANCES: Readonly<Record<number, readonly ApplianceConfig[]>> = {
  1: BOTH(1), 2: BOTH(2), 3: BOTH(3), 4: BOTH(4), 5: BOTH(5),
}

/** 권유·자동 제어 기준. 숫자를 화면 코드에 박지 않고 여기서만 고친다 */
export const CLIMATE_RULES = {
  /** 냉방 켤 때 맞출 온도 (정부 권장 실내 냉방 26°C) */
  coolTargetC: 26,
  /** 이 온도 미만이면 "추워요" → 난방 */
  coldC: 18,
  /** 난방 켤 때 맞출 온도 (정부 권장 겨울 실내 20°C, 확인 필요) */
  heatTargetC: 20,
  /** 빈 방이라도 다음 예약이 이 시간 안이면 미리 켜기를 권하고, 이 시간 안에 예약이 없으면 끄기를 권한다 */
  precoolMinutes: 60,
  /** 관리자가 손으로 바꾼 기기를 자동이 건드리지 않는 시간. 학생이 바꾼 건 그 예약이 끝날 때까지 */
  manualHoldMinutes: 10,
  /** 자동 제어가 같은 기기에 같은 명령을 다시 보내기 전 기다리는 시간 (사람이 끈 걸 바로 다시 켜지 않게) */
  autoCooldownMinutes: 10,
  /** 자동 명령이 실패했을 때 다시 해 보기 전 기다리는 시간 (실패한 API를 10초마다 두드리지 않게) */
  autoRetryMinutes: 1,
  /** 가짜 명령이 "보내는 중"으로 보이는 시간 */
  mockDelayMs: 900,
  /** "숨 막히기 N분 전" 알림을 한 예약에 보내는 최대 횟수 (처음 한 번 + 내려갔다 다시 오를 때 한 번) */
  co2AlertMax: 2,
  /** 알림 뒤 CO2 경고가 이 시간 넘게 사라져 있어야 다시 오를 때 한 번 더 보낸다 (기준 언저리에서 오르내릴 때 알림이 쏟아지지 않게) */
  co2AlertRearmMinutes: 10,
}

/**
 * AI 학습 기준 (11/9 재웅 "실제 AI가 알아서"). 규칙(CLIMATE_RULES)이 안전 난간이고, 학습은 그 안에서 방마다 숫자만 고친다.
 * - 데워지는·식는 속도: 지난 가동 기록에서 방마다 "1°C 바꾸는 데 몇 분"을 배워 미리 켤 시각을 정한다(고정 60분 대신)
 * - 목표 온도: 학생이 손으로 끈 온도를 모아, 자주 일찍 끄는 방은 목표를 반 도씩 낮추거나(난방) 올린다(냉방)
 */
export const LEARN_RULES = {
  /** 이만큼 모여야 배운 값을 쓴다. 적으면 기본 규칙 그대로 */
  minSamples: 3,
  /** 가동 기록 하나로 치는 최소 시간·온도 변화 (너무 짧은 건 잡음) */
  minRunMinutes: 10,
  minRunDeltaC: 0.5,
  /** 계산한 시간에 더하는 여유 */
  marginMinutes: 10,
  /** 미리 켜기 시간의 아래·위 한계 (배운 값이 이상해도 이 안에서만) */
  minPrecoolMinutes: 15,
  maxPrecoolMinutes: 120,
  /** 한파·폭염인 날은 배운 속도보다 이만큼 느리다고 본다 */
  alertSlowdown: 1.3,
  /** 배운 목표 온도의 한계 (난방은 이 아래로, 냉방은 이 위로 안 간다) */
  minHeatTargetC: 18,
  maxCoolTargetC: 28,
  /** 목표 온도를 고치는 단위 */
  targetStepC: 0.5,
  /** 기억할 손 끄기 기록 수 (방·모드마다 최근 것만) */
  keepOffs: 12,
}

/**
 * 바깥 날씨·계절 기준. 켤지 말지는 방 안 센서로 정하고, 바깥 날씨는 "얼마나 미리, 몇 도로"만 바꾼다.
 * 계절은 달 이름이 아니라 광주 평년 기온으로 나눈다(11월처럼 평년 10°C 아래면 난방철)
 */
export const WEATHER_RULES = {
  /** 이 달 평년 기온이 이 아래면 겨울(난방철): 11–3월 */
  winterNormalBelowC: 10,
  /** 이 달 평년 기온이 이 이상이면 여름(냉방철): 6–9월 */
  summerNormalFromC: 22,
  /** 겨울: 실내가 이 아래면 난방 */
  winterColdC: 19,
  /** 여름: 실내가 이 이상이면 냉방 */
  summerHotC: 27,
  /** 한파: 아침 최저가 이 이하 (기상청 한파주의보 기준) */
  coldWaveMinC: -12,
  /** 폭염: 낮 최고가 이 이상 (기상청 폭염주의보는 체감온도 33°C, 확인 필요) */
  heatWaveMaxC: 33,
  /** 한파·폭염인 날은 다음 예약 이만큼 전부터 미리 켠다 (보통 날은 precoolMinutes) */
  alertPrecoolMinutes: 90,
  /** 봄·가을에 바깥이 방보다 이만큼 시원하고 이 온도 이상이면 에어컨 대신 창문을 권한다 */
  windowCoolerByC: 3,
  windowMinOutdoorC: 15,
  /** 시연 한파·폭염일 때 가짜 실내 온도를 이만큼 옮긴다 (가짜 단계 전용) */
  demoColdIndoorShiftC: -7,
  demoHotIndoorShiftC: 3,
}

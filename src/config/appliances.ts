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
  /** 난방 켤 때 맞출 온도 */
  heatTargetC: 22,
  /** 빈 방이라도 다음 예약이 이 시간 안이면 미리 켜기를 권하고, 이 시간 안에 예약이 없으면 끄기를 권한다 */
  precoolMinutes: 60,
  /** 자동 제어가 같은 기기에 같은 명령을 다시 보내기 전 기다리는 시간 (사람이 끈 걸 바로 다시 켜지 않게) */
  autoCooldownMinutes: 10,
  /** 자동 명령이 실패했을 때 다시 해 보기 전 기다리는 시간 (실패한 API를 10초마다 두드리지 않게) */
  autoRetryMinutes: 1,
  /** 가짜 명령이 "보내는 중"으로 보이는 시간 */
  mockDelayMs: 900,
}

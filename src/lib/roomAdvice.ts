import { ENV_RULES, type EnvRules } from '../config/adminRooms'
import type { RoomView } from './roomHealth'
import { seoulClock } from './time'

/**
 * 방 상세 창 "지금 확인할 것". 표시(노랑·남색)마다 왜 그런지 + 관리자가 할 일 한 줄.
 * 경고·정지 같은 판정은 넣지 않는다(늘 사람이 판단). 버튼이 있는 일은 action으로 알린다
 */
export interface Advice {
  tone: 'warn' | 'off'
  title: string
  todo: string
  action?: 'checkout' | 'block'
}

export function roomAdvice(v: RoomView, now: Date, rules: EnvRules = ENV_RULES): Advice[] {
  const out: Advice[] = []
  const { flags } = v
  if (flags.offline) {
    const at = v.lastSignalAt ? `마지막 신호 ${seoulClock(new Date(v.lastSignalAt))}` : '신호를 받은 적이 없어요'
    out.push({ tone: 'off', title: `장치 신호가 끊겼어요 (${at})`, todo: '장치 전원과 와이파이를 확인해 주세요. 오래 걸리면 점검으로 방을 막아 두세요.', action: 'block' })
  }
  if (flags.stuck) {
    out.push({ tone: 'off', title: `CO2가 ${v.sameForMinutes}분째 같은 값이에요`, todo: '센서가 멈췄을 수 있어요. 장치를 다시 켜 보고, 그래도 같으면 점검으로 막아 두세요.', action: 'block' })
  }
  if (flags.co2Over) {
    out.push({ tone: 'warn', title: `CO2가 기준 ${rules.co2LimitPpm}ppm을 넘었어요`, todo: '방 안 사람에게 문·창문을 열어 환기하도록 알려 주세요.' })
  } else if (flags.co2Soon && v.etaMinutes !== null) {
    out.push({ tone: 'warn', title: `약 ${v.etaMinutes}분 뒤 CO2가 ${rules.co2LimitPpm}ppm을 넘을 것 같아요`, todo: '넘기 전에 미리 환기하면 답답해지지 않아요. 예측은 그래프의 점선과 범위로 볼 수 있어요.' })
  }
  if (flags.overtime && v.current) {
    out.push({ tone: 'warn', title: `예약이 ${v.overtimeMinutes}분 지났는데 사람이 있어요 (#${v.current.reservationId})`, todo: '다음 예약이 있으면 먼저 퇴실을 안내하고, 안 되면 강제 퇴실해 주세요.', action: 'checkout' })
  }
  if (flags.unbooked) {
    out.push({ tone: 'warn', title: '예약이 없는데 CO2가 계속 오르고 있어요', todo: '예약 없이 쓰는 사람이 있을 수 있어요. 지나가는 길에 한번 확인해 주세요.' })
  }
  if (flags.hot) {
    const before = v.nextAt && v.presence !== 'OCCUPIED' && new Date(v.nextAt).getTime() > now.getTime()
    out.push({ tone: 'warn', title: `온도가 ${v.temperatureC?.toFixed(1)}°C로 더워요`, todo: before ? `다음 예약(${seoulClock(new Date(v.nextAt!))}) 전에 냉방이나 환기를 켜 두면 좋아요.` : '냉방이나 환기를 확인해 주세요.' })
  }
  if (flags.dry) {
    out.push({ tone: 'warn', title: `습도가 ${v.humidityPct}%로 건조해요`, todo: '오래 쓰는 방이면 가습기를 확인해 주세요.' })
  }
  return out
}

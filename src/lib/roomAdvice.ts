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
  action?: 'checkout' | 'block' | 'reports'
  /** 노랑·남색 표시까지는 아닌 참고(건조). 맨 위 띠·카드 이유 줄에는 올리지 않는다 */
  minor?: boolean
}

/** 맨 위 띠·카드에 올릴 것만 (참고는 상세 창에서만) */
export const majorAdvice = (list: Advice[]) => list.filter((a) => !a.minor)

/** 방 값 밖에서 오는 것: 관리자가 막은 기간(사유 문구), 판정 기다리는 신고 수 */
export interface AdviceContext { blocked?: string | null; openReports?: number }

export function roomAdvice(v: RoomView, now: Date, ctx: AdviceContext = {}, rules: EnvRules = ENV_RULES): Advice[] {
  const out: Advice[] = []
  const { flags } = v
  if (flags.offline) {
    const at = v.lastSignalAt ? `마지막 신호 ${seoulClock(new Date(v.lastSignalAt))}` : '신호를 받은 적이 없어요'
    out.push({ tone: 'off', title: `장치 신호가 끊겼어요 (${at})`, todo: '장치 전원과 와이파이를 확인해 주세요. 오래 걸리면 점검으로 방을 막아 두세요.', action: 'block' })
  }
  if (flags.stuck) {
    out.push({ tone: 'off', title: `CO2가 ${v.sameForMinutes}분째 같은 값이에요`, todo: '센서가 멈췄을 수 있어요. 장치를 다시 켜 보고, 그래도 같으면 점검으로 막아 두세요.', action: 'block' })
  }
  if (flags.nightDoor && v.door) {
    out.push({ tone: 'warn', title: `밤에 문이 열렸어요 (${seoulClock(new Date(v.door.since))}부터)`, todo: v.current ? `예약 #${v.current.reservationId}이 있는 시간이에요. 예약한 사람인지 확인해 주세요.` : '예약이 없는 시간이에요. 누가 들어갔는지 바로 확인해 주세요.' })
  }
  if (ctx.blocked && (v.presence === 'OCCUPIED' || flags.unbooked)) {
    out.push({ tone: 'warn', title: `${ctx.blocked}으로 막아 둔 방에 사람이 있어요`, todo: '공사·점검 담당자인지 확인하고, 아니면 나가도록 안내해 주세요.' })
  }
  if (ctx.openReports && ctx.openReports > 0) {
    out.push({ tone: 'warn', title: `판정 기다리는 신고 ${ctx.openReports}건`, todo: '할 일 칸에서 사진을 보고 판정해 주세요.', action: 'reports' })
  }
  if (flags.co2Over) {
    out.push({ tone: 'warn', title: `CO2가 기준 ${rules.co2LimitPpm}ppm을 넘었어요`, todo: '방 안 사람에게 문·창문을 열어 환기하도록 알려 주세요.' })
  } else if (flags.co2Soon && v.etaMinutes !== null) {
    out.push({ tone: 'warn', title: `약 ${v.etaMinutes}분 뒤 CO2가 ${rules.co2LimitPpm}ppm을 넘을 것 같아요`, todo: '넘기 전에 미리 환기하면 답답해지지 않아요. 예측은 그래프의 점선과 범위로 볼 수 있어요.' })
  }
  if (flags.overtime && v.current) {
    out.push({ tone: 'warn', title: `예약이 ${v.overtimeMinutes}분 지났는데 사람이 있어요 (#${v.current.reservationId})`, todo: '다음 예약이 있으면 먼저 퇴실을 안내하고, 안 되면 강제 퇴실해 주세요.', action: 'checkout' })
  }
  if (flags.noEntry && v.current) {
    const left = Math.max(0, rules.noShowMinutes - v.noEntryMinutes)
    out.push({ tone: 'warn', title: `예약이 시작된 지 ${v.noEntryMinutes}분인데 아무도 없어요 (#${v.current.reservationId})`, todo: left > 0 ? `${left}분 안에 입실하지 않으면 노쇼로 바뀌고 방이 풀려요. 따로 할 일은 없어요.` : '곧 노쇼로 바뀌고 방이 풀려요. 따로 할 일은 없어요.' })
  }
  if (flags.unbooked) {
    out.push({ tone: 'warn', title: '예약이 없는데 CO2가 계속 오르고 있어요', todo: '예약 없이 쓰는 사람이 있을 수 있어요. 지나가는 길에 한번 확인해 주세요.' })
  }
  if (flags.doorLeftOpen && v.door) {
    out.push({ tone: 'warn', title: `빈 방 문이 ${v.door.minutes}분째 열려 있어요`, todo: '지나가는 길에 닫아 주세요. 밤이나 주말이면 누가 들어갔는지 먼저 확인해 주세요.' })
  }
  if (flags.lightLeftOn) {
    out.push({ tone: 'warn', title: `빈 방에 불이 ${v.lightOnEmptyMinutes}분째 켜져 있어요`, todo: v.nextAt ? '다음 예약 전까지 비어 있으면 지나갈 때 꺼 주세요.' : '지나갈 때 불을 꺼 주세요. 밤이면 문이 잠겼는지도 같이 봐 주세요.' })
  }
  if (flags.hot) {
    const before = v.nextAt && v.presence !== 'OCCUPIED' && new Date(v.nextAt).getTime() > now.getTime()
    out.push({ tone: 'warn', title: `온도가 ${v.temperatureC?.toFixed(1)}°C로 더워요`, todo: before ? `다음 예약(${seoulClock(new Date(v.nextAt!))}) 전에 냉방이나 환기를 켜 두면 좋아요.` : '냉방이나 환기를 확인해 주세요.' })
  }
  if (flags.dry) {
    out.push({ tone: 'warn', title: `습도가 ${v.humidityPct}%로 건조해요`, todo: '오래 쓰는 방이면 가습기를 확인해 주세요.', minor: true })
  }
  return out
}

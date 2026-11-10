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
  /** 오디(AI)가 사람 대신 한 일·할 일(10차 회의: 관리자는 보기만). 없으면 사람이 장치를 봐야 하는 일 */
  auto?: string
  /** 오디가 할 수 있는 건 했지만 사람이 장치를 직접 봐야 끝나는 일(센서 끊김·멈춤) */
  hands?: boolean
  /** 노랑·남색 표시까지는 아닌 참고(온도·습도). 맨 위 띠·카드 이유 줄에는 올리지 않는다 */
  minor?: boolean
  /**
   * 오디가 스스로 판단해 가는 단계(11/10 재웅 "9분 지났는데 사람이 있으면 AI가 알아서 경고"). 화면에서 차례로 보여 준다.
   * 마지막 단계(경고 매기기)는 아직 core 규칙이 없어 시연 값에서만 보여 준다
   */
  steps?: string[]
}

/** 시간 넘김 뒤 퇴실 안내를 보내고 경고를 매기기까지 더 기다리는 분. 팀 규칙이 정해지기 전 시연용 임시 값 */
export const OVERTIME_GRACE_MINUTES = 10

/** 맨 위 띠·카드에 올릴 것만 (참고는 상세 창에서만) */
export const majorAdvice = (list: Advice[]) => list.filter((a) => !a.minor)

/** 방 값 밖에서 오는 것: 관리자가 막은 기간(사유 문구), 판정 기다리는 신고 수 */
export interface AdviceContext { blocked?: string | null; openReports?: number }

export function roomAdvice(v: RoomView, now: Date, ctx: AdviceContext = {}, rules: EnvRules = ENV_RULES): Advice[] {
  const out: Advice[] = []
  const { flags } = v
  if (flags.offline) {
    const at = v.lastSignalAt ? `마지막 신호 ${seoulClock(new Date(v.lastSignalAt))}` : '신호를 받은 적이 없어요'
    out.push({ tone: 'off', title: `장치 신호가 끊겼어요 (${at})`, todo: '장치 전원과 와이파이를 확인해 주세요. 오래 걸리면 점검으로 방을 막아 두세요.', action: 'block', auto: '센서 경고 멈춤 · 담당에게 알림', hands: true })
  }
  if (flags.stuck) {
    out.push({ tone: 'off', title: `CO2가 ${v.sameForMinutes}분째 같은 값이에요`, todo: '센서가 멈췄을 수 있어요. 장치를 다시 켜 보고, 그래도 같으면 점검으로 막아 두세요.', action: 'block', auto: '환기 알림 멈춤 · 담당에게 알림', hands: true })
  }
  if (flags.nightDoor && v.door) {
    out.push({ tone: 'warn', title: `밤에 문이 열렸어요 (${seoulClock(new Date(v.door.since))}부터)`, todo: v.current ? `예약 #${v.current.reservationId}이 있는 시간이에요. 예약한 사람인지 확인해 주세요.` : '예약이 없는 시간이에요. 누가 들어갔는지 바로 확인해 주세요.', auto: v.current ? '대표자에게 알림' : '아침 보고에 올림' })
  }
  if (ctx.blocked && (v.presence === 'OCCUPIED' || flags.unbooked)) {
    out.push({ tone: 'warn', title: `${ctx.blocked}으로 막아 둔 방에 사람이 있어요`, todo: '공사·점검 담당자인지 확인하고, 아니면 나가도록 안내해 주세요.', auto: '아침 보고에 올림' })
  }
  if (ctx.openReports && ctx.openReports > 0) {
    out.push({ tone: 'warn', title: `판정 기다리는 신고 ${ctx.openReports}건`, todo: '할 일 칸에서 사진을 보고 판정해 주세요.', action: 'reports', auto: '사진 비교 중' })
  }
  if (flags.co2Over) {
    out.push({ tone: 'warn', title: `CO2가 기준 ${rules.co2LimitPpm}ppm을 넘었어요`, todo: '방 안 사람에게 문·창문을 열어 환기하도록 알려 주세요.', auto: '환기 알림 보냄' })
  } else if (flags.co2Soon && v.etaMinutes !== null) {
    out.push({ tone: 'warn', title: `약 ${v.etaMinutes}분 뒤 CO2가 ${rules.co2LimitPpm}ppm을 넘을 것 같아요`, todo: '넘기 전에 미리 환기하면 답답해지지 않아요. 예측은 그래프의 점선과 범위로 볼 수 있어요.', auto: '미리 환기 알림 보냄' })
  }
  if (flags.overtime && v.current) {
    out.push({ tone: 'warn', title: `예약이 ${v.overtimeMinutes}분 지났는데 사람이 있어요 (#${v.current.reservationId})`, todo: '다음 예약이 있으면 먼저 퇴실을 안내하고, 안 되면 강제 퇴실해 주세요.', action: 'checkout', auto: '퇴실 안내 보냄',
      steps: [`끝난 뒤 ${v.overtimeMinutes}분째 있음`, '퇴실 안내 보냄', `${OVERTIME_GRACE_MINUTES}분 더 지켜봄`, '경고 1회 · 7일 안 철회 가능'] })
  }
  if (flags.noEntry && v.current) {
    const left = Math.max(0, rules.noShowMinutes - v.noEntryMinutes)
    out.push({ tone: 'warn', title: `예약이 시작된 지 ${v.noEntryMinutes}분인데 아무도 없어요 (#${v.current.reservationId})`, todo: left > 0 ? `${left}분 안에 입실하지 않으면 노쇼로 바뀌고 방이 풀려요. 따로 할 일은 없어요.` : '곧 노쇼로 바뀌고 방이 풀려요. 따로 할 일은 없어요.', auto: `${rules.noShowMinutes}분에 노쇼로 풀어요` })
  }
  if (flags.unbooked) {
    out.push({ tone: 'warn', title: '예약이 없는데 CO2가 계속 오르고 있어요', todo: '예약 없이 쓰는 사람이 있을 수 있어요. 지나가는 길에 한번 확인해 주세요.', auto: '아침 보고에 올림' })
  }
  if (flags.doorLeftOpen && v.door) {
    out.push({ tone: 'warn', title: `빈 방 문이 ${v.door.minutes}분째 열려 있어요`, todo: '지나가는 길에 닫아 주세요. 밤이나 주말이면 누가 들어갔는지 먼저 확인해 주세요.', auto: '마지막 대표자에게 알림' })
  }
  if (flags.lightLeftOn) {
    out.push({ tone: 'warn', title: `빈 방에 불이 ${v.lightOnEmptyMinutes}분째 켜져 있어요`, todo: v.nextAt ? '다음 예약 전까지 비어 있으면 지나갈 때 꺼 주세요.' : '지나갈 때 불을 꺼 주세요. 밤이면 문이 잠겼는지도 같이 봐 주세요.', auto: '아침 보고에 올림' })
  }
  if (flags.hot) {
    const before = v.nextAt && v.presence !== 'OCCUPIED' && new Date(v.nextAt).getTime() > now.getTime()
    // 덥게 느끼는지는 사람마다 달라서 경고가 아니라 참고. 켤지는 방을 쓰는 학생이 정한다
    out.push({ tone: 'warn', title: `참고: 온도 ${v.temperatureC?.toFixed(1)}°C`, todo: before ? `다음 예약(${seoulClock(new Date(v.nextAt!))}) 팀이 더우면 직접 냉방을 켤 수 있어요.` : '더운지는 사람마다 달라요. 방을 쓰는 학생이 직접 냉방을 켤 수 있어요.', minor: true })
  }
  if (flags.dry) {
    out.push({ tone: 'warn', title: `참고: 습도 ${v.humidityPct}%`, todo: '오래 쓰는 방이면 가습기를 확인해 주세요.', minor: true })
  }
  return out
}
